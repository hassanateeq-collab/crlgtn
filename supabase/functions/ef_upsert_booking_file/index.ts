/**
 * ef_upsert_booking_file (M2) — create or update a draft booking file.
 *
 * Corporate-side only: corp_booker and corp_admin write; approver and finance
 * read via RLS but do not shape requests. The file stays `draft` here — the
 * status machine starts moving at ef_send_rfq (M4), and this function refuses
 * to touch a file that has already left draft.
 *
 * Ref format CF-{seq}-KHI is assigned once, at creation, from a database
 * sequence — never reused, never client-supplied.
 */

import { serveEdge, type EdgeContext } from "../_shared/handler.ts";
import { writeAudit } from "../_shared/audit.ts";
import { isOps } from "../_shared/context.ts";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "../_shared/errors.ts";

interface RoomInput {
  guests: number;
}

serveEdge("ef_upsert_booking_file", async ({ admin, actor, body, functionName }: EdgeContext) => {
  // ---- validate: who -------------------------------------------------------
  if (isOps(actor)) {
    // Ops backstop actions arrive in M4/M5 with evidence requirements; file
    // shaping is the corporate's own act.
    throw forbidden("Booking files are created by corporate users");
  }
  if (actor.corporateRole !== "corp_booker" && actor.corporateRole !== "corp_admin") {
    throw forbidden("Only bookers and admins create booking files");
  }
  const corporateId = actor.corporateId!;

  // ---- validate: what ------------------------------------------------------
  const fileIn = body.file as Record<string, unknown> | undefined;
  if (!fileIn) throw badRequest("file is required");

  const name = typeof fileIn.name === "string" ? fileIn.name.trim() : "";
  if (!name) throw badRequest("file.name is required");

  const checkIn = String(fileIn.check_in ?? "");
  const checkOut = String(fileIn.check_out ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn) || !/^\d{4}-\d{2}-\d{2}$/.test(checkOut)) {
    throw badRequest("check_in and check_out must be YYYY-MM-DD");
  }
  if (checkOut <= checkIn) throw unprocessable("check_out must be after check_in");

  const rooms = (fileIn.rooms ?? []) as RoomInput[];
  if (!Array.isArray(rooms) || rooms.length < 1) {
    throw unprocessable("at least one room is required");
  }
  if (rooms.length > 9) throw unprocessable("a file holds at most 9 rooms");
  for (const r of rooms) {
    if (!Number.isInteger(r.guests) || r.guests < 1 || r.guests > 6) {
      throw unprocessable("each room needs 1-6 guests");
    }
  }

  const dealbreakers = (fileIn.dealbreakers ?? []) as string[];
  if (!Array.isArray(dealbreakers)) throw badRequest("dealbreakers must be an array");
  if (dealbreakers.length) {
    const { data: eligible } = await admin
      .from("amenities")
      .select("code")
      .eq("dealbreaker_eligible", true)
      .in("code", dealbreakers);
    const ok = new Set((eligible ?? []).map((a) => a.code));
    const bad = dealbreakers.filter((c) => !ok.has(c));
    if (bad.length) {
      throw unprocessable(`not deal-breaker-eligible: ${bad.join(", ")}`);
    }
  }

  const travelersIn = body.travelers as
    | { name: string; email?: string; phone?: string }[]
    | undefined;
  if (travelersIn) {
    for (const t of travelersIn) {
      if (!t.name?.trim()) throw badRequest("every traveler needs a name");
    }
  }

  // Service decides which vendors the file searches: 'hotel' (default) or
  // 'car' — cars run the identical RFQ machinery (owner decision 2026-08-18).
  const service = (fileIn.service as string) ?? "hotel";
  if (!["hotel", "car"].includes(service)) {
    throw unprocessable("service must be hotel or car");
  }

  const row = {
    corporate_id: corporateId,
    name,
    service,
    check_in: checkIn,
    check_out: checkOut,
    rooms: rooms.map((r) => ({ guests: r.guests })),
    dealbreakers,
    corridor_id: fileIn.corridor_id ?? null,
    auto_accept: fileIn.auto_accept === true,
  };

  // ---- write ---------------------------------------------------------------
  let fileId = fileIn.id as string | undefined;

  if (fileId) {
    const { data: existing } = await admin
      .from("booking_files")
      .select("id, corporate_id, status")
      .eq("id", fileId)
      .maybeSingle();

    // Cross-tenant probes get the same answer as a missing row: nothing.
    if (!existing || existing.corporate_id !== corporateId) {
      throw notFound("Booking file not found");
    }
    if (existing.status !== "draft") {
      throw conflict(`File is ${existing.status}; only drafts can be edited`);
    }

    const { error } = await admin.from("booking_files").update(row).eq("id", fileId);
    if (error) throw unprocessable(`update failed: ${error.message}`);
  } else {
    // Sequence-based ref, assigned exactly once.
    const { data: seq, error: seqErr } = await admin.rpc("next_booking_ref");
    if (seqErr || !seq) throw unprocessable(`ref generation failed: ${seqErr?.message}`);

    const { data, error } = await admin
      .from("booking_files")
      .insert({ ...row, ref: seq as string, created_by: actor.recordId })
      .select("id")
      .single();
    if (error) throw unprocessable(`create failed: ${error.message}`);
    fileId = data.id;
  }

  if (travelersIn) {
    await admin.from("travelers").delete().eq("booking_file_id", fileId);
    if (travelersIn.length) {
      const { error } = await admin.from("travelers").insert(
        travelersIn.map((t) => ({
          booking_file_id: fileId,
          name: t.name.trim(),
          email: t.email?.trim() || null,
          phone: t.phone?.trim() || null,
        })),
      );
      if (error) throw unprocessable(`travelers: ${error.message}`);
    }
  }

  // ---- audit ---------------------------------------------------------------
  await writeAudit(admin, actor, {
    action: functionName,
    entity: "booking_files",
    entityId: fileId,
    diff: { after: { ...row, travelers: travelersIn?.length ?? "untouched" } },
  });

  // ---- respond -------------------------------------------------------------
  const [file, travelers] = await Promise.all([
    admin.from("booking_files").select("*").eq("id", fileId).single(),
    admin
      .from("travelers")
      .select("id, name, email, phone")
      .eq("booking_file_id", fileId)
      .order("name"),
  ]);

  return { file: file.data, travelers: travelers.data ?? [] };
});
