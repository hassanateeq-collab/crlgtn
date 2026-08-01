/**
 * ef_book_offer (M5) — the corporate's "book this one" click.
 *
 * All the heavy lifting — locks, re-checks, snapshots, sibling release, file
 * transition, notifications — happens inside public.book_offer() in one
 * database transaction. This function's job is only authorization (does this
 * offer belong to the caller's corporate, is the caller allowed to book) and
 * error translation.
 */

import { serveEdge, type EdgeContext } from "../_shared/handler.ts";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "../_shared/errors.ts";
import { issueVoucher } from "../_shared/voucher.ts";

serveEdge("ef_book_offer", async ({ admin, actor, body }: EdgeContext) => {
  if (actor.actorType !== "corporate_user") {
    throw forbidden("Booking is the corporate's act (ops use the override flow)");
  }
  if (actor.corporateRole !== "corp_booker" && actor.corporateRole !== "corp_admin") {
    throw forbidden("Only bookers and admins book offers");
  }

  const offerId = body.offer_id as string | undefined;
  if (!offerId) throw badRequest("offer_id is required");

  // Ownership check outside the transaction; the transaction re-checks state.
  const { data: offer } = await admin
    .from("rfq_offers")
    .select("id, booking_files!inner(corporate_id)")
    .eq("id", offerId)
    .maybeSingle();
  if (!offer || (offer.booking_files as { corporate_id: string }).corporate_id !== actor.corporateId) {
    throw notFound("Offer not found");
  }

  const { data, error } = await admin.rpc("book_offer", {
    p_offer_id: offerId,
    p_actor_type: "corporate_user",
    p_actor_id: actor.recordId,
  });

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("offer_not_found")) throw notFound("Offer not found");
    if (msg.includes("window_expired")) {
      throw conflict("The decision window has ended; this offer has lapsed");
    }
    if (msg.includes("file_not_bookable") || msg.includes("offer_not_bookable")) {
      // Includes the double-book race loser: the offer is already booked/released.
      throw conflict("This offer can no longer be booked", { detail: msg });
    }
    if (msg.includes("no_rate_for_counter_listing")) {
      throw unprocessable("The countered room has no contracted rate for this package");
    }
    throw unprocessable(`booking failed: ${msg}`);
  }

  // Voucher auto-issues right here (M6); a failure logs and never unwinds the
  // booking — ops can re-issue from ef_issue_voucher.
  const bookingId = (data as { booking_id?: string })?.booking_id;
  if (bookingId) await issueVoucher(admin, bookingId);

  // Audit is written inside the transaction, atomically with the booking.
  return data;
});
