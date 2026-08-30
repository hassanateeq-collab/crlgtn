import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { pkrPlain } from '@/lib/format'
import { sendRfq, ApiError, type BookingFile } from '@/lib/api'
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
  V1: 'Self-drive',
  V2: 'With driver',
  V3: 'Driver + fuel',
}

const PKG_ORDER = ['P1', 'P2', 'P3', 'V1', 'V2', 'V3'] as const

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
  const [sending, setSending] = useState(false)

  async function send() {
    if (!file || selection.length === 0) return
    setSending(true)
    setError(null)
    try {
      await sendRfq(
        file.id,
        selection.map((s, i) => ({
          vendor_id: s.vendorId,
          listing_id: s.listingId,
          package_code: s.packageCode,
          priority: i + 1,
        })),
      )
      // Straight to the board — the countdown is already running.
      navigate(`/files/${file.id}`)
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : 'Sending failed')
      setSending(false)
    }
  }

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
          .eq('vendor_type', bf.service === 'car' ? 'rent_a_car' : 'hotel'),
        supabase
          .from('listings')
          .select('id, vendor_id, name, max_occupancy, bed_config')
          .eq('active', true)
          .eq('listing_type', bf.service === 'car' ? 'vehicle' : 'room_type'),
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
  const nights = useMemo(() => {
    if (!file) return null
    const n = Math.round(
      (new Date(file.check_out).getTime() - new Date(file.check_in).getTime()) / 86_400_000,
    )
    return n > 0 ? n : null
  }, [file])
  const unitCount = file?.rooms.length ?? 1

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
          PKG_ORDER.some((p) => resolveRate(l.id, p) !== null),
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
    const pkg = PKG_ORDER.find((p) => resolveRate(l.id, p))
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

  return (
    <div className="space-y-6 pb-28">
      <nav className="text-xs text-ink/50">
        <Link to="/files" className="hover:text-ink">Booking files</Link>
        {' / '}
        <Link to={`/files/${file.id}`} className="hover:text-ink">{file.ref}</Link>
        {' / results'}
      </nav>

      {/* Atlas header: title + the file's constraints as filter chips. */}
      <div className="flex flex-wrap items-center gap-2.5">
        <h1 className="mr-auto font-display text-2xl font-bold tracking-tight">
          {file.service === 'car' ? 'Vehicles' : 'Hotels'} for {file.name}
        </h1>
        {file.dealbreakers.map((c) => (
          <span
            key={c}
            className="rounded-full bg-deep px-4 py-2 text-xs font-medium text-paper"
          >
            {amenityLabels.get(c) ?? c} ✓
          </span>
        ))}
        {file.corridor_id && (
          <span className="rounded-full border border-hairline bg-white px-4 py-2 text-xs font-medium text-deep">
            {corridorNames.get(file.corridor_id) ?? 'Corridor'}
          </span>
        )}
        <span className="rounded-full border border-hairline bg-white px-4 py-2 text-xs font-medium text-ink/60">
          {matches.length} match{matches.length === 1 ? '' : 'es'}
        </span>
      </div>

      {capMessage && (
        <Notice>
          A request goes to at most 3 hotels — that keeps every offer a serious one.
          Deselect a hotel to swap another in.
        </Notice>
      )}

      {matches.length === 0 && (
        <p className="rounded-2xl border border-dashed border-hairline p-12 text-center text-sm text-ink/50">
          No hotels match this corridor and deal-breaker combination. Loosen a
          deal-breaker or widen the corridor in the file.
        </p>
      )}

      <div className="space-y-8">
        {matches.map(({ vendor, listings: vls }) => {
          const pick = pickFor(vendor.id)!
          const pickedListing = vls.find((l) => l.id === pick.listingId)
          const resolved = resolveRate(pick.listingId, pick.pkg)
          const selected = selection.find((s) => s.vendorId === vendor.id)
          const priority = selected ? selection.indexOf(selected) + 1 : null
          const amenityChips = [...(verifiedByVendor.get(vendor.id) ?? [])]
          const inclusions = inclusionsByVendor.get(vendor.id) ?? []
          const cover = covers.get(vendor.id)

          return (
            <article
              key={vendor.id}
              className={`overflow-hidden rounded-[20px] bg-white shadow-[0_1px_2px_rgba(20,36,31,.06),0_12px_32px_-12px_rgba(20,36,31,.18)] transition-shadow ${
                selected ? 'ring-2 ring-pine' : ''
              }`}
            >
              {/* ---- photo hero with overlaid identity + floating rate ---- */}
              <div className="relative aspect-[21/8] min-h-44 bg-gradient-to-br from-[#0d332b] via-pine to-[#48806f]">
                {cover && (
                  <img
                    src={cover}
                    alt={vendor.name}
                    className="absolute inset-0 size-full object-cover"
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-[rgba(10,25,20,.75)] via-transparent to-transparent" />
                {selected && (
                  <span className="tabular absolute left-5 top-4 flex size-9 items-center justify-center rounded-full bg-brass font-display text-base font-bold text-white shadow-lg">
                    {priority}
                  </span>
                )}
                <div className="absolute bottom-5 left-6 right-40 text-white">
                  <Link
                    to={`/property/${vendor.id}`}
                    className="font-display text-2xl font-bold tracking-tight hover:underline sm:text-3xl"
                  >
                    {vendor.name}
                  </Link>
                  <div className="mt-1.5 text-[13px] opacity-95">
                    {vendor.stars_assigned && (
                      <span className="tracking-wider text-[#e8c789]">
                        {'★'.repeat(vendor.stars_assigned)}
                      </span>
                    )}
                    <span className="ml-2">
                      {[vendor.property_subtype, corridorNames.get(vendor.corridor_id ?? ''),
                        vendor.price_bracket?.toUpperCase()]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    <Link
                      to={`/property/${vendor.id}`}
                      className="ml-2 underline underline-offset-2 hover:text-[#e8c789]"
                    >
                      view property
                    </Link>
                  </div>
                </div>
                {resolved && (
                  <div className="absolute -bottom-7 right-6 rounded-2xl bg-ink px-5 py-3.5 text-right text-white shadow-[0_10px_24px_-8px_rgba(20,36,31,.5)]">
                    {resolved.negotiated && (
                      <div className="font-mono text-[9px] font-semibold uppercase tracking-[.16em] text-[#e8c789]">
                        Your rate
                      </div>
                    )}
                    <div className="font-display text-2xl font-bold leading-tight">
                      PKR {pkrPlain(resolved.rate)}
                    </div>
                    <div className="text-[10.5px] opacity-75">
                      {PACKAGE_LABELS[pick.pkg].toLowerCase()} · per{' '}
                      {file.service === 'car' ? 'day' : 'night'}
                    </div>
                  </div>
                )}
              </div>

              {/* ---- body: story left, room selector right ---- */}
              <div className="flex flex-col gap-6 px-6 pb-6 pt-10 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  {vendor.description && (
                    <p className="max-w-[56ch] text-sm leading-relaxed text-[#41524a]">
                      {vendor.description}
                    </p>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {amenityChips.map((code) => (
                      <span
                        key={code}
                        className="inline-flex items-center gap-1.5 rounded-full bg-sage px-3.5 py-1.5 text-xs font-semibold text-deep"
                      >
                        ✓ {amenityLabels.get(code) ?? code}
                      </span>
                    ))}
                  </div>
                  {inclusions.length > 0 && (
                    <p className="mt-3 text-xs text-ink/50">
                      Included: {inclusions.join(' · ')}
                    </p>
                  )}
                </div>

                <div className="w-full shrink-0 rounded-2xl border border-hairline p-4 sm:w-80">
                  {vls.length > 1 ? (
                    <select
                      className="w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm font-semibold text-ink focus:border-pine focus:outline-none"
                      value={pick.listingId}
                      onChange={(e) =>
                        setPicks((p) =>
                          new Map(p).set(vendor.id, { listingId: e.target.value, pkg: pick.pkg }),
                        )
                      }
                    >
                      {vls.map((l) => (
                        <option key={l.id} value={l.id}>{l.name}</option>
                      ))}
                    </select>
                  ) : (
                    <div className="text-sm font-bold">{pickedListing?.name}</div>
                  )}
                  <div className="mb-3 mt-1.5 text-xs text-ink/50">
                    {[pickedListing?.bed_config,
                      pickedListing
                        ? `${file.service === 'car' ? 'seats' : 'sleeps'} ${pickedListing.max_occupancy}`
                        : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>

                  {/* The rate ladder (approved listing design): every package
                      with per-night AND whole-trip totals; brass dot marks the
                      negotiated row. */}
                  <div className="mb-3 overflow-hidden rounded-xl border border-hairline">
                    {PKG_ORDER.map((p) => {
                      const r = resolveRate(pick.listingId, p)
                      if (!r) return null
                      const on = pick.pkg === p
                      const trip = nights ? r.rate * nights * unitCount : null
                      return (
                        <button
                          key={p}
                          type="button"
                          className={`flex w-full items-center gap-2 border-b border-paper px-3 py-2.5 text-left last:border-0 ${
                            on ? 'bg-[#FBF7EE]' : 'hover:bg-paper'
                          }`}
                          onClick={() =>
                            setPicks((m) =>
                              new Map(m).set(vendor.id, { listingId: pick.listingId, pkg: p }),
                            )
                          }
                        >
                          <span
                            aria-hidden
                            className={`grid size-4 flex-none place-items-center rounded-full border-[1.5px] ${
                              on ? 'border-deep' : 'border-hairline'
                            }`}
                          >
                            {on && <span className="size-2 rounded-full bg-deep" />}
                          </span>
                          <span className="min-w-0 flex-1 text-[12.5px] font-semibold">
                            {PACKAGE_LABELS[p]}
                          </span>
                          <span className="text-right">
                            <span className="tabular block text-[13px] font-semibold text-deep">
                              {r.negotiated && <span className="mr-1 text-brass">●</span>}
                              {pkrPlain(r.rate)}
                            </span>
                            {trip !== null && (
                              <span className="tabular block text-[10.5px] text-ink/50">
                                ≈ {pkrPlain(trip)} trip
                              </span>
                            )}
                          </span>
                        </button>
                      )
                    })}
                  </div>

                  <Button
                    type="button"
                    variant={selected ? 'ghost' : 'primary'}
                    className="w-full !rounded-xl !py-3"
                    onClick={() => toggleSelect(vendor.id, vendor.name)}
                  >
                    {selected ? `Selected — priority ${priority}` : 'Select this hotel'}
                  </Button>
                  <p className="mt-2 text-center text-[11px] text-ink/45">
                    Offers back in 15 minutes — never booked without you
                  </p>
                </div>
              </div>
            </article>
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
              {/* "Offers back in 15 minutes" — never "booked in 15" (spec §2). */}
              <Button type="button" disabled={sending} onClick={send}>
                {sending ? 'Sending…' : 'Send request — offers in 15 minutes'}
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
