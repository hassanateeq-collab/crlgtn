/**
 * Voucher issuance (M6) — shared by ef_book_offer (auto-issue at booking),
 * ef_vendor_respond (auto-accept path) and ef_issue_voucher (manual re-issue).
 *
 * The PDF is built from the BOOKING's policy snapshots, never from the
 * vendor's current row — the whole point of snapshotting (spec §5). Re-issuing
 * after ops edits a hotel's policy must still print the old wording.
 *
 * Never throws: a voucher failure must not fail a booking. Returns null on
 * failure and logs; ops re-issues from the console.
 */

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { buildPdf, wrap, type PdfLine } from "./pdf.ts";
import { notify } from "./notify.ts";

const PKT = "Asia/Karachi";

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: PKT, day: "2-digit", month: "short", year: "numeric",
  }).format(new Date(iso + "T00:00:00+05:00"));
}

export async function issueVoucher(
  admin: SupabaseClient,
  bookingId: string,
): Promise<{ voucherRef: string; pdfPath: string } | null> {
  try {
    const { data: b } = await admin
      .from("bookings")
      .select(
        `*,
         booking_files!inner(id, ref, name, check_in, check_out, rooms, corporate_id,
           corporates!inner(name)),
         rfq_offers!inner(package_code, listing_id, rate_pkr,
           listings!inner(name, bed_config)),
         vendors!inner(id, name, address, phone, checkin_time, checkout_time)`,
      )
      .eq("id", bookingId)
      .maybeSingle();
    if (!b) {
      console.error("voucher_booking_missing", { bookingId });
      return null;
    }

    const file = b.booking_files;
    const offer = b.rfq_offers;
    const vendor = b.vendors;

    const [{ data: travelers }, { data: inclusions }, { data: pkg }] = await Promise.all([
      admin.from("travelers").select("name, email, phone").eq("booking_file_id", file.id).order("name"),
      admin.from("inclusions").select("label").eq("vendor_id", vendor.id).order("label"),
      admin.from("packages").select("name").eq("code", offer.package_code).maybeSingle(),
    ]);

    const voucherRef = `${file.ref}/V`;
    const rooms = (file.rooms ?? []) as { guests: number }[];
    const cancelText =
      (b.cancellation_policy_snapshot as { text?: string } | null)?.text ??
      "Per the hotel's policy communicated at booking.";
    const noshowText =
      (b.noshow_policy_snapshot as { text?: string } | null)?.text ??
      "Per the hotel's policy communicated at booking.";

    // ---- compose ------------------------------------------------------------
    const lines: PdfLine[] = [
      { text: "CORLINGTON", size: 18, bold: true, gap: 2 },
      { text: "Accommodation voucher - bill to company", size: 10, color: [0.35, 0.42, 0.38], gap: 14 },
      { text: `Voucher ${voucherRef}`, size: 12, bold: true, gap: 12 },

      { text: "GUESTS", size: 8, bold: true, color: [0.35, 0.42, 0.38], gap: 3 },
      ...(travelers?.length
        ? travelers.map((t) => ({
            text: `${t.name}${t.phone ? `  ·  ${t.phone}` : ""}`, size: 11 as const, gap: 2,
          }))
        : [{ text: "Guest details to follow before check-in", size: 11, gap: 2 }]),
      { text: `Booked by ${file.corporates.name}`, size: 9, color: [0.35, 0.42, 0.38], gap: 12 },

      { text: "HOTEL", size: 8, bold: true, color: [0.35, 0.42, 0.38], gap: 3 },
      { text: vendor.name, size: 12, bold: true, gap: 2 },
      ...(vendor.address ? [{ text: vendor.address, size: 10, gap: 2 }] : []),
      ...(vendor.phone ? [{ text: `Front desk ${vendor.phone}`, size: 10, gap: 12 }] : [{ text: "", size: 4, gap: 8 }]),

      { text: "STAY", size: 8, bold: true, color: [0.35, 0.42, 0.38], gap: 3 },
      {
        text: `${fmtDate(file.check_in)} to ${fmtDate(file.check_out)}  (${b.nights} night${b.nights > 1 ? "s" : ""})`,
        size: 11, gap: 2,
      },
      {
        text:
          `Check-in from ${vendor.checkin_time?.slice(0, 5) ?? "14:00"}, ` +
          `check-out by ${vendor.checkout_time?.slice(0, 5) ?? "12:00"} (PKT)`,
        size: 10, gap: 2,
      },
      {
        text: `${rooms.length} x ${offer.listings.name}` +
          `${offer.listings.bed_config ? ` (${offer.listings.bed_config})` : ""}` +
          ` - guests per room: ${rooms.map((r) => r.guests).join(", ")}`,
        size: 10, gap: 2,
      },
      { text: `Package ${offer.package_code}${pkg?.name ? ` - ${pkg.name}` : ""}`, size: 10, gap: 12 },

      { text: "INCLUDED", size: 8, bold: true, color: [0.35, 0.42, 0.38], gap: 3 },
      ...(inclusions?.length
        ? inclusions.map((i) => ({ text: `- ${i.label}`, size: 10 as const, gap: 2 }))
        : [{ text: "- As per package", size: 10, gap: 2 }]),
      { text: "NOT INCLUDED", size: 8, bold: true, color: [0.35, 0.42, 0.38], gap: 3 },
      { text: "- Personal extras (minibar, laundry, room service, calls)", size: 10, gap: 10 },

      // The BTC block, wording per spec §2 — verbatim, always.
      { text: "PAYMENT", size: 8, bold: true, color: [0.35, 0.42, 0.38], gap: 3 },
      { text: "Bill to company.", size: 11, bold: true, gap: 2 },
      { text: "Nothing payable at the desk except personal extras.", size: 11, bold: true, gap: 12 },

      { text: "CANCELLATION", size: 8, bold: true, color: [0.35, 0.42, 0.38], gap: 3 },
      ...wrap(cancelText, 9).map((t) => ({ text: t, size: 9 as const, gap: 2 })),
      { text: "NO-SHOW", size: 8, bold: true, color: [0.35, 0.42, 0.38], gap: 3 },
      ...wrap(noshowText, 9).map((t) => ({ text: t, size: 9 as const, gap: 10 })),

      { text: "Corlington desk, 24/7 - this voucher was issued electronically.", size: 8, color: [0.35, 0.42, 0.38] },
    ];

    const pdf = buildPdf(lines);
    const pdfPath = `${bookingId}.pdf`;

    const { error: upErr } = await admin.storage
      .from("vouchers")
      .upload(pdfPath, pdf, { contentType: "application/pdf", upsert: true });
    if (upErr) {
      console.error("voucher_upload_failed", { bookingId, error: upErr.message });
      return null;
    }

    await admin.from("vouchers").upsert(
      { booking_id: bookingId, ref: voucherRef, pdf_url: pdfPath },
      { onConflict: "booking_id" },
    );

    // 7-day signed link for the emails (recipients have no portal login).
    const { data: signed } = await admin.storage
      .from("vouchers")
      .createSignedUrl(pdfPath, 7 * 24 * 3600);
    const link = signed?.signedUrl ?? "";

    // ---- traveler email (only when details exist — spec §2) ----------------
    const traveler = (travelers ?? []).find((t) => t.email);
    if (traveler?.email) {
      await notify(admin, {
        event: "voucher_traveler",
        recipientType: "traveler",
        channel: "email",
        template: "voucher_traveler",
        payload: { booking_id: bookingId, ref: voucherRef, link },
        dedupeKey: `voucher_traveler:${bookingId}`,
        toEmail: traveler.email,
        subject: `Your Corlington stay voucher ${voucherRef}`,
        html:
          `<p>Dear ${traveler.name},</p>` +
          `<p>Your stay at <strong>${vendor.name}</strong> (${fmtDate(file.check_in)} to ${fmtDate(file.check_out)}) is confirmed.</p>` +
          `<p><a href="${link}">Download your voucher</a> (valid 7 days; the desk can resend it any time).</p>` +
          `<p>Bill to company - nothing payable at the desk except personal extras.</p>`,
      });
      await admin.from("vouchers")
        .update({ sent_traveler_at: new Date().toISOString() })
        .eq("booking_id", bookingId);
    }

    // ---- vendor handover (spec §8: email + WhatsApp) -----------------------
    const { data: contact } = await admin
      .from("vendor_users")
      .select("id, email, whatsapp")
      .eq("vendor_id", vendor.id)
      .limit(1)
      .maybeSingle();
    const guestList = (travelers ?? []).map((t) => t.name).join(", ") || "to follow";
    await notify(admin, {
      event: "booking_handover",
      recipientType: "vendor_user",
      recipientId: contact?.id ?? null,
      channel: "email",
      template: "vendor_handover",
      payload: { booking_id: bookingId, ref: file.ref, guests: guestList, link },
      dedupeKey: `handover_email:${bookingId}`,
      toEmail: contact?.email ?? undefined,
      subject: `Corlington booking ${file.ref} - guest handover`,
      html:
        `<p>Booking <strong>${file.ref}</strong> is confirmed as bill-to-company.</p>` +
        `<p>Guests: ${guestList}</p>` +
        `<p>${fmtDate(file.check_in)} to ${fmtDate(file.check_out)} - ${rooms.length} x ${offer.listings.name}, ${offer.package_code}.</p>` +
        `<p>Collect nothing at the desk except personal extras.</p>`,
    });
    await notify(admin, {
      event: "booking_handover",
      recipientType: "vendor_user",
      recipientId: contact?.id ?? null,
      channel: "whatsapp",
      template: "vendor_handover_wa",
      payload: { booking_id: bookingId, ref: file.ref, guests: guestList, whatsapp: contact?.whatsapp },
      dedupeKey: `handover_wa:${bookingId}`,
    });
    await admin.from("vouchers")
      .update({ sent_vendor_at: new Date().toISOString() })
      .eq("booking_id", bookingId);

    // Retire the queue marker written by book_offer().
    await admin
      .from("notifications")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("dedupe_key", `voucher:${bookingId}`);

    return { voucherRef, pdfPath };
  } catch (err) {
    console.error("voucher_issue_failed", {
      bookingId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
