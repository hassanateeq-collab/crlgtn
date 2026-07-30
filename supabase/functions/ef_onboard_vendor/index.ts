/**
 * ef_onboard_vendor (M1) — the ops onboarding flow in one call:
 * vendor → listings → base-catalog rates → amenity checklist → agreement record.
 *
 * Ops-only. Non-destructive by default: listings are upserted by name and
 * never deleted (deactivate with active:false); inclusions/addons use
 * replace-all semantics only when their key is present in the payload;
 * each agreement submission appends a new versioned row.
 *
 * Rates land in the base catalog (corporate_id NULL). Negotiated per-corporate
 * deals are Phase 2 tooling; nothing here writes them.
 */

import { serveEdge, type EdgeContext } from "../_shared/handler.ts";
import { writeAudit } from "../_shared/audit.ts";
import { isOps } from "../_shared/context.ts";
import { badRequest, forbidden, unprocessable } from "../_shared/errors.ts";

interface ListingInput {
  name: string;
  listing_type?: string;
  max_occupancy?: number;
  active?: boolean;
  rates?: Record<string, number>; // { P1: 18000, P2: 21000, ... } integer PKR
}

serveEdge("ef_onboard_vendor", async ({ admin, actor, body, functionName }: EdgeContext) => {
  // ---- validate -----------------------------------------------------------
  if (!isOps(actor)) throw forbidden("Vendor onboarding is an ops action");

  const vendorIn = body.vendor as Record<string, unknown> | undefined;
  if (!vendorIn || typeof vendorIn.name !== "string" || !vendorIn.name.trim()) {
    throw badRequest("vendor.name is required");
  }

  const listingsIn = (body.listings ?? []) as ListingInput[];
  if (!Array.isArray(listingsIn)) throw badRequest("listings must be an array");
  for (const l of listingsIn) {
    if (!l.name?.trim()) throw badRequest("every listing needs a name");
    for (const [code, rate] of Object.entries(l.rates ?? {})) {
      if (!/^P[1-9]$/.test(code)) throw unprocessable(`unknown package code ${code}`);
      if (!Number.isInteger(rate) || rate <= 0) {
        throw unprocessable(`rate for ${l.name}/${code} must be a positive integer (PKR)`);
      }
    }
  }

  const amenitiesIn = (body.amenities ?? []) as { code: string; verified: boolean }[];
  const inclusionsIn = body.inclusions as string[] | undefined;
  const addonsIn = body.addons as
    | { label: string; price_pkr: number; unit?: string }[]
    | undefined;
  const agreementIn = body.agreement as Record<string, unknown> | undefined;

  if (addonsIn) {
    for (const a of addonsIn) {
      if (!a.label?.trim()) throw badRequest("every addon needs a label");
      if (!Number.isInteger(a.price_pkr) || a.price_pkr < 0) {
        throw unprocessable(`addon ${a.label}: price_pkr must be a non-negative integer`);
      }
    }
  }

  // ---- write: vendor ------------------------------------------------------
  const vendorRow = {
    vendor_type: vendorIn.vendor_type ?? "hotel",
    name: (vendorIn.name as string).trim(),
    status: vendorIn.status ?? "prospect",
    corridor_id: vendorIn.corridor_id ?? null,
    stars_assigned: vendorIn.stars_assigned ?? null,
    price_bracket: vendorIn.price_bracket ?? null,
    commission_pct: vendorIn.commission_pct ?? null,
    notes: vendorIn.notes ?? null,
  };

  let vendorId = vendorIn.id as string | undefined;
  if (vendorId) {
    const { error } = await admin.from("vendors").update(vendorRow).eq("id", vendorId);
    if (error) throw unprocessable(`vendor update failed: ${error.message}`);
  } else {
    const { data, error } = await admin
      .from("vendors").insert(vendorRow).select("id").single();
    if (error) throw unprocessable(`vendor insert failed: ${error.message}`);
    vendorId = data.id;
  }

  // ---- write: listings + base rates --------------------------------------
  for (const l of listingsIn) {
    const { data: listing, error } = await admin
      .from("listings")
      .upsert(
        {
          vendor_id: vendorId,
          name: l.name.trim(),
          listing_type: l.listing_type ?? "room_type",
          max_occupancy: l.max_occupancy ?? 2,
          active: l.active ?? true,
        },
        { onConflict: "vendor_id,name" },
      )
      .select("id")
      .single();
    if (error) throw unprocessable(`listing ${l.name}: ${error.message}`);

    for (const [code, rate] of Object.entries(l.rates ?? {})) {
      // Replace the open-ended base rate for this listing+package. History via
      // valid_to windows is Phase 2; M1 is manual rate entry by ops.
      const { error: delErr } = await admin
        .from("listing_rates")
        .delete()
        .eq("listing_id", listing.id)
        .eq("package_code", code)
        .is("corporate_id", null)
        .is("valid_to", null);
      if (delErr) throw unprocessable(`rate ${l.name}/${code}: ${delErr.message}`);

      const { error: insErr } = await admin.from("listing_rates").insert({
        listing_id: listing.id,
        package_code: code,
        corporate_id: null,
        rate_pkr: rate,
      });
      if (insErr) throw unprocessable(`rate ${l.name}/${code}: ${insErr.message}`);
    }
  }

  // ---- write: amenity checklist -------------------------------------------
  for (const a of amenitiesIn) {
    const { data: amenity } = await admin
      .from("amenities").select("id").eq("code", a.code).maybeSingle();
    if (!amenity) throw unprocessable(`unknown amenity code ${a.code}`);

    const { error } = await admin.from("vendor_amenities").upsert(
      {
        vendor_id: vendorId,
        amenity_id: amenity.id,
        // The onboarding visit is what verifies (spec §2). Unverified claims
        // stay invisible to corporates via RLS.
        verified_at: a.verified ? new Date().toISOString() : null,
        verified_by: a.verified ? actor.recordId : null,
      },
      { onConflict: "vendor_id,amenity_id" },
    );
    if (error) throw unprocessable(`amenity ${a.code}: ${error.message}`);
  }

  // ---- write: inclusions / addons (replace-all when key present) ----------
  if (inclusionsIn) {
    await admin.from("inclusions").delete().eq("vendor_id", vendorId);
    if (inclusionsIn.length) {
      const { error } = await admin.from("inclusions").insert(
        inclusionsIn.filter((s) => s?.trim()).map((label) => ({
          vendor_id: vendorId, label: label.trim(),
        })),
      );
      if (error) throw unprocessable(`inclusions: ${error.message}`);
    }
  }

  if (addonsIn) {
    await admin.from("addons").delete().eq("vendor_id", vendorId);
    if (addonsIn.length) {
      const { error } = await admin.from("addons").insert(
        addonsIn.map((a) => ({
          vendor_id: vendorId,
          label: a.label.trim(),
          price_pkr: a.price_pkr,
          unit: a.unit ?? "per_stay",
        })),
      );
      if (error) throw unprocessable(`addons: ${error.message}`);
    }
  }

  // ---- write: agreement record (append, never overwrite) ------------------
  if (agreementIn) {
    const { error } = await admin.from("agreements").insert({
      party_type: "vendor",
      party_id: vendorId,
      tier: agreementIn.tier ?? null,
      version: agreementIn.version ?? "v1",
      doc_url: agreementIn.doc_url ?? null,
      signed_digital_at: agreementIn.signed_digital_at ?? null,
      signed_physical_at: agreementIn.signed_physical_at ?? null,
    });
    if (error) throw unprocessable(`agreement: ${error.message}`);
  }

  // ---- audit ---------------------------------------------------------------
  await writeAudit(admin, actor, {
    action: functionName,
    entity: "vendors",
    entityId: vendorId,
    diff: {
      after: {
        vendor: vendorRow,
        listings: listingsIn.length,
        amenities: amenitiesIn.length,
        inclusions: inclusionsIn?.length ?? "untouched",
        addons: addonsIn?.length ?? "untouched",
        agreement: agreementIn ? true : false,
      },
    },
  });

  // ---- respond: full snapshot ---------------------------------------------
  const [vendor, listings, rates, vendorAmenities, inclusions, addons, agreements] =
    await Promise.all([
      admin.from("vendors").select("*").eq("id", vendorId).single(),
      admin.from("listings").select("*").eq("vendor_id", vendorId).order("name"),
      admin
        .from("listing_rates")
        .select("*, listings!inner(vendor_id)")
        .eq("listings.vendor_id", vendorId),
      admin
        .from("vendor_amenities")
        .select("verified_at, amenities(code, label)")
        .eq("vendor_id", vendorId),
      admin.from("inclusions").select("id, label").eq("vendor_id", vendorId),
      admin.from("addons").select("id, label, price_pkr, unit").eq("vendor_id", vendorId),
      admin
        .from("agreements")
        .select("*")
        .eq("party_type", "vendor")
        .eq("party_id", vendorId)
        .order("created_at", { ascending: false }),
    ]);

  return {
    vendor: vendor.data,
    listings: listings.data ?? [],
    rates: (rates.data ?? []).map(({ listings: _l, ...r }) => r),
    amenities: vendorAmenities.data ?? [],
    inclusions: inclusions.data ?? [],
    addons: addons.data ?? [],
    agreements: agreements.data ?? [],
  };
});
