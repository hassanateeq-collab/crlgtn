import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { pkrPlain } from '@/lib/format'
import type { BookingFile } from '@/lib/api'
import { Button, Notice } from '@/components/ui'

/**
 * Results (M3, spec §9): live hotels ∩ file corridor ∩ verified deal-breakers,
 * rendered as cards with per-corporate rate resolution — the negotiated row
 * wins over base wherever one exists. RLS has already trimmed everything this
 * page can see (live vendors, verified amenities, own negotiated rates), so
 * the filtering here is business logic, not security.
 *
 * Selection: up to 3 hotels in priority order (spec §2 request cap); the
 * fourth click gets the explanatory message, not a silent no-op.
 */

interface VendorRow {
  id: string
  name: string
  property_subtype: string | null
  stars_assigned: number | null
  price_bracket: string | null
  corridor_id: string | null
  description: string | null
}

interface ListingRow {
  id: string
  vendor_id: string
  name: string
  max_occupancy: number
  bed_config: string | null
}

interface RateRow {
  listing_id: string
  package_code: string
  rate_pkr: number
  corporate_id: string | null
}

export interface Selection {
  vendorId: string
  vendorName: string
  listingId: string
  packageCode: string
  ratePkr: number
  negotiated: boolean
}

const PACKAGE_LABELS: Record<string, string> = {
  P1: 'Room only',
  P2: 'Room + breakfast',
  P3: 'Room + half board',
}

export function Results() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [file, setFile] = useState<BookingFile | null>(null)
  const [vendors, setVendors] = useState<VendorRow[]>([])
  const [listings, setListings] = useState<ListingRow[]>([])
  const [rates, setRates] = useState<RateRow[]>([])
  const [verifiedByVendor, setVerifiedByVendor] = useState<Map<string, Set<string>>>(new Map())
  const [amenityLabels, setAmenityLabels] = useState<Map<string, string>>(new Map())
  const [inclusionsByVendor, setInclusionsByVendor] = useState<Map<string, string[]>>(new Map())
  const [covers, setCovers] = useState<Map<string, string>>(new Map())
  const [corridorNames, setCorridorNames] = useState<Map<string, string>>(new Map())
  const [myCorporateId, setMyCorporateId] = useState<string | null>(null)

  // Per-vendor room/package picks and the priority-ordered selection.
  const [picks, setPicks] = useState<Map<string, { listingId: string; pkg: string }>>(new Map())
  const [selection, setSelection] = useState<Selection[]>([])
  const [capMessage, setCapMessage] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    async function load() {
      const f = await supabase.from('booking_files').select('*').eq('id', id).single()
      if (f.error) { setError(f.error.message); return }
      const bf = f.data as BookingFile
      setFile(bf)

      const [me, v, ls, lr, va, inc, med, cor] = await Promise.all([
        supabase.from('corporate_users').select('corporate_id').limit(1).maybeSingle(),
        supabase
          .from('vendors')
          .select('id, name, property_subtype, stars_assigned, price_bracket, corridor_id, description')
          .eq('vendor_type', 'hotel'),
        supabase.from('listings').select('id, vendor_id, name, max_occupancy, bed_config').eq('active', true),
        supabase
          .from('listing_rates')
          .select('listing_id, package_code, rate_pkr, corporate_id')
          .is('valid_to', null),
        supabase.from('vendor_amenities').select('vendor_id, amenities(code, label)'),
        supabase.from('inclusions').select('vendor_id, label'),
        supabase.from('media').select('vendor_id, storage_path, is_cover, sort').is('listing_id', null),
        supabase.from('corridors').select('id, name'),
      ])

      setMyCorporateId(me.data?.corporate_id ?? null)
      setVendors((v.data ?? []) as VendorRow[])
      setListings((ls.data ?? []) as ListingRow[])
      setRates((lr.data ?? []) as RateRow[])
      setCorridorNames(new Map((cor.data ?? []).map((c) => [c.id, c.name])))

      const vMap = new Map<string, Set<string>>()
      const labels = new Map<string, string>()
      for (const row of (va.data ?? []) as unknown as {
        vendor_id: string
        amenities: { code: string; label: string } | null
      }[]) {
        if (!row.amenities) continue
        if (!vMap.has(row.vendor_id)) vMap.set(row.vendor_id, new Set())
        vMap.get(row.vendor_id)!.add(row.amenities.code)
        labels.set(row.amenities.code, row.amenities.label)
      }
      setVerifiedByVendor(vMap)
      setAmenityLabels(labels)

      const iMap = new Map<string, string[]>()
      for (const row of inc.data ?? []) {
        iMap.set(row.vendor_id, [...(iMap.get(row.vendor_id) ?? []), row.label])
      }
      setInclusionsByVendor(iMap)

      // One cover (or first photo) per vendor, signed.
      const best = new Map<string, { storage_path: string; is_cover: boolean; sort: number }>()
      for (const m of med.data ?? []) {
        const cur = best.get(m.vendor_id)
        if (!cur || (m.is_cover && !cur.is_cover) || (m.is_cover === cur.is_cover && m.sort < cur.sort)) {
          best.set(m.vendor_id, m)
        }
      }
      const entries = [...best.entries()]
      if (entries.length) {
        const { data: signed } = await supabase.storage
          .from('media')
          .createSignedUrls(entries.map(([, m]) => m.storage_path), 3600)
        const cMap = new Map<string, string>()
        entries.forEach(([vid], i) => {
          const url = signed?.[i]?.signedUrl
          if (url) cMap.set(vid, url)
        })
        setCovers(cMap)
      }
      setLoaded(true)
    }
    load()
  }, [id])

  // Largest single room request decides which listings fit.
  const maxGuests = useMemo(
    () => Math.max(1, ...(file?.rooms ?? []).map((r) => r.guests)),
    [file],
  )

  /** Negotiated wins over base; absent means the package is not offered. */
  const resolveRate = (listingId: string, pkg: string): { rate: number; negotiated: boolean } | null => {
    let base: number | null = null
    let negotiated: number | null = null
    for (const r of rates) {
      if (r.listing_id !== listingId || r.package_code !== pkg) continue
      if (r.corporate_id === null) base = r.rate_pkr
      else if (r.corporate_id === myCorporateId) negotiated = r.rate_pkr
    }
    if (negotiated !== null) return { rate: negotiated, negotiated: true }
    if (base !== null) return { rate: base, negotiated: false }
    return null
  }

  const matches = useMemo(() => {
    if (!file) return []
    return vendors
      .filter((v) => !file.corridor_id || v.corridor_id === file.corridor_id)
      .filter((v) =>
        (file.dealbreakers ?? []).every((code) => verifiedByVendor.get(v.id)?.has(code)),
      )
      .map((v) => {
        const fitListings = listings.filter(
          (l) => l.vendor_id === v.id && l.max_occupancy >= maxGuests,
        )
        // A hotel with no room that fits and prices is not a result.
        const usable = fitListings.filter((l) =>
          ['P1', 'P2', 'P3'].some((p) => resolveRate(l.id, p) !== null),
        )
        return { vendor: v, listings: usable }
      })
      .filter((m) => m.listings.length > 0)
      .sort((a, b) => (b.vendor.stars_assigned ?? 0) - (a.vendor.stars_assigned ?? 0))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, vendors, listings, rates, verifiedByVendor, maxGuests, myCorporateId])

  function pickFor(vendorId: string): { listingId: string; pkg: string } | null {
    const explicit = picks.get(vendorId)
    if (explicit) return explicit
    const m = matches.find((x) => x.vendor.id === vendorId)
    if (!m) return null
    const l = m.listings[0]
    const pkg = (['P1', 'P2', 'P3'] as const).find((p) => resolveRate(l.id, p))
    return pkg ? { listingId: l.id, pkg } : null
  }

  function toggleSelect(vendorId: string, vendorName: string) {
    const existing = selection.find((s) => s.vendorId === vendorId)
    if (existing) {
      setSelection((sel) => sel.filter((s) => s.vendorId !== vendorId))
      setCapMessage(false)
      return
    }
    if (selection.length >= 3) {
      setCapMessage(true)
      return
    }
    const pick = pickFor(vendorId)
    if (!pick) return
    const resolved = resolveRate(pick.listingId, pick.pkg)
    if (!resolved) return
    setSelection((sel) => [
      ...sel,
      {
        vendorId,
        vendorName,
        listingId: pick.listingId,
        packageCode: pick.pkg,
        ratePkr: resolved.rate,
        negotiated: resolved.negotiated,
      },
    ])
  }

  if (error) return <Notice tone="error">{error}</Notice>
  if (!loaded || !file) return <p className="text-sm text-ink/50">Searching…</p>

  const selectCls =
    'rounded-md border border-hairline bg-white px-2 py-1.5 text-sm text-ink focus:border-pine focus:outline-none'

  return (
    <div className="space-y-5 pb-28">
      <nav className="text-xs text-ink/50">
        <Link to="/files" className="hover:text-ink">Booking files</Link>
        {' / '}
        <Link to={`/files/${file.id}`} className="hover:text-ink">{file.ref}</Link>
        {' / results'}
      </nav>

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl">Hotels for {file.name}</h1>
        <span className="text-sm text-ink/60">
          {matches.length} match{matches.length === 1 ? '' : 'es'}
          {file.corridor_id && ` · ${corridorNames.get(file.corridor_id) ?? 'corridor'}`}
          {(file.dealbreakers?.length ?? 0) > 0 &&
            ` · must have: ${file.dealbreakers.map((c) => amenityLabels.get(c) ?? c).join(', ')}`}
        </span>
      </div>

      {capMessage && (
        <Notice>
          A request goes to at most 3 hotels — that keeps every offer a serious one.
          Deselect a hotel to swap another in.
        </Notice>
      )}

      {matches.length === 0 && (
        <p className="rounded-lg border border-dashed border-hairline p-10 text-center text-sm text-ink/50">
          No hotels match this corridor and deal-breaker combination. Loosen a
          deal-breaker or widen the corridor in the file.
        </p>
      )}

      <div className="space-y-4">
        {matches.map(({ vendor, listings: vls }) => {
          const pick = pickFor(vendor.id)!
          const resolved = resolveRate(pick.listingId, pick.pkg)
          const selected = selection.find((s) => s.vendorId === vendor.id)
          const priority = selected ? selection.indexOf(selected) + 1 : null
          const amenityChips = [...(verifiedByVendor.get(vendor.id) ?? [])]
          const inclusions = inclusionsByVendor.get(vendor.id) ?? []

          return (
            <div
              key={vendor.id}
              className={`grid gap-4 rounded-lg border bg-white p-4 sm:grid-cols-[10rem_1fr_auto] ${
                selected ? 'border-pine ring-1 ring-pine' : 'border-hairline'
              }`}
            >
              {covers.get(vendor.id) ? (
                <img
                  src={covers.get(vendor.id)}
                  alt={vendor.name}
                  className="aspect-[4/3] w-full rounded object-cover"
                />
              ) : (
                <div className="hidden aspect-[4/3] items-center justify-center rounded bg-sage text-xs text-ink/40 sm:flex">
                  No photo
                </div>
              )}

              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <Link
                    to={`/property/${vendor.id}`}
                    className="text-base font-semibold text-deep hover:underline"
                  >
                    {vendor.name}
                  </Link>
                  {vendor.stars_assigned && (
                    <span className="text-sm text-brass">{'★'.repeat(vendor.stars_assigned)}</span>
                  )}
                  <span className="text-xs text-ink/50">
                    {[vendor.property_subtype, corridorNames.get(vendor.corridor_id ?? '')]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {vendor.price_bracket && (
                    <span className="tabular rounded-full border border-hairline px-1.5 text-[10px] uppercase">
                      {vendor.price_bracket}
                    </span>
                  )}
                </div>

                {vendor.description && (
                  <p className="mt-1 line-clamp-2 max-w-prose text-sm text-ink/70">
                    {vendor.description}
                  </p>
                )}

                <div className="mt-2 flex flex-wrap gap-1.5">
                  {amenityChips.map((code) => (
                    <span key={code} className="rounded-full bg-sage px-2 py-0.5 text-[11px] text-deep">
                      {amenityLabels.get(code) ?? code} ✓
                    </span>
                  ))}
                  {inclusions.slice(0, 2).map((x) => (
                    <span
                      key={x}
                      className="rounded-full border border-hairline px-2 py-0.5 text-[11px] text-ink/60"
                    >
                      incl. {x}
                    </span>
                  ))}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <select
                    className={selectCls}
                    value={pick.listingId}
                    onChange={(e) =>
                      setPicks((p) =>
                        new Map(p).set(vendor.id, { listingId: e.target.value, pkg: pick.pkg }),
                      )
                    }
                  >
                    {vls.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                        {l.bed_config ? ` · ${l.bed_config}` : ''}
                      </option>
                    ))}
                  </select>
                  <select
                    className={selectCls}
                    value={pick.pkg}
                    onChange={(e) =>
                      setPicks((p) =>
                        new Map(p).set(vendor.id, { listingId: pick.listingId, pkg: e.target.value }),
                      )
                    }
                  >
                    {(['P1', 'P2', 'P3'] as const)
                      .filter((p) => resolveRate(pick.listingId, p) !== null)
                      .map((p) => (
                        <option key={p} value={p}>
                          {p} · {PACKAGE_LABELS[p]}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-row items-center justify-between gap-3 sm:flex-col sm:items-end sm:justify-center">
                {resolved && (
                  <div className="text-right">
                    <div className="tabular text-lg">PKR {pkrPlain(resolved.rate)}</div>
                    <div className="text-[11px] text-ink/50">per night</div>
                    {resolved.negotiated && (
                      <span className="mt-0.5 inline-block rounded-full bg-sage px-2 py-0.5 text-[10px] font-medium text-deep">
                        your corporate rate
                      </span>
                    )}
                  </div>
                )}
                <Button
                  type="button"
                  variant={selected ? 'ghost' : 'primary'}
                  onClick={() => toggleSelect(vendor.id, vendor.name)}
                >
                  {selected ? `Selected · #${priority}` : 'Select'}
                </Button>
              </div>
            </div>
          )
        })}
      </div>

      {/* ---- selection tray -------------------------------------------------- */}
      {selection.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-hairline bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-3">
            <ol className="flex flex-wrap gap-2 text-sm">
              {selection.map((s, i) => (
                <li
                  key={s.vendorId}
                  className="flex items-center gap-2 rounded-full border border-hairline bg-paper px-3 py-1"
                >
                  <span className="tabular flex size-5 items-center justify-center rounded-full bg-pine text-[11px] text-paper">
                    {i + 1}
                  </span>
                  {s.vendorName}
                  <span className="tabular text-xs text-ink/50">
                    {s.packageCode} · {pkrPlain(s.ratePkr)}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${s.vendorName}`}
                    className="text-ink/40 hover:text-ink"
                    onClick={() =>
                      setSelection((sel) => sel.filter((x) => x.vendorId !== s.vendorId))
                    }
                  >
                    ×
                  </button>
                </li>
              ))}
            </ol>
            <div className="flex items-center gap-3">
              <span className="text-xs text-ink/50">{selection.length}/3 hotels</span>
              <Button type="button" disabled title="RFQ sending arrives with the next milestone (M4)">
                Send request — offers in 15 minutes
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="pt-2">
        <Button type="button" variant="ghost" onClick={() => navigate(`/files/${file.id}`)}>
          Back to file
        </Button>
      </div>
    </div>
  )
}
