/**
 * ef_book_transfer — standalone airport pick-up / drop-off (instant book).
 *
 * No RFQ, no window: routes carry fixed contracted prices, so the booking is
 * one authorization check here and one atomic transaction in the database
 * (public.book_transfer — transfer + invoice + deposit drawdown + handover).
 */

import { serveEdge, type EdgeContext } from "../_shared/handler.ts";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "../_shared/errors.ts";

serveEdge("ef_book_transfer", async ({ admin, actor, body }: EdgeContext) => {
  if (actor.actorType !== "corporate_user") {
    throw forbidden("Transfers are booked by corporate users");
  }
  if (actor.corporateRole !== "corp_booker" && actor.corporateRole !== "corp_admin") {
    throw forbidden("Only bookers and admins book transfers");
  }

  const listingId = body.listing_id as string | undefined;
  const travelAt = body.travel_at as string | undefined;
  const direction = (body.direction as string) ?? "pickup";
  const passengers = (body.passengers as number) ?? 1;

  if (!listingId) throw badRequest("listing_id is required");
  if (!travelAt || Number.isNaN(Date.parse(travelAt))) {
    throw badRequest("travel_at must be a valid timestamp");
  }
  if (!["pickup", "dropoff"].includes(direction)) {
    throw badRequest("direction must be pickup or dropoff");
  }
  if (!Number.isInteger(passengers) || passengers < 1) {
    throw unprocessable("passengers must be a positive integer");
  }

  const { data, error } = await admin.rpc("book_transfer", {
    p_listing_id: listingId,
    p_corporate_id: actor.corporateId,
    p_actor_id: actor.recordId,
    p_direction: direction,
    p_travel_at: travelAt,
    p_flight_no: (body.flight_no as string) ?? null,
    p_passengers: passengers,
    p_pickup: (body.pickup_point as string) ?? null,
    p_dropoff: (body.dropoff_point as string) ?? null,
  });

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("route_not_found")) throw notFound("Route not found");
    if (msg.includes("vendor_not_live")) throw conflict("This operator is not currently bookable");
    if (msg.includes("travel_in_past")) throw unprocessable("Travel time is in the past");
    if (msg.includes("too_many_passengers")) {
      throw unprocessable("Too many passengers for this vehicle class");
    }
    if (msg.includes("no_route_rate")) throw unprocessable("Route has no contracted price");
    throw unprocessable(`transfer booking failed: ${msg}`);
  }

  // Audit + notifications are inside the transaction.
  return data;
});
