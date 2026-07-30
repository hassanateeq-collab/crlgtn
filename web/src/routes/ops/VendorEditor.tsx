import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { onboardVendor, ApiError } from '@/lib/api'
import { Button, Card, Field, Input, Notice } from '@/components/ui'

/**
 * The M1 vendor onboarding form: vendor → listings + P1–P3 base rates →
 * verified amenity checklist → inclusions → paid add-ons → agreement record.
 * One save calls ef_onboard_vendor; the milestone gate is a complete, bookable
 * hotel in under ten minutes.
 */

interface ListingDraft {
  name: string
  max_occupancy: number
  active: boolean
  rates: { P1: string; P2: string; P3: string } // strings in form state; integers at submit
}

interface AddonDraft {
  label: string
  price_pkr: string
  unit: string
}

const emptyListing = (): ListingDraft => ({
  name: '',
  max_occupancy: 2,
  active: true,
  rates: { P1: '', P2: '', P3: '' },
})

const PACKAGE_LABELS: Record<string, string> = {
  P1: 'P1 · room only',
  P2: 'P2 · + breakfast',
  P3: 'P3 · half board',
}

export function VendorEditor() {
  const { id } = useParams()
  const isNew = !id || id === 'new'
  const navigate = useNavigate()

  const [corridors, setCorridors] = useState<{ id: string; name: string }[]>([])
  const [amenityList, setAmenityList] = useState<{ code: string; label: string }[]>([])

  const [name, setName] = useState('')
  const [status, setStatus] = useState('prospect')
  const [corridorId, setCorridorId] = useState('')
  const [stars, setStars] = useState('')
  const [bracket, setBracket] = useState('')
  const [commission, setCommission] = useState('')
  const [notes, setNotes] = useState('')
  const [listings, setListings] = useState<ListingDraft[]>([emptyListing()])
  const [verified, setVerified] = useState<Record<string, boolean>>({})
  const [inclusions, setInclusions] = useState('')
  const [addons, setAddons] = useState<AddonDraft[]>([])
  const [agreementTier, setAgreementTier] = useState('')
  const [agreementFile, setAgreementFile] = useState<File | null>(null)
  const [signedDigital, setSignedDigital] = useState(false)
  const [signedPhysical, setSignedPhysical] = useState(false)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(isNew)

  // Reference data.
  useEffect(() => {
    supabase.from('corridors').select('id, name').order('sort')
      .then(({ data }) => setCorridors(data ?? []))
    supabase.from('amenities').select('code, label').order('label')
      .then(({ data }) => setAmenityList(data ?? []))
  }, [])

  // Existing vendor: hydrate the form.
  useEffect(() => {
    if (isNew) return
    async function load() {
      const [v, ls, rates, va, inc, ad] = await Promise.all([
        supabase.from('vendors').select('*').eq('id', id).single(),
        supabase.from('listings').select('*').eq('vendor_id', id).order('name'),
        supabase
          .from('listing_rates')
          .select('listing_id, package_code, rate_pkr, corporate_id')
          .is('corporate_id', null)
          .is('valid_to', null),
        supabase.from('vendor_amenities').select('verified_at, amenities(code)').eq('vendor_id', id),
        supabase.from('inclusions').select('label').eq('vendor_id', id).order('label'),
        supabase.from('addons').select('label, price_pkr, unit').eq('vendor_id', id).order('label'),
      ])
      if (v.error) { setError(v.error.message); return }

      setName(v.data.name)
      setStatus(v.data.status)
      setCorridorId(v.data.corridor_id ?? '')
      setStars(v.data.stars_assigned?.toString() ?? '')
      setBracket(v.data.price_bracket ?? '')
      setCommission(v.data.commission_pct?.toString() ?? '')
      setNotes(v.data.notes ?? '')

      const rateByListing = new Map<string, Record<string, number>>()
      for (const r of rates.data ?? []) {
        const m = rateByListing.get(r.listing_id) ?? {}
        m[r.package_code] = r.rate_pkr
        rateByListing.set(r.listing_id, m)
      }
      const hydrated = (ls.data ?? []).map((l) => ({
        name: l.name,
        max_occupancy: l.max_occupancy,
        active: l.active,
        rates: {
          P1: rateByListing.get(l.id)?.P1?.toString() ?? '',
          P2: rateByListing.get(l.id)?.P2?.toString() ?? '',
          P3: rateByListing.get(l.id)?.P3?.toString() ?? '',
        },
      }))
      setListings(hydrated.length ? hydrated : [emptyListing()])

      const vMap: Record<string, boolean> = {}
      for (const row of (va.data ?? []) as unknown as {
        verified_at: string | null
        amenities: { code: string } | null
      }[]) {
        if (row.amenities) vMap[row.amenities.code] = row.verified_at !== null
      }
      setVerified(vMap)
      setInclusions((inc.data ?? []).map((i) => i.label).join('\n'))
      setAddons(
        (ad.data ?? []).map((a) => ({
          label: a.label, price_pkr: a.price_pkr.toString(), unit: a.unit,
        })),
      )
      setLoaded(true)
    }
    load()
  }, [id, isNew])

  function setListing(i: number, patch: Partial<ListingDraft>) {
    setListings((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      // Agreement file goes to the private bucket first; the function records
      // the object path. Storage RLS restricts this to ops.
      let docUrl: string | null = null
      if (agreementFile) {
        const path = `vendor/${crypto.randomUUID()}/${agreementFile.name}`
        const { error: upErr } = await supabase.storage
          .from('agreements')
          .upload(path, agreementFile)
        if (upErr) throw new Error(`Agreement upload failed: ${upErr.message}`)
        docUrl = path
      }

      const payload = {
        vendor: {
          ...(isNew ? {} : { id }),
          name: name.trim(),
          status,
          corridor_id: corridorId || null,
          stars_assigned: stars ? Number(stars) : null,
          price_bracket: bracket || null,
          commission_pct: commission ? Number(commission) : null,
          notes: notes.trim() || null,
        },
        listings: listings
          .filter((l) => l.name.trim())
          .map((l) => ({
            name: l.name.trim(),
            max_occupancy: l.max_occupancy,
            active: l.active,
            rates: Object.fromEntries(
              Object.entries(l.rates)
                .filter(([, v]) => v.trim() !== '')
                .map(([k, v]) => [k, parseInt(v, 10)]),
            ),
          })),
        amenities: amenityList.map((a) => ({
          code: a.code,
          verified: verified[a.code] === true,
        })),
        inclusions: inclusions.split('\n').map((s) => s.trim()).filter(Boolean),
        addons: addons
          .filter((a) => a.label.trim())
          .map((a) => ({
            label: a.label.trim(),
            price_pkr: parseInt(a.price_pkr || '0', 10),
            unit: a.unit || 'per_stay',
          })),
        ...(agreementTier || docUrl || signedDigital || signedPhysical
          ? {
              agreement: {
                tier: agreementTier || null,
                doc_url: docUrl,
                signed_digital_at: signedDigital ? new Date().toISOString() : null,
                signed_physical_at: signedPhysical ? new Date().toISOString() : null,
              },
            }
          : {}),
      }

      await onboardVendor(payload)
      navigate('/ops/vendors')
    } catch (err: unknown) {
      setError(
        err instanceof ApiError
          ? `${err.message}${err.details ? ` — ${JSON.stringify(err.details)}` : ''}`
          : err instanceof Error
            ? err.message
            : 'Save failed',
      )
    } finally {
      setBusy(false)
    }
  }

  if (!loaded && !error) return <p className="text-sm text-ink/50">Loading…</p>

  const selectCls =
    'w-full rounded-md border border-hairline bg-white px-3 py-2 text-sm text-ink focus:border-pine focus:outline-none'

  return (
    <form onSubmit={save} className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl">{isNew ? 'Onboard vendor' : `Edit · ${name}`}</h1>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={() => navigate('/ops/vendors')}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save vendor'}
          </Button>
        </div>
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      <Card title="Vendor">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Status">
            <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)}>
              {['prospect', 'onboarding', 'live', 'suspended'].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Corridor">
            <select className={selectCls} value={corridorId} onChange={(e) => setCorridorId(e.target.value)}>
              <option value="">—</option>
              {corridors.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Stars (Corlington-assigned)">
            <select className={selectCls} value={stars} onChange={(e) => setStars(e.target.value)}>
              <option value="">—</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </Field>
          <Field label="Price bracket">
            <select className={selectCls} value={bracket} onChange={(e) => setBracket(e.target.value)}>
              <option value="">—</option>
              {['b1', 'b2', 'b3', 'b4', 'b5'].map((b) => (
                <option key={b} value={b}>{b.toUpperCase()}</option>
              ))}
            </select>
          </Field>
          <Field label="Commission %" hint="Contracted 8–12%">
            <Input
              type="number" min="0" max="100" step="0.5"
              value={commission} onChange={(e) => setCommission(e.target.value)}
            />
          </Field>
        </div>
        <div className="mt-4">
          <Field label="Notes">
            <textarea
              className={`${selectCls} min-h-16`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
        </div>
      </Card>

      <Card title="Listings & base rates (PKR per night)">
        <div className="space-y-4">
          {listings.map((l, i) => (
            <div key={i} className="rounded-md border border-hairline p-3">
              <div className="grid gap-3 sm:grid-cols-[1fr_7rem_6rem]">
                <Field label="Room type">
                  <Input
                    value={l.name}
                    placeholder="Executive Twin"
                    onChange={(e) => setListing(i, { name: e.target.value })}
                  />
                </Field>
                <Field label="Max occupancy">
                  <Input
                    type="number" min="1" max="20"
                    value={l.max_occupancy}
                    onChange={(e) => setListing(i, { max_occupancy: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Active">
                  <select
                    className={selectCls}
                    value={l.active ? 'yes' : 'no'}
                    onChange={(e) => setListing(i, { active: e.target.value === 'yes' })}
                  >
                    <option value="yes">yes</option>
                    <option value="no">no</option>
                  </select>
                </Field>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {(['P1', 'P2', 'P3'] as const).map((code) => (
                  <Field key={code} label={PACKAGE_LABELS[code]}>
                    <Input
                      inputMode="numeric"
                      className="tabular"
                      placeholder="—"
                      value={l.rates[code]}
                      onChange={(e) =>
                        setListing(i, {
                          rates: { ...l.rates, [code]: e.target.value.replace(/\D/g, '') },
                        })
                      }
                    />
                  </Field>
                ))}
              </div>
              {listings.length > 1 && (
                <div className="mt-2 text-right">
                  <button
                    type="button"
                    className="text-xs text-ink/50 hover:text-ink"
                    onClick={() => setListings((ls) => ls.filter((_, j) => j !== i))}
                  >
                    Remove listing
                  </button>
                </div>
              )}
            </div>
          ))}
          <Button type="button" variant="ghost" onClick={() => setListings((ls) => [...ls, emptyListing()])}>
            Add listing
          </Button>
        </div>
      </Card>

      <Card title="Amenity checklist" footer={
        <span className="text-xs text-ink/60">
          Only verified amenities are visible to corporates and count for deal-breakers.
          Verification happens at the onboarding visit.
        </span>
      }>
        <div className="grid gap-2 sm:grid-cols-2">
          {amenityList.map((a) => (
            <label key={a.code} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-[#1D5C4D]"
                checked={verified[a.code] === true}
                onChange={(e) => setVerified((v) => ({ ...v, [a.code]: e.target.checked }))}
              />
              {a.label}
              <span className="text-xs text-ink/40">
                {verified[a.code] ? '· verified' : ''}
              </span>
            </label>
          ))}
        </div>
      </Card>

      <div className="grid gap-6 sm:grid-cols-2">
        <Card title="Complimentary inclusions" footer={
          <span className="text-xs text-ink/60">Shown on the listing card. One per line.</span>
        }>
          <textarea
            className={`${selectCls} min-h-24`}
            placeholder={'Airport pickup\nLate checkout to 2pm'}
            value={inclusions}
            onChange={(e) => setInclusions(e.target.value)}
          />
        </Card>

        <Card title="Paid add-ons">
          <div className="space-y-2">
            {addons.map((a, i) => (
              <div key={i} className="grid grid-cols-[1fr_6rem_6rem_2rem] items-center gap-2">
                <Input
                  placeholder="Extra bed"
                  value={a.label}
                  onChange={(e) =>
                    setAddons((ad) => ad.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                  }
                />
                <Input
                  inputMode="numeric" className="tabular" placeholder="PKR"
                  value={a.price_pkr}
                  onChange={(e) =>
                    setAddons((ad) =>
                      ad.map((x, j) =>
                        j === i ? { ...x, price_pkr: e.target.value.replace(/\D/g, '') } : x,
                      ),
                    )
                  }
                />
                <select
                  className={selectCls}
                  value={a.unit}
                  onChange={(e) =>
                    setAddons((ad) => ad.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))
                  }
                >
                  <option value="per_stay">per stay</option>
                  <option value="per_night">per night</option>
                  <option value="per_person">per person</option>
                </select>
                <button
                  type="button"
                  aria-label="Remove add-on"
                  className="text-ink/40 hover:text-ink"
                  onClick={() => setAddons((ad) => ad.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </div>
            ))}
            <Button
              type="button" variant="ghost"
              onClick={() => setAddons((ad) => [...ad, { label: '', price_pkr: '', unit: 'per_stay' }])}
            >
              Add add-on
            </Button>
          </div>
        </Card>
      </div>

      <Card title="Agreement" footer={
        <span className="text-xs text-ink/60">
          Each save with agreement details appends a new record — history is never overwritten.
        </span>
      }>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tier">
            <Input
              placeholder="standard / preferred"
              value={agreementTier}
              onChange={(e) => setAgreementTier(e.target.value)}
            />
          </Field>
          <Field label="Signed document (PDF)">
            <input
              type="file"
              accept="application/pdf"
              className="block w-full text-sm text-ink/70 file:mr-3 file:rounded-md file:border file:border-hairline file:bg-paper file:px-3 file:py-1.5 file:text-sm"
              onChange={(e) => setAgreementFile(e.target.files?.[0] ?? null)}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox" className="size-4 accent-[#1D5C4D]"
              checked={signedDigital}
              onChange={(e) => setSignedDigital(e.target.checked)}
            />
            Signed digitally
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox" className="size-4 accent-[#1D5C4D]"
              checked={signedPhysical}
              onChange={(e) => setSignedPhysical(e.target.checked)}
            />
            Signed on paper
          </label>
        </div>
      </Card>
    </form>
  )
}
