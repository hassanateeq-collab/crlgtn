/**
 * ef_send_rfq (M4) — turn a draft file plus ≤3 selections into live offers.
 *
 * Validates everything server-side: file ownership and draft status, vendor
 * liveness, listing fit, and — critically — the rate. The client's displayed
 * rate is advisory; the offer's rate_pkr is re-resolved here from listing_rates
 * (negotiated over base) so a tampered request cannot invent a price.
 *
 * Window rule (dev plan, open item §13.4 default): 180 minutes standard,
 * 60 minutes when check-in is within 48 hours. Configurable via env
 * WINDOW_STANDARD_MIN / WINDOW_URGENT_MIN without a redeploy.
 */

import { serveEdge, type EdgeContext } from "../_shared/handler.ts";
import { writeAudit } from "../_shared/audit.ts";
import { isOps } from "../_shared/context.ts";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "../_shared/errors.ts";
import { generateToken, hashToken } from "../_shared/token.ts";
import { notify } from "../_shared/notify.ts";

interface SelectionInput {
  vendor_id: string;
  listing_id: string;
  package_code: string;
  priority: number;
}

serveEdge("ef_send_rfq", async ({ admin, actor, body, functionName }: EdgeContext) => {
  // ---- validate: who -------------------------------------------------------
  if (isOps(actor)) throw forbidden("RFQs are sent by corporate users");
  if (actor.corporateRole !== "corp_booker" && actor.corporateRole !== "corp_admin") {
    throw forbidden("Only bookers and admins send requests");
  }

  // ---- validate: file ------------------------------------------------------
  const fileId = body.booking_file_id as string | undefined;
  if (!fileId) throw badRequest("booking_file_id is required");

  const { data: file } = await admin
    .from("booking_files")
    .select("*")
    .eq("id", fileId)
    .maybeSingle();
  if (!file || file.corporate_id !== actor.corporateId) {
    throw notFound("Booking file not found");
  }
  if (file.status !== "draft") {
    throw conflict(`File is ${file.status}; a request can only be sent once`);
  }

  // ---- validate: selections ------------------------------------------------
  const selections = (body.selections ?? []) as SelectionInput[];
  if (!Array.isArray(selections) || selections.length < 1) {
    throw unprocessable("select at least one hotel");
  }
  if (selections.length > 3) {
    // The cap is a business identity, not a UI nicety (spec §2).
    throw unprocessable("a request goes to at most 3 hotels");
  }
  const vendorIds = new Set(selections.map((s) => s.vendor_id));
  if (vendorIds.size !== selections.length) {
    throw unprocessable("each hotel can be selected only once");
  }
  const priorities = new Set(selections.map((s) => s.priority));
  if (![...priorities].every((p) => [1, 2, 3].includes(p)) || priorities.size !== selections.length) {
    throw unprocessable("priorities must be distinct values 1-3");
  }

  // ---- window rule ---------------------------------------------------------
  const standardMin = Number(Deno.env.get("WINDOW_STANDARD_MIN") ?? 180);
  const urgentMin = Number(Deno.env.get("WINDOW_URGENT_MIN") ?? 60);
  const checkInMs = new Date(`${file.check_in}T00:00:00+05:00`).getTime();
  const urgent = checkInMs - Date.now() <= 48 * 3600 * 1000;
  const windowMinutes = urgent ? urgentMin : standardMin;
  const windowExpiresAt = new Date(Date.now() + windowMinutes * 60_000).toISOString();

  // Two different audiences, two different hosts. APP_BASE_URL is where
  // corporate bookers and ops sign in; VENDOR_BASE_URL is the public,
  // account-less host that hotels reach from WhatsApp. Vendor links must never
  // carry the portal origin. Falls back to APP_BASE_URL so a missing secret
  // degrades to today's single-host behaviour rather than breaking sends.
  const appBaseUrl = (Deno.env.get("APP_BASE_URL") ?? "http://localhost:5173").replace(/\/$/, "");
  const vendorBaseUrl = (Deno.env.get("VENDOR_BASE_URL") ?? appBaseUrl).replace(/\/$/, "");

  // ---- build offers (validate each selection against the catalog) ----------
  const offers: Record<string, unknown>[] = [];
  const links: { vendorId: string; vendorName: string; url: string; priority: number }[] = [];

  for (const sel of selections) {
    const [{ data: vendor }, { data: listing }] = await Promise.all([
      admin.from("vendors").select("id, name, status").eq("id", sel.vendor_id).maybeSingle(),
      admin
        .from("listings")
        .select("id, vendor_id, name, active")
        .eq("id", sel.listing_id)
        .maybeSingle(),
    ]);
    if (!vendor || vendor.status !== "live") {
      throw unprocessable(`hotel is not bookable: ${sel.vendor_id}`);
    }
    if (!listing || listing.vendor_id !== vendor.id || !listing.active) {
      throw unprocessable(`room does not belong to ${vendor.name} or is inactive`);
    }

    // Authoritative rate resolution: negotiated for this corporate, else base.
    const { data: rateRows } = await admin
      .from("listing_rates")
      .select("rate_pkr, corporate_id")
      .eq("listing_id", listing.id)
      .eq("package_code", sel.package_code)
      .is("valid_to", null)
      .or(`corporate_id.is.null,corporate_id.eq.${actor.corporateId}`);
    const negotiated = (rateRows ?? []).find((r) => r.corporate_id !== null);
    const base = (rateRows ?? []).find((r) => r.corporate_id === null);
    const rate = negotiated?.rate_pkr ?? base?.rate_pkr;
    if (!rate) {
      throw unprocessable(`${vendor.name} has no ${sel.package_code} rate for ${listing.name}`);
    }

    const token = generateToken();
    offers.push({
      booking_file_id: fileId,
      vendor_id: vendor.id,
      listing_id: listing.id,
      package_code: sel.package_code,
      rate_pkr: rate,
      priority: sel.priority,
      status: "sent",
      token_hash: await hashToken(token),
      token_expires_at: windowExpiresAt,
    });
    links.push({
      vendorId: vendor.id,
      vendorName: vendor.name,
      url: `${vendorBaseUrl}/r/${token}`,
      priority: sel.priority,
    });
  }

  // ---- write: offers + file transition -------------------------------------
  const { data: inserted, error: insErr } = await admin
    .from("rfq_offers")
    .insert(offers)
    .select("id, vendor_id, priority");
  if (insErr) throw unprocessable(`offer creation failed: ${insErr.message}`);

  const { error: fileErr } = await admin
    .from("booking_files")
    .update({
      status: "requested",
      window_minutes: windowMinutes,
      window_expires_at: windowExpiresAt,
    })
    .eq("id", fileId)
    .eq("status", "draft"); // no double-send even in a race
  if (fileErr) throw unprocessable(`file transition failed: ${fileErr.message}`);

  // ---- notify: one email + one queued WhatsApp per vendor ------------------
  for (const link of links) {
    const offerId = inserted?.find((o) => o.vendor_id === link.vendorId)?.id;
    const { data: contact } = await admin
      .from("vendor_users")
      .select("id, name, email, whatsapp")
      .eq("vendor_id", link.vendorId)
      .limit(1)
      .maybeSingle();

    const stay = `${file.check_in} → ${file.check_out}`;
    const roomsTotal = (file.rooms as { guests: number }[]).length;
    const html = `
      <p>New request from Corlington — <strong>${file.ref}</strong></p>
      <p>${stay} · ${roomsTotal} room(s)</p>
      <p>Respond within <strong>${windowMinutes} minutes</strong>:</p>
      <p><a href="${link.url}">${link.url}</a></p>
      <p>Accepting places a binding hold until the corporate decides or the window ends.</p>`;

    await notify(admin, {
      event: "rfq_sent",
      recipientType: "vendor_user",
      recipientId: contact?.id ?? null,
      channel: "email",
      template: "vendor_rfq",
      payload: { offer_id: offerId, ref: file.ref, magic_link: link.url, window_minutes: windowMinutes },
      dedupeKey: `rfq_sent:${offerId}:email`,
      toEmail: contact?.email ?? undefined,
      subject: `Corlington request ${file.ref} — respond within ${windowMinutes} min`,
      html,
    });
    await notify(admin, {
      event: "rfq_sent",
      recipientType: "vendor_user",
      recipientId: contact?.id ?? null,
      channel: "whatsapp",
      template: "vendor_rfq_wa",
      payload: { offer_id: offerId, ref: file.ref, magic_link: link.url, whatsapp: contact?.whatsapp },
      dedupeKey: `rfq_sent:${offerId}:whatsapp`,
    });
  }

  // ---- audit ---------------------------------------------------------------
  await writeAudit(admin, actor, {
    action: functionName,
    entity: "booking_files",
    entityId: fileId,
    diff: {
      after: {
        status: "requested",
        offers: inserted?.length,
        window_minutes: windowMinutes,
        window_expires_at: windowExpiresAt,
      },
    },
  });

  // ---- respond (tokens never leave; links live only in notifications) ------
  const { data: fresh } = await admin
    .from("booking_files").select("*").eq("id", fileId).single();
  const { data: freshOffers } = await admin
    .from("rfq_offers")
    .select("id, vendor_id, listing_id, package_code, rate_pkr, priority, status, sent_at")
    .eq("booking_file_id", fileId)
    .order("priority");

  return { file: fresh, offers: freshOffers ?? [] };
});
