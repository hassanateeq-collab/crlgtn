/**
 * ef_ops_override_accept (M5) — the 24/7 desk's backstop.
 *
 * When a hotel confirms verbally but can't click the link, ops may accept on
 * its behalf — but ONLY with written evidence already in hand: the WhatsApp
 * message id AND the email message id of the hotel's confirmation (spec §2).
 * The function refuses to write without both. That is the point of it.
 */

import { serveEdge, type EdgeContext } from "../_shared/handler.ts";
import { writeAudit } from "../_shared/audit.ts";
import { isOps } from "../_shared/context.ts";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "../_shared/errors.ts";
import { notify } from "../_shared/notify.ts";

serveEdge("ef_ops_override_accept", async ({ admin, actor, body, functionName }: EdgeContext) => {
  if (!isOps(actor)) throw forbidden("Override-accept is an ops action");

  const offerId = body.offer_id as string | undefined;
  if (!offerId) throw badRequest("offer_id is required");

  // The evidence gate. Both ids, both non-blank, no exceptions.
  const evidence = body.evidence as { wa_msg_id?: string; email_msg_id?: string } | undefined;
  const waMsgId = evidence?.wa_msg_id?.trim();
  const emailMsgId = evidence?.email_msg_id?.trim();
  if (!waMsgId || !emailMsgId) {
    throw unprocessable(
      "Override requires evidence: both wa_msg_id and email_msg_id of the hotel's written confirmation",
    );
  }

  const { data: offer } = await admin
    .from("rfq_offers")
    .select(
      "id, status, vendor_id, booking_files!inner(id, ref, status, auto_accept, window_expires_at, corporate_id, created_by), vendors!inner(name)",
    )
    .eq("id", offerId)
    .maybeSingle();
  if (!offer) throw notFound("Offer not found");

  const file = offer.booking_files as {
    id: string; ref: string; status: string; auto_accept: boolean;
    window_expires_at: string; created_by: string | null; corporate_id: string;
  };

  if (new Date(file.window_expires_at).getTime() < Date.now()) {
    throw conflict("The decision window has ended; nothing to override");
  }
  if (!["sent", "viewed"].includes(offer.status)) {
    throw conflict(`Offer is already ${offer.status}; override applies to unanswered offers`);
  }

  // Guarded transition, same shape as the vendor's own accept.
  const { data: updated } = await admin
    .from("rfq_offers")
    .update({
      status: "hold",
      responded_at: new Date().toISOString(),
      response_channel: "ops_override",
      ops_override: true,
      ops_evidence: { wa_msg_id: waMsgId, email_msg_id: emailMsgId, agent: actor.name },
    })
    .eq("id", offerId)
    .in("status", ["sent", "viewed"])
    .select("id")
    .maybeSingle();
  if (!updated) throw conflict("Offer was answered while the override was in flight");

  if (file.status === "requested") {
    await admin
      .from("booking_files")
      .update({ status: "responded" })
      .eq("id", file.id)
      .eq("status", "requested");
  }

  await writeAudit(admin, actor, {
    action: functionName,
    entity: "rfq_offers",
    entityId: offerId,
    diff: {
      after: {
        status: "hold", ops_override: true,
        evidence: { wa_msg_id: waMsgId, email_msg_id: emailMsgId },
      },
    },
  });

  await notify(admin, {
    event: "offer_hold",
    recipientType: "corporate_user",
    recipientId: file.created_by,
    channel: "portal",
    template: "booker_offer_update",
    payload: {
      offer_id: offerId, booking_file_id: file.id, ref: file.ref,
      hotel: (offer.vendors as { name: string }).name,
      status: "hold", ops_override: true,
    },
    dedupeKey: `hold:${offerId}:portal`,
  });

  // An auto-accept file books on first hold regardless of who placed it.
  let booking: unknown = null;
  if (file.auto_accept) {
    const { data, error } = await admin.rpc("book_offer", {
      p_offer_id: offerId,
      p_actor_type: "ops_user",
      p_actor_id: actor.recordId,
    });
    if (!error) booking = data;
    else console.error("override_autobook_failed", { offerId, error: error.message });
  }

  return { offer_id: offerId, status: booking ? "booked" : "hold", booking };
});
