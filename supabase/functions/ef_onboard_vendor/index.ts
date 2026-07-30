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
  description?: string | null;
  bed_config?: string | null;
  size_sqm?: number | null;
  rates?: Record<string, number>; // { P1: 18000, P2: 21000, ... } integer PKR
}

interface MediaInput {
  storage_path: string;
  /** NULL/absent = property-level photo; set = photo of that room type. */
  listing_name?: string | null;
  caption?: string | null;
  sort?: number;
  is_cover?: boolean;
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

  const mediaIn = body.media as MediaInput[] | undefined;
  if (mediaIn) {
    for (const m of mediaIn) {
      if (!m.storage_path?.trim()) throw badRequest("every media row needs storage_path");
    }
    if (mediaIn.filter((m) => m.is_cover && !m.listing_name).length > 1) {
      throw unprocessable("only one property-level photo can be the cover");
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
    // Property profile (migration 006) — the OTA-grade page above the fold.
    description: vendorIn.description ?? null,
    property_subtype: vendorIn.property_subtype ?? null,
    address: vendorIn.address ?? null,
    phone: vendorIn.phone ?? null,
    checkin_time: vendorIn.checkin_time ?? null,
    checkout_time: vendorIn.checkout_time ?? null,
    cancellation_policy: vendorIn.cancellation_policy ?? null,
    noshow_policy: vendorIn.noshow_policy ?? null,
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
  const listingIdByName = new Map<string, string>();
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
          description: l.description ?? null,
          bed_config: l.bed_config ?? null,
          size_sqm: l.size_sqm ?? null,
        },
        { onConflict: "vendor_id,name" },
      )
      .select("id")
      .single();
    if (error) throw unprocessable(`listing ${l.name}: ${error.message}`);
    listingIdByName.set(l.name.trim(), listing.id);

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

  // ---- write: media registry (replace-all when key present) ---------------
  // Files are uploaded to the private `media` bucket by the ops console before
  // this call; here we only (re)register the rows that give them order,
  // captions and the cover flag. Orphaned storage objects are swept at M8.
  if (mediaIn) {
    await admin.from("media").delete().eq("vendor_id", vendorId);
    if (mediaIn.length) {
      const rows = mediaIn.map((m, i) => {
        const listingId = m.listing_name
          ? listingIdByName.get(m.listing_name.trim()) ?? null
          : null;
        if (m.listing_name && !listingId) {
          throw unprocessable(`media references unknown listing ${m.listing_name}`);
        }
        return {
          vendor_id: vendorId,
          listing_id: listingId,
          storage_path: m.storage_path.trim(),
          caption: m.caption ?? null,
          sort: m.sort ?? i,
          is_cover: m.is_cover ?? false,
        };
      });
      const { error } = await admin.from("media").insert(rows);
      if (error) throw unprocessable(`media: ${error.message}`);
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
        media: mediaIn?.length ?? "untouched",
        agreement: agreementIn ? true : false,
      },
    },
  });

  // ---- respond: full snapshot ---------------------------------------------
  const [vendor, listings, rates, vendorAmenities, inclusions, addons, agreements, media] =
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
      admin.from("media").select("*").eq("vendor_id", vendorId).order("sort"),
    ]);

  return {
    vendor: vendor.data,
    listings: listings.data ?? [],
    rates: (rates.data ?? []).map(({ listings: _l, ...r }) => r),
    amenities: vendorAmenities.data ?? [],
    inclusions: inclusions.data ?? [],
    addons: addons.data ?? [],
    agreements: agreements.data ?? [],
    media: media.data ?? [],
  };
});
