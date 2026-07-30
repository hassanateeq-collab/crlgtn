import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { pkrPlain } from '@/lib/format'
import { Notice } from '@/components/ui'

/**
 * The property page, OTA-grade: gallery, profile, verified amenities, rooms
 * with beds/size/rates, inclusions, add-ons, policies.
 *
 * Built once, used twice: today it renders inside the ops console as the
 * "what will corporates see" preview; at M3 the corporate results page links
 * to exactly this component under a corporate route, where RLS trims the data
 * to the caller's view (live vendors only, own negotiated rates, verified
 * amenities only). The page itself never needs to know who is looking.
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
  corridors: { name: string; city: string } | null
}

interface Room {
  id: string
  name: string
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
  url: string
}

export function PropertyPage() {
  const { id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  // Same component, two contexts: the ops console preview and the corporate
  // detail view (M3). Ops-only affordances key off this.
  const inOps = location.pathname.startsWith('/ops')
  const [property, setProperty] = useState<Property | null>(null)
  const [rooms, setRooms] = useState<Room[]>([])
  const [rates, setRates] = useState<Map<string, Record<string, number>>>(new Map())
  const [amenities, setAmenities] = useState<{ label: string; verified: boolean }[]>([])
  const [inclusions, setInclusions] = useState<string[]>([])
  const [addons, setAddons] = useState<{ label: string; price_pkr: number; unit: string }[]>([])
  const [media, setMedia] = useState<MediaItem[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const [v, ls, lr, va, inc, ad, med] = await Promise.all([
        supabase
          .from('vendors')
          .select(
            'id, name, status, property_subtype, stars_assigned, price_bracket, description, address, phone, checkin_time, checkout_time, cancellation_policy, noshow_policy, corridors(name, city)',
          )
          .eq('id', id)
          .single(),
        supabase.from('listings').select('*').eq('vendor_id', id).order('name'),
        supabase
          .from('listing_rates')
          .select('listing_id, package_code, rate_pkr, corporate_id')
          .is('valid_to', null),
        supabase
          .from('vendor_amenities')
          .select('verified_at, amenities(label)')
          .eq('vendor_id', id),
        supabase.from('inclusions').select('label').eq('vendor_id', id).order('label'),
        supabase
          .from('addons')
          .select('label, price_pkr, unit')
          .eq('vendor_id', id)
          .order('label'),
        supabase
          .from('media')
          .select('storage_path, caption, is_cover, listing_id')
          .eq('vendor_id', id)
          .order('sort'),
      ])
      if (v.error) {
        setError(v.error.message)
        return
      }
      setProperty(v.data as unknown as Property)
      setRooms((ls.data ?? []) as Room[])

      const byListing = new Map<string, Record<string, number>>()
      for (const r of lr.data ?? []) {
        // Base rates only on this page; negotiated resolution is the results
        // page's job where the corporate context exists.
        if (r.corporate_id !== null) continue
        const m = byListing.get(r.listing_id) ?? {}
        m[r.package_code] = r.rate_pkr
        byListing.set(r.listing_id, m)
      }
      setRates(byListing)

      setAmenities(
        ((va.data ?? []) as unknown as {
          verified_at: string | null
          amenities: { label: string } | null
        }[])
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
        setMedia(
          medRows.map((m, i) => ({ ...m, url: signed?.[i]?.signedUrl ?? '' })),
        )
      }
    }
    load()
  }, [id])

  if (error) return <Notice tone="error">{error}</Notice>
  if (!property) return <p className="text-sm text-ink/50">Loading…</p>

  const propertyPhotos = media.filter((m) => !m.listing_id)
  const cover = propertyPhotos.find((m) => m.is_cover) ?? propertyPhotos[0]
  const gallery = propertyPhotos.filter((m) => m !== cover)
  const roomPhotos = (roomId: string) => media.filter((m) => m.listing_id === roomId)

  return (
    <article className="space-y-6">
      <nav className="text-xs text-ink/50">
        {inOps ? (
          <>
            <Link to="/ops/vendors" className="hover:text-ink">Vendors</Link>
            {' / '}
            <Link to={`/ops/vendors/${property.id}`} className="hover:text-ink">
              {property.name}
            </Link>
            {' / property page'}
          </>
        ) : (
          <button
            type="button"
            className="hover:text-ink"
            onClick={() => navigate(-1)}
          >
            ← Back to results
          </button>
        )}
      </nav>

      {/* ---- header ---------------------------------------------------------- */}
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-2xl">{property.name}</h1>
        {property.stars_assigned && (
          <span aria-label={`${property.stars_assigned} stars`} className="text-brass">
            {'★'.repeat(property.stars_assigned)}
          </span>
        )}
        <span className="text-sm text-ink/60">
          {[property.property_subtype, property.corridors?.name, property.corridors?.city]
            .filter(Boolean)
            .join(' · ')}
        </span>
        {property.price_bracket && (
          <span className="tabular rounded-full border border-hairline px-2 py-0.5 text-xs uppercase">
            {property.price_bracket}
          </span>
        )}
        {property.status !== 'live' && (
          <span className="rounded-full bg-brass/15 px-2 py-0.5 text-xs text-brass">
            {property.status} — not visible to corporates
          </span>
        )}
      </header>

      {/* ---- gallery --------------------------------------------------------- */}
      {cover ? (
        <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
          <img
            src={cover.url}
            alt={cover.caption ?? property.name}
            className="aspect-[16/10] w-full rounded-lg border border-hairline object-cover"
          />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-1">
            {gallery.slice(0, 2).map((m) => (
              <img
                key={m.storage_path}
                src={m.url}
                alt={m.caption ?? ''}
                className="aspect-[16/10] w-full rounded-lg border border-hairline object-cover"
              />
            ))}
            {gallery.length === 0 && (
              <div className="flex aspect-[16/10] items-center justify-center rounded-lg border border-dashed border-hairline text-xs text-ink/40">
                More photos pending
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex aspect-[21/9] items-center justify-center rounded-lg border border-dashed border-hairline text-sm text-ink/40">
          No photos yet — photography is a launch-checklist item
        </div>
      )}

      {/* ---- description + facts -------------------------------------------- */}
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-5">
          {property.description && (
            <p className="max-w-prose text-[15px] leading-relaxed">{property.description}</p>
          )}

          {amenities.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold">Amenities</h2>
              <ul className="flex flex-wrap gap-2">
                {amenities.map((a) => (
                  <li
                    key={a.label}
                    className={`rounded-full px-3 py-1 text-xs ${
                      a.verified
                        ? 'bg-sage text-deep'
                        : 'border border-dashed border-hairline text-ink/40'
                    }`}
                  >
                    {a.label}
                    {a.verified ? ' ✓' : inOps ? ' (unverified — hidden from corporates)' : ''}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {inclusions.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold">Complimentary inclusions</h2>
              <ul className="list-inside list-disc text-sm text-ink/80">
                {inclusions.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="h-fit rounded-lg border border-hairline bg-white p-4 text-sm">
          <h2 className="mb-3 text-sm font-semibold">Good to know</h2>
          <dl className="space-y-2">
            {property.address && (
              <div>
                <dt className="text-xs text-ink/50">Address</dt>
                <dd>{property.address}</dd>
              </div>
            )}
            {(property.checkin_time || property.checkout_time) && (
              <div>
                <dt className="text-xs text-ink/50">Check-in / check-out</dt>
                <dd className="tabular">
                  {property.checkin_time?.slice(0, 5) ?? '—'} /{' '}
                  {property.checkout_time?.slice(0, 5) ?? '—'} PKT
                </dd>
              </div>
            )}
            {property.cancellation_policy && (
              <div>
                <dt className="text-xs text-ink/50">Cancellation</dt>
                <dd>{property.cancellation_policy}</dd>
              </div>
            )}
            {property.noshow_policy && (
              <div>
                <dt className="text-xs text-ink/50">No-show</dt>
                <dd>{property.noshow_policy}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-ink/50">Payment</dt>
              {/* BTC language exactly as spec §2 fixes it. */}
              <dd>Bill to company — nothing payable at the desk except personal extras.</dd>
            </div>
          </dl>
        </aside>
      </div>

      {/* ---- rooms ----------------------------------------------------------- */}
      <section>
        <h2 className="mb-3 text-lg">Rooms</h2>
        <div className="space-y-3">
          {rooms.map((room) => {
            const r = rates.get(room.id) ?? {}
            const photo = roomPhotos(room.id)[0]
            return (
              <div
                key={room.id}
                className="grid gap-4 rounded-lg border border-hairline bg-white p-4 sm:grid-cols-[8rem_1fr_auto]"
              >
                {photo ? (
                  <img
                    src={photo.url}
                    alt={photo.caption ?? room.name}
                    className="aspect-square w-full rounded object-cover sm:w-32"
                  />
                ) : (
                  <div className="hidden aspect-square items-center justify-center rounded bg-sage text-xs text-ink/40 sm:flex sm:w-32">
                    No photo
                  </div>
                )}
                <div>
                  <h3 className="text-base font-semibold">
                    {room.name}
                    {!room.active && (
                      <span className="ml-2 text-xs font-normal text-brass">(inactive)</span>
                    )}
                  </h3>
                  <p className="mt-0.5 text-xs text-ink/60">
                    {[
                      room.bed_config,
                      room.size_sqm ? `${room.size_sqm} m²` : null,
                      `sleeps ${room.max_occupancy}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {room.description && (
                    <p className="mt-1.5 max-w-prose text-sm text-ink/80">{room.description}</p>
                  )}
                </div>
                <div className="text-sm sm:text-right">
                  {(['P1', 'P2', 'P3'] as const).map((code) =>
                    r[code] ? (
                      <div key={code} className="flex justify-between gap-4 sm:justify-end">
                        <span className="text-xs text-ink/50">{code}</span>
                        <span className="tabular">PKR {pkrPlain(r[code])}</span>
                      </div>
                    ) : null,
                  )}
                  {Object.keys(r).length === 0 && (
                    <span className="text-xs text-brass">No base rates — not bookable</span>
                  )}
                </div>
              </div>
            )
          })}
          {rooms.length === 0 && (
            <p className="rounded-lg border border-dashed border-hairline p-6 text-center text-sm text-ink/40">
              No rooms yet — add listings in the editor.
            </p>
          )}
        </div>
      </section>

      {/* ---- add-ons ---------------------------------------------------------- */}
      {addons.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Paid add-ons at checkout</h2>
          <ul className="flex flex-wrap gap-2 text-sm">
            {addons.map((a) => (
              <li key={a.label} className="rounded-md border border-hairline bg-white px-3 py-1.5">
                {a.label} · <span className="tabular">PKR {pkrPlain(a.price_pkr)}</span>{' '}
                <span className="text-xs text-ink/50">{a.unit.replace('_', ' ')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  )
}
