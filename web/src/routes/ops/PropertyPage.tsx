import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { pkrPlain } from '@/lib/format'
import { CATEGORY_SHOTS, PKG_LABEL, SHOT_LIST } from '@/lib/onboarding'
import { Chip, Notice } from '@/components/atlas'

/**
 * The property page (Atlas v3, per the approved prototype): labeled shot-list
 * gallery with a lightbox, glance tiles, corporate courtesies, room categories
 * with their own galleries and the words-first rate ladder.
 *
 * Built once, used twice: the ops console "what will corporates see" preview
 * and the corporate detail view. RLS trims the data to the caller (live
 * vendors only, own negotiated rates, verified amenities only) — the page
 * never needs to know who is looking.
 */

interface Property {
  id: string
  name: string
  status: string
  property_subtype: string | null
  stars_assigned: number | null
  price_bracket: string | null
  description: string | null
  address: string | null
  phone: string | null
  checkin_time: string | null
  checkout_time: string | null
  cancellation_policy: string | null
  noshow_policy: string | null
  total_rooms: number | null
  airport_transfer_included: boolean
  courtesies: string[]
  corridors: { name: string; city: string; descriptor: string | null } | null
}

interface Room {
  id: string
  name: string
  category: string | null
  max_occupancy: number
  bed_config: string | null
  size_sqm: number | null
  description: string | null
  active: boolean
}

interface MediaItem {
  storage_path: string
  caption: string | null
  is_cover: boolean
  listing_id: string | null
  shot_type: string | null
  url: string
}

const SHOT_LABEL: Record<string, string> = Object.fromEntries([
  ...SHOT_LIST.map((s) => [s.key, s.label]),
  ...CATEGORY_SHOTS.map((s) => [s.key, s.label]),
  ['amenity', 'Amenity'],
  ['exterior', 'Exterior'],
  ['other', ''],
  ['category', ''],
  ['standard_room', 'Standard room'],
  ['wardrobe_desk', 'Wardrobe & desk'],
])

export function PropertyPage() {
  const { id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const inOps = location.pathname.startsWith('/ops')

  const [property, setProperty] = useState<Property | null>(null)
  const [rooms, setRooms] = useState<Room[]>([])
  const [rates, setRates] = useState<Map<string, Record<string, { rate: number; negotiated: boolean }>>>(new Map())
  const [amenities, setAmenities] = useState<{ label: string; verified: boolean }[]>([])
  const [inclusions, setInclusions] = useState<string[]>([])
  const [addons, setAddons] = useState<{ label: string; price_pkr: number; unit: string }[]>([])
  const [media, setMedia] = useState<MediaItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<{ items: MediaItem[]; idx: number } | null>(null)

  useEffect(() => {
    async function load() {
      const [v, ls, lr, va, inc, ad, med, me] = await Promise.all([
        supabase
          .from('vendors')
          .select(
            'id, name, status, property_subtype, stars_assigned, price_bracket, description, address, phone, checkin_time, checkout_time, cancellation_policy, noshow_policy, total_rooms, airport_transfer_included, courtesies, corridors(name, city, descriptor)',
          )
          .eq('id', id)
          .single(),
        supabase.from('listings').select('*').eq('vendor_id', id).order('name'),
        supabase
          .from('listing_rates')
          .select('listing_id, package_code, rate_pkr, corporate_id')
          .is('valid_to', null),
        supabase.from('vendor_amenities').select('verified_at, amenities(label)').eq('vendor_id', id),
        supabase.from('inclusions').select('label').eq('vendor_id', id).order('label'),
        supabase.from('addons').select('label, price_pkr, unit').eq('vendor_id', id).order('label'),
        supabase
          .from('media')
          .select('storage_path, caption, is_cover, listing_id, shot_type')
          .eq('vendor_id', id)
          .order('sort'),
        supabase.from('corporate_users').select('corporate_id').limit(1).maybeSingle(),
      ])
      if (v.error) {
        setError(v.error.message)
        return
      }
      setProperty(v.data as unknown as Property)
      setRooms((ls.data ?? []) as Room[])

      // Negotiated wins over base, exactly as on the results page.
      const myCorp = me.data?.corporate_id ?? null
      const byListing = new Map<string, Record<string, { rate: number; negotiated: boolean }>>()
      for (const r of lr.data ?? []) {
        const m = byListing.get(r.listing_id) ?? {}
        const cur = m[r.package_code]
        if (r.corporate_id === null) {
          if (!cur) m[r.package_code] = { rate: r.rate_pkr, negotiated: false }
        } else if (r.corporate_id === myCorp) {
          m[r.package_code] = { rate: r.rate_pkr, negotiated: true }
        }
        byListing.set(r.listing_id, m)
      }
      setRates(byListing)

      setAmenities(
        ((va.data ?? []) as unknown as { verified_at: string | null; amenities: { label: string } | null }[])
          .filter((x) => x.amenities)
          .map((x) => ({ label: x.amenities!.label, verified: x.verified_at !== null })),
      )
      setInclusions((inc.data ?? []).map((x) => x.label))
      setAddons(ad.data ?? [])

      const medRows = (med.data ?? []) as Omit<MediaItem, 'url'>[]
      if (medRows.length) {
        const { data: signed } = await supabase.storage
          .from('media')
          .createSignedUrls(medRows.map((m) => m.storage_path), 3600)
        setMedia(medRows.map((m, i) => ({ ...m, url: signed?.[i]?.signedUrl ?? '' })))
      }
    }
    load()
  }, [id])

  // Lightbox keyboard: arrows navigate, Escape closes.
  const nav = useCallback(
    (d: number) =>
      setLightbox((lb) => (lb ? { ...lb, idx: (lb.idx + d + lb.items.length) % lb.items.length } : lb)),
    [],
  )
  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null)
      if (e.key === 'ArrowRight') nav(1)
      if (e.key === 'ArrowLeft') nav(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox, nav])

  if (error) return <Notice tone="error">{error}</Notice>
  if (!property) return <p className="text-sm text-ink/50">Loading…</p>

  const propertyPhotos = media.filter((m) => !m.listing_id && m.url)
  const roomPhotos = (roomId: string) => media.filter((m) => m.listing_id === roomId && m.url)
  const label = (m: MediaItem) => SHOT_LABEL[m.shot_type ?? ''] || m.caption || ''
  const open = (items: MediaItem[], idx: number) => items.length && setLightbox({ items, idx })
  const glance: { k: string; v: string }[] = [
    property.total_rooms ? { k: 'Rooms', v: String(property.total_rooms) } : null,
    { k: 'Airport transfer', v: property.airport_transfer_included ? 'Included' : 'On request' },
    property.checkin_time ? { k: 'Check-in from', v: property.checkin_time.slice(0, 5) } : null,
    property.checkout_time ? { k: 'Check-out by', v: property.checkout_time.slice(0, 5) } : null,
  ].filter((x): x is { k: string; v: string } => !!x)

  return (
    <article className="space-y-6">
      <nav className="text-xs text-ink/50">
        {inOps ? (
          <>
            <Link to="/ops/vendors" className="hover:text-ink">Supply</Link>
            {' / '}
            <Link to={`/ops/vendors/${property.id}`} className="hover:text-ink">{property.name}</Link>
            {' / property page'}
          </>
        ) : (
          <button type="button" className="hover:text-ink" onClick={() => navigate(-1)}>
            ← Back to results
          </button>
        )}
      </nav>

      {/* ---- header --------------------------------------------------------- */}
      <header>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-[28px]">{property.name}</h1>
          {property.stars_assigned && (
            <span aria-label={`${property.stars_assigned} stars`} className="tracking-wider text-brass">
              {'★'.repeat(property.stars_assigned)}
            </span>
          )}
          {property.status !== 'live' && inOps && (
            <Chip tone="hot">{property.status} — not visible to corporates</Chip>
          )}
        </div>
        <p className="mt-1 text-sm text-ink/60">
          {[property.property_subtype, property.corridors?.name, property.address].filter(Boolean).join(' · ')}
        </p>
        {property.corridors?.descriptor && (
          <p className="mt-0.5 text-[12.5px] text-ink/50">{property.corridors.descriptor}</p>
        )}
      </header>

      {/* ---- gallery: labeled shot list ------------------------------------- */}
      {propertyPhotos.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {propertyPhotos.slice(0, 8).map((m, i) => (
            <button
              key={m.storage_path}
              type="button"
              className={`group relative overflow-hidden rounded-2xl ${i === 0 ? 'col-span-2 row-span-2' : ''}`}
              onClick={() => open(propertyPhotos, i)}
            >
              <img
                src={m.url}
                alt={label(m) || property.name}
                className={`w-full object-cover transition-transform duration-300 group-hover:scale-[1.03] ${
                  i === 0 ? 'aspect-[4/3] sm:h-full' : 'aspect-[4/3]'
                }`}
              />
              {label(m) && (
                <span className="absolute bottom-2 left-2 rounded-full bg-white/95 px-2.5 py-0.5 text-[11px] font-semibold text-deep">
                  {label(m)}
                </span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex aspect-[21/9] items-center justify-center rounded-2xl border border-dashed border-hairline text-sm text-ink/40">
          Photography pending — the shot list is part of onboarding
        </div>
      )}

      {/* ---- glance + description ------------------------------------------- */}
      <div className="grid items-start gap-5 lg:grid-cols-[1fr_300px]">
        <div className="space-y-5">
          {glance.length > 0 && (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {glance.map((g) => (
                <div key={g.k} className="rounded-2xl bg-white px-3.5 py-3 shadow-[0_1px_3px_rgba(20,36,31,.05)]">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-ink/55">{g.k}</div>
                  <div className="font-display text-[17px] font-semibold text-deep">{g.v}</div>
                </div>
              ))}
            </div>
          )}

          {property.description && (
            <p className="max-w-[68ch] text-[15px] leading-relaxed">{property.description}</p>
          )}

          {amenities.length > 0 && (
            <section>
              <h2 className="mb-2 text-[17px]">Verified on site</h2>
              <ul className="flex flex-wrap gap-2">
                {amenities.map((a) => (
                  <li key={a.label}>
                    {a.verified ? (
                      <Chip tone="ok">✓ {a.label}</Chip>
                    ) : inOps ? (
                      <span className="rounded-full border border-dashed border-hairline px-3 py-1 text-xs text-ink/40">
                        {a.label} — unverified, hidden from corporates
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {property.courtesies.length > 0 && (
            <section>
              <h2 className="mb-2 text-[17px]">Corporate courtesies</h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {property.courtesies.map((c) => (
                  <div key={c} className="rounded-xl bg-white px-3 py-2.5 text-[13px] shadow-[0_1px_3px_rgba(20,36,31,.05)]">
                    {c}
                  </div>
                ))}
              </div>
            </section>
          )}

          {inclusions.length > 0 && (
            <p className="text-[13px] text-ink/60">
              <span className="font-semibold text-ink">Included with every stay:</span> {inclusions.join(' · ')}
            </p>
          )}
        </div>

        <aside className="rounded-[20px] bg-white p-5 text-sm shadow-[0_1px_3px_rgba(20,36,31,.05),0_14px_36px_-22px_rgba(20,36,31,.16)] lg:sticky lg:top-[76px]">
          <h2 className="mb-3 text-[15px]">Good to know</h2>
          <dl className="space-y-2.5">
            {property.cancellation_policy && (
              <div>
                <dt className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-ink/55">Cancellation</dt>
                <dd className="mt-0.5 text-[13px]">{property.cancellation_policy}</dd>
              </div>
            )}
            {property.noshow_policy && (
              <div>
                <dt className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-ink/55">No-show</dt>
                <dd className="mt-0.5 text-[13px]">{property.noshow_policy}</dd>
              </div>
            )}
            <div>
              <dt className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-ink/55">Payment</dt>
              <dd className="mt-0.5 text-[13px]">
                Bill to company — nothing payable at the desk except personal extras.
              </dd>
            </div>
          </dl>
          {addons.length > 0 && (
            <>
              <h3 className="mb-1.5 mt-4 text-[11.5px] font-semibold uppercase tracking-[0.04em] text-ink/55">
                Paid add-ons
              </h3>
              <ul className="space-y-1 text-[13px]">
                {addons.map((a) => (
                  <li key={a.label} className="flex justify-between gap-3">
                    <span>{a.label}</span>
                    <span className="tabular whitespace-nowrap text-deep">
                      {pkrPlain(a.price_pkr)} <span className="text-ink/45">{a.unit.replace('_', ' ')}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>

      {/* ---- room categories -------------------------------------------------- */}
      <section>
        <h2 className="mb-3 text-[20px]">Room categories</h2>
        <div className="space-y-4">
          {rooms.filter((r) => r.active || inOps).map((room) => {
            const r = rates.get(room.id) ?? {}
            const photos = roomPhotos(room.id)
            const codes = Object.keys(r).sort()
            return (
              <div key={room.id} className="overflow-hidden rounded-[20px] bg-white shadow-[0_1px_3px_rgba(20,36,31,.05),0_14px_36px_-22px_rgba(20,36,31,.16)]">
                <div className="grid gap-4 p-5 sm:grid-cols-[220px_1fr_auto]">
                  <div>
                    {photos[0] ? (
                      <button type="button" className="block w-full overflow-hidden rounded-xl" onClick={() => open(photos, 0)}>
                        <img src={photos[0].url} alt={room.name} className="aspect-[4/3] w-full object-cover" />
                      </button>
                    ) : (
                      <div className="grid aspect-[4/3] place-items-center rounded-xl bg-sage text-xs text-ink/40">
                        Photos pending
                      </div>
                    )}
                    {photos.length > 1 && (
                      <div className="mt-1.5 flex gap-1.5">
                        {photos.slice(1, 5).map((p, i) => (
                          <button key={p.storage_path} type="button" className="overflow-hidden rounded-lg" onClick={() => open(photos, i + 1)}>
                            <img src={p.url} alt={label(p)} className="size-11 object-cover" />
                          </button>
                        ))}
                        {photos.length > 5 && (
                          <button
                            type="button"
                            className="grid size-11 place-items-center rounded-lg bg-paper text-[11px] font-semibold text-ink/55"
                            onClick={() => open(photos, 5)}
                          >
                            +{photos.length - 5}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[17px]">{room.name}</h3>
                      {room.category && <Chip tone="sage">{room.category}</Chip>}
                      {!room.active && inOps && <Chip tone="wait">inactive</Chip>}
                    </div>
                    <p className="mt-0.5 text-[12.5px] text-ink/55">
                      {[room.bed_config, room.size_sqm ? `${room.size_sqm} m²` : null, `up to ${room.max_occupancy} guest${room.max_occupancy > 1 ? 's' : ''}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    {room.description && (
                      <p className="mt-2 max-w-[52ch] text-[13.5px] text-ink/75">{room.description}</p>
                    )}
                  </div>
                  <div className="w-full sm:w-56">
                    {codes.length ? (
                      <div className="overflow-hidden rounded-xl border border-hairline">
                        {codes.map((code) => (
                          <div key={code} className="flex items-baseline justify-between gap-3 border-b border-paper px-3 py-2 last:border-0">
                            <span className="text-[12px] font-semibold">{PKG_LABEL[code] ?? code}</span>
                            <span className="tabular text-[13.5px] font-semibold text-deep">
                              {r[code].negotiated && <span className="mr-1 text-brass" title="Your negotiated rate">●</span>}
                              {pkrPlain(r[code].rate)}
                            </span>
                          </div>
                        ))}
                        <div className="bg-paper px-3 py-1.5 text-right text-[10.5px] text-ink/50">per room · night</div>
                      </div>
                    ) : (
                      <span className="text-xs text-brass">{inOps ? 'No base rates — not bookable' : 'Rates on request'}</span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
          {rooms.length === 0 && (
            <p className="rounded-2xl border border-dashed border-hairline p-8 text-center text-sm text-ink/40">
              No room categories yet.
            </p>
          )}
        </div>
      </section>

      {/* ---- lightbox --------------------------------------------------------- */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-ink/90 p-4"
          role="dialog"
          aria-label="Photo viewer"
          onClick={() => setLightbox(null)}
        >
          <figure className="max-h-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
            <img
              src={lightbox.items[lightbox.idx].url}
              alt={label(lightbox.items[lightbox.idx])}
              className="max-h-[80svh] w-auto rounded-xl object-contain"
            />
            <figcaption className="mt-2 flex items-center justify-between text-[13px] text-white/85">
              <span>
                {label(lightbox.items[lightbox.idx]) || property.name}
                <span className="tabular ml-2 text-white/50">
                  {lightbox.idx + 1} / {lightbox.items.length}
                </span>
              </span>
              <span className="flex gap-2">
                <button type="button" className="rounded-lg bg-white/10 px-3 py-1.5 hover:bg-white/20" onClick={() => nav(-1)} aria-label="Previous photo">←</button>
                <button type="button" className="rounded-lg bg-white/10 px-3 py-1.5 hover:bg-white/20" onClick={() => nav(1)} aria-label="Next photo">→</button>
                <button type="button" className="rounded-lg bg-white/10 px-3 py-1.5 hover:bg-white/20" onClick={() => setLightbox(null)} aria-label="Close viewer">✕</button>
              </span>
            </figcaption>
          </figure>
        </div>
      )}
    </article>
  )
}
