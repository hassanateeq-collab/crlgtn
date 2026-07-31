/**
 * ef_vendor_respond (M4) — the magic-link endpoint.
 *
 * The ONLY function without JWT verification (verify_jwt = false), and the
 * exception is the design: vendors hold no accounts in MVP. Authentication is
 * the offer token — 32 random bytes, sha-256'd at rest, expiring with the
 * decision window, and single-use in effect because an offer that has left
 * sent/viewed refuses further responses.
 *
 * Actions: view · accept (binding hold) · counter (not a hold) · decline.
 */

import { corsHeaders, preflight } from "../_shared/cors.ts";
import { adminClient } from "../_shared/context.ts";
import { hashToken } from "../_shared/token.ts";
import { notify } from "../_shared/notify.ts";

interface RespondBody {
  token?: string;
  action?: "view" | "accept" | "counter" | "decline";
  counter?: { listing_id?: string; note?: string };
}

function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json; charset=utf-8" },
  });
}

const fail = (req: Request, status: number, code: string, message: string) =>
  json(req, status, { ok: false, error: { code, message, details: null } });

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") {
    return fail(req, 405, "method_not_allowed", "POST only");
  }

  try {
    const admin = adminClient();
    let body: RespondBody;
    try {
      body = await req.json();
    } catch {
      return fail(req, 400, "bad_request", "Invalid JSON");
    }

    const token = (body.token ?? "").trim();
    const action = body.action;
    if (!token || !action) {
      return fail(req, 400, "bad_request", "token and action are required");
    }

    // ---- authenticate by token -------------------------------------------
    const tokenHash = await hashToken(token);
    const { data: offer } = await admin
      .from("rfq_offers")
      .select(
        "*, booking_files!inner(id, ref, name, status, check_in, check_out, rooms, auto_accept, window_expires_at, corporate_id), vendors!inner(id, name), listings!inner(id, name, max_occupancy, bed_config)",
      )
      .eq("token_hash", tokenHash)
      .maybeSingle();

    // Wrong token and expired token look identical from outside.
    if (!offer) return fail(req, 404, "not_found", "This link is not valid");

    const file = offer.booking_files;
    const now = Date.now();
    const expired = new Date(offer.token_expires_at).getTime() < now;

    if (expired && ["sent", "viewed"].includes(offer.status)) {
      // Lazy expiry; the M5 sweep does this in bulk, but a vendor clicking a
      // dead link should see the truth immediately.
      await admin.from("rfq_offers").update({ status: "expired" }).eq("id", offer.id);
      offer.status = "expired";
    }

    // The vendor-side contact, for audit attribution and reply routing.
    const { data: contact } = await admin
      .from("vendor_users")
      .select("id, name")
      .eq("vendor_id", offer.vendor_id)
      .limit(1)
      .maybeSingle();

    const offerView = () => ({
      ref: file.ref,
      hotel: offer.vendors.name,
      room: offer.listings.name,
      bed_config: offer.listings.bed_config,
      package_code: offer.package_code,
      rate_pkr: offer.rate_pkr,
      check_in: file.check_in,
      check_out: file.check_out,
      rooms: file.rooms,
      status: offer.status,
      counter: offer.counter,
      window_expires_at: offer.token_expires_at,
    });

    // ---- view -------------------------------------------------------------
    if (action === "view") {
      if (offer.status === "sent") {
        await admin
          .from("rfq_offers")
          .update({ status: "viewed", viewed_at: new Date().toISOString() })
          .eq("id", offer.id)
          .eq("status", "sent");
        offer.status = "viewed";
      }
      // Alternate rooms this vendor may counter with.
      const { data: alternates } = await admin
        .from("listings")
        .select("id, name, bed_config, max_occupancy")
        .eq("vendor_id", offer.vendor_id)
        .eq("active", true)
        .neq("id", offer.listing_id);
      return json(req, 200, {
        ok: true,
        data: { ...offerView(), alternates: alternates ?? [] },
      });
    }

    // ---- respond actions ---------------------------------------------------
    if (offer.status === "expired") {
      return fail(req, 409, "expired", "The decision window has ended; this request has lapsed");
    }
    if (!["sent", "viewed"].includes(offer.status)) {
      // Single-use: hold/countered/declined/booked/released are all final here.
      return fail(req, 409, "already_responded", `This offer is already ${offer.status}`);
    }

    let nextStatus: string;
    let counterPayload: Record<string, unknown> | null = null;

    if (action === "accept") {
      nextStatus = "hold";
    } else if (action === "decline") {
      nextStatus = "declined";
    } else if (action === "counter") {
      const c = body.counter ?? {};
      if (!c.listing_id && !c.note?.trim()) {
        return fail(req, 422, "unprocessable", "A counter needs an alternate room or a note");
      }
      if (c.listing_id) {
        const { data: alt } = await admin
          .from("listings")
          .select("id, vendor_id, active")
          .eq("id", c.listing_id)
          .maybeSingle();
        if (!alt || alt.vendor_id !== offer.vendor_id || !alt.active) {
          return fail(req, 422, "unprocessable", "Alternate room is not one of yours");
        }
      }
      nextStatus = "countered";
      counterPayload = { listing_id: c.listing_id ?? null, note: c.note?.trim() ?? null };
    } else {
      return fail(req, 400, "bad_request", `Unknown action ${action}`);
    }

    // Guarded transition: only wins if the offer is still open. A concurrent
    // duplicate submit loses here and gets already_responded.
    const { data: updated } = await admin
      .from("rfq_offers")
      .update({
        status: nextStatus,
        responded_at: new Date().toISOString(),
        response_channel: "magic_link",
        ...(counterPayload ? { counter: counterPayload } : {}),
      })
      .eq("id", offer.id)
      .in("status", ["sent", "viewed"])
      .select("id")
      .maybeSingle();
    if (!updated) {
      return fail(req, 409, "already_responded", "This offer has already been answered");
    }

    // Keep the in-memory row honest: offerView() below renders the vendor's
    // confirmation, and it must show the state that just committed.
    offer.status = nextStatus;
    if (counterPayload) offer.counter = counterPayload;

    // File: requested → responded on first response of any kind.
    if (file.status === "requested") {
      await admin
        .from("booking_files")
        .update({ status: "responded" })
        .eq("id", file.id)
        .eq("status", "requested");
    }

    // ---- audit -------------------------------------------------------------
    await admin.from("audit_log").insert(
      contact
        ? {
            actor_type: "vendor_user",
            actor_id: contact.id,
            action: "ef_vendor_respond",
            entity: "rfq_offers",
            entity_id: offer.id,
            diff: { after: { status: nextStatus, counter: counterPayload } },
          }
        : {
            actor_type: "system",
            actor_id: null,
            action: "ef_vendor_respond",
            entity: "rfq_offers",
            entity_id: offer.id,
            diff: {
              after: { status: nextStatus, counter: counterPayload },
              note: "no vendor_users contact on record",
            },
          },
    );

    // ---- notify the corporate side (spec §8: hold/counter → booker) --------
    if (nextStatus === "hold" || nextStatus === "countered") {
      const { data: booker } = await admin
        .from("corporate_users")
        .select("id, email")
        .eq("corporate_id", file.corporate_id)
        .in("role", ["corp_booker", "corp_admin"])
        .limit(1)
        .maybeSingle();
      await notify(admin, {
        event: nextStatus === "hold" ? "offer_hold" : "offer_countered",
        recipientType: "corporate_user",
        recipientId: booker?.id ?? null,
        channel: "portal",
        template: "booker_offer_update",
        payload: {
          offer_id: offer.id,
          booking_file_id: file.id,
          ref: file.ref,
          hotel: offer.vendors.name,
          status: nextStatus,
          counter: counterPayload,
        },
        dedupeKey: `${nextStatus}:${offer.id}:portal`,
      });
    }

    // NOTE: the auto-accept short-circuit (file.auto_accept && hold → book
    // instantly) lands in M5 with ef_book_offer's transaction. Until then a
    // hold is a hold, never a booking — safe in both directions.

    return json(req, 200, { ok: true, data: offerView() });
  } catch (err) {
    console.error("unhandled_error", {
      function: "ef_vendor_respond",
      message: err instanceof Error ? err.message : String(err),
    });
    return fail(req, 500, "internal_error", "Something went wrong");
  }
});
