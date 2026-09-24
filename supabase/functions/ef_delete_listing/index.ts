/**
 * ef_delete_listing — remove one room type / vehicle class from a vendor.
 *
 * Ops-only. Two outcomes, chosen by what still points at the row:
 *
 *   · deleted  — nothing in history references it: the row goes, and its own
 *                children (base rates, allotments, media rows) cascade with it.
 *   · archived — an offer, counter or transfer booking references it (those
 *                FKs are ON DELETE RESTRICT so past bookings keep their room
 *                name): the row stays with active = false, deleted_at = now(),
 *                and its rates/allotments/media are removed so it is gone from
 *                the editor, the property page and search exactly as if deleted.
 *
 * Either way only the one listing is touched; the vendor, its other room types
 * and every booking are left as they were.
 */

import { serveEdge, type EdgeContext } from "../_shared/handler.ts";
import { writeAudit } from "../_shared/audit.ts";
import { isOps } from "../_shared/context.ts";
import { badRequest, forbidden, notFound, unprocessable } from "../_shared/errors.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serveEdge("ef_delete_listing", async ({ admin, actor, body, functionName }: EdgeContext) => {
  if (!isOps(actor)) throw forbidden("Deleting a room type is an ops action");

  const listingId = String(body.listing_id ?? "").trim();
  if (!UUID_RE.test(listingId)) throw badRequest("listing_id must be a uuid");

  const { data: listing, error: readErr } = await admin
    .from("listings")
    .select("id, vendor_id, name, active, deleted_at")
    .eq("id", listingId)
    .maybeSingle();
  if (readErr) throw unprocessable(`listing: ${readErr.message}`);
  if (!listing) throw notFound("Room type not found");
  if (listing.deleted_at) {
    // Idempotent: a second click on an already-archived row is not an error.
    return { listing_id: listing.id, vendor_id: listing.vendor_id, mode: "archived" };
  }

  // ---- what history still points here? -----------------------------------
  const count = async (table: string, column: string) => {
    const { count: n, error } = await admin
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq(column, listingId);
    if (error) throw unprocessable(`${table}: ${error.message}`);
    return n ?? 0;
  };
  const [offers, counters, transfers] = await Promise.all([
    count("rfq_offers", "listing_id"),
    // A hotel's counter-offer names an alternative room in jsonb; booking it
    // later must still resolve, so it counts as history too.
    count("rfq_offers", "counter->>listing_id"),
    count("transfer_bookings", "listing_id"),
  ]);
  const referenced = offers + counters + transfers > 0;

  // ---- the listing's own children go in both modes -------------------------
  // (hard delete cascades them; archive removes them explicitly so an archived
  // room type has no gallery, no rate card and no allotment left behind.)
  for (const table of ["media", "listing_rates", "allotments"]) {
    const { error } = await admin.from(table).delete().eq("listing_id", listingId);
    if (error) throw unprocessable(`${table}: ${error.message}`);
  }

  let mode: "deleted" | "archived";
  if (!referenced) {
    const { error } = await admin.from("listings").delete().eq("id", listingId);
    if (error && error.code !== "23503") throw unprocessable(`listing: ${error.message}`);
    // 23503 = a reference this function did not know about; fall back to archive.
    mode = error ? "archived" : "deleted";
  } else {
    mode = "archived";
  }
  if (mode === "archived") {
    const { error } = await admin
      .from("listings")
      .update({ active: false, deleted_at: new Date().toISOString() })
      .eq("id", listingId);
    if (error) throw unprocessable(`listing: ${error.message}`);
  }

  await writeAudit(admin, actor, {
    action: functionName,
    entity: "listings",
    entityId: listingId,
    diff: {
      before: { vendor_id: listing.vendor_id, name: listing.name, active: listing.active },
      after: { mode, references: { offers, counters, transfers } },
    },
  });

  return { listing_id: listingId, vendor_id: listing.vendor_id, mode };
});
