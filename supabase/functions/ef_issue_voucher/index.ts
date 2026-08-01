/**
 * ef_issue_voucher (M6) — manual (re-)issue endpoint.
 *
 * Vouchers auto-issue at booking time (hooks in ef_book_offer and the
 * auto-accept path). This endpoint covers the rest: re-issue after traveler
 * details arrive, re-send after a failed upload, ops resending a lost link.
 * Ops can issue for any booking; a corporate booker/admin only for their own.
 */

import { serveEdge, type EdgeContext } from "../_shared/handler.ts";
import { writeAudit } from "../_shared/audit.ts";
import { isOps } from "../_shared/context.ts";
import { badRequest, forbidden, notFound, unprocessable } from "../_shared/errors.ts";
import { issueVoucher } from "../_shared/voucher.ts";

serveEdge("ef_issue_voucher", async ({ admin, actor, body, functionName }: EdgeContext) => {
  const bookingId = body.booking_id as string | undefined;
  if (!bookingId) throw badRequest("booking_id is required");

  const { data: booking } = await admin
    .from("bookings")
    .select("id, booking_files!inner(corporate_id)")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) throw notFound("Booking not found");

  if (!isOps(actor)) {
    const owns =
      (booking.booking_files as { corporate_id: string }).corporate_id === actor.corporateId;
    const mayIssue =
      actor.corporateRole === "corp_booker" || actor.corporateRole === "corp_admin";
    if (!owns || !mayIssue) throw forbidden("Not permitted for this booking");
  }

  const result = await issueVoucher(admin, bookingId);
  if (!result) throw unprocessable("Voucher generation failed; see function logs");

  await writeAudit(admin, actor, {
    action: functionName,
    entity: "vouchers",
    entityId: bookingId,
    diff: { after: { ref: result.voucherRef, pdf: result.pdfPath } },
  });

  return result;
});
