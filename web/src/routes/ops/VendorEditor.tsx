import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { onboardVendor, provisionVendorLogin, setUserPassword, ApiError, type VendorPayload } from '@/lib/api'
import { generatePassword } from '@/lib/passwords'
import {
  CATEGORIES,
  CATEGORY_REQUIRED,
  CATEGORY_SHOTS,
  COURTESIES,
  CREDIT_TIERS,
  CORRIDOR_NOTE,
  GALLERY_MIN,
  PACKAGES,
  SHOT_KEYS,
  SHOT_LIST,
  VENDOR_TYPES,
  allDone,
  vendorSteps,
  type VendorFacts,
} from '@/lib/onboarding'
import {
  ABtn,
  ACard,
  AField,
  AInput,
  ASelect,
  ATextarea,
  Chip,
  ChipToggle,
  Notice,
  PageHead,
  Plan,
  Toggle,
  statusTone,
} from '@/components/atlas'

/**
 * Vendor setup — hotel, car operator or apartment host — in the Atlas language.
 * Everything here writes through ef_onboard_vendor in one save; photos upload
 * straight to the private `media` bucket and are registered on save with their
 * shot type. The plan panel mirrors the vendor_onboarding view on live form
 * state, so ops see exactly what's left before go-live.
 */

interface ListingDraft {
  name: string
  category: string
  max_occupancy: number
  active: boolean
  bed_config: string
  size_sqm: string
  description: string
  rates: Record<string, string>
}

interface PhotoDraft {
  storage_path: string
  listing_name: string // '' = property-level
  shot_type: string // SHOT key, 'category', or 'other'
  caption: string
  previewUrl: string
}

const emptyListing = (cat: string): ListingDraft => ({
  name: '',
  category: cat,
  max_occupancy: 2,
  active: true,
  bed_config: '',
  size_sqm: '',
  description: '',
  rates: {},
})

const toInt = (s: string) => {
  const n = parseInt(s.replace(/[^0-9]/g, ''), 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function VendorEditor() {
  const { id } = useParams()
  const isNew = !id || id === 'new'
  const navigate = useNavigate()

  const [corridors, setCorridors] = useState<{ id: string; name: string }[]>([])
  const [amenityList, setAmenityList] = useState<{ code: string; label: string }[]>([])

  // identity
  const [vendorType, setVendorType] = useState('hotel')
  const [name, setName] = useState('')
  const [status, setStatus] = useState('prospect')
  // Vendors that were live before the plan rules existed keep saving as live;
  // the gate only guards the onboarding → live transition.
  const [wasLive, setWasLive] = useState(false)
  const [corridorId, setCorridorId] = useState('')
  const [stars, setStars] = useState('')
  const [bracket, setBracket] = useState('')
  const [subtype, setSubtype] = useState('')
  const [totalRooms, setTotalRooms] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [description, setDescription] = useState('')
  const [notes, setNotes] = useState('')
  // front office — multiple contacts; the magic link goes to all of them
  const [contacts, setContacts] = useState<
    { name: string; whatsapp: string; email: string; id?: string | null; auth_user_id?: string | null }[]
  >([{ name: '', whatsapp: '', email: '' }])
  const [portalBusy, setPortalBusy] = useState<string | null>(null)
  const [portalIssued, setPortalIssued] = useState<{ email: string; password: string } | null>(null)
  // agreement & credit
  const [creditTier, setCreditTier] = useState<'HT1' | 'HT2' | 'HT3' | 'HT4'>('HT4')
  const [commission, setCommission] = useState('')
  const [agreementOnFile, setAgreementOnFile] = useState<{ signed: boolean; when: string | null } | null>(null)
  const [recordAgreement, setRecordAgreement] = useState(false)
  const [signedDigital, setSignedDigital] = useState(false)
  const [signedPhysical, setSignedPhysical] = useState(false)
  const [agreementFile, setAgreementFile] = useState<File | null>(null)
  // catalog
  const [listings, setListings] = useState<ListingDraft[]>([])
  const [verified, setVerified] = useState<Record<string, boolean>>({})
  const [courtesies, setCourtesies] = useState<string[]>([])
  const [customCourtesy, setCustomCourtesy] = useState('')
  const [airportTransfer, setAirportTransfer] = useState(false)
  const [inclusions, setInclusions] = useState('')
  // photos
  const [photos, setPhotos] = useState<PhotoDraft[]>([])
  const [uploading, setUploading] = useState<string | null>(null)
  // policies
  const [checkinTime, setCheckinTime] = useState('')
  const [checkoutTime, setCheckoutTime] = useState('')
  const [cancellationPolicy, setCancellationPolicy] = useState('')
  const [noshowPolicy, setNoshowPolicy] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(isNew)

  const isCar = vendorType === 'rent_a_car'
  const packages = PACKAGES[vendorType] ?? PACKAGES.hotel
  const categories = CATEGORIES[vendorType] ?? []

  useEffect(() => {
    supabase.from('corridors').select('id, name').order('sort').then(({ data }) => setCorridors(data ?? []))
    supabase.from('amenities').select('code, label').order('label').then(({ data }) => setAmenityList(data ?? []))
  }, [])

  useEffect(() => {
    if (isNew) return
    async function load() {
      const [v, ls, rates, va, inc, med, fo, ag] = await Promise.all([
        supabase.from('vendors').select('*').eq('id', id).single(),
        supabase.from('listings').select('*').eq('vendor_id', id).order('name'),
        supabase.from('listing_rates').select('listing_id, package_code, rate_pkr').is('corporate_id', null).is('valid_to', null),
        supabase.from('vendor_amenities').select('verified_at, amenities(code)').eq('vendor_id', id),
        supabase.from('inclusions').select('label').eq('vendor_id', id).order('label'),
        supabase.from('media').select('storage_path, caption, sort, listing_id, shot_type, listings(name)').eq('vendor_id', id).order('sort'),
        supabase.from('vendor_users').select('id, name, whatsapp, email, auth_user_id').eq('vendor_id', id).order('created_at'),
        supabase.from('agreements').select('signed_digital_at, signed_physical_at, created_at').eq('party_type', 'vendor').eq('party_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ])
      if (v.error) {
        setError(v.error.message)
        return
      }
      const d = v.data
      setVendorType(d.vendor_type)
      setName(d.name)
      setStatus(d.status)
      setWasLive(d.status === 'live')
      setCorridorId(d.corridor_id ?? '')
      setStars(d.stars_assigned?.toString() ?? '')
      setBracket(d.price_bracket ?? '')
      setSubtype(d.property_subtype ?? '')
      setTotalRooms(d.total_rooms?.toString() ?? '')
      setAddress(d.address ?? '')
      setPhone(d.phone ?? '')
      setDescription(d.description ?? '')
      setNotes(d.notes ?? '')
      setCreditTier(d.credit_tier ?? 'HT4')
      setCommission(d.commission_pct?.toString() ?? '')
      setCourtesies(d.courtesies ?? [])
      setAirportTransfer(!!d.airport_transfer_included)
      setCheckinTime(d.checkin_time ?? '')
      setCheckoutTime(d.checkout_time ?? '')
      setCancellationPolicy(d.cancellation_policy ?? '')
      setNoshowPolicy(d.noshow_policy ?? '')
      const foRows = (fo.data ?? []).map((x) => ({
        name: x.name ?? '',
        whatsapp: x.whatsapp ?? '',
        email: x.email ?? '',
        id: x.id as string,
        auth_user_id: (x.auth_user_id ?? null) as string | null,
      }))
      if (foRows.length) setContacts(foRows)
      if (ag.data) {
        const when = ag.data.signed_digital_at ?? ag.data.signed_physical_at
        setAgreementOnFile({ signed: !!when, when })
      }

      const rateBy = new Map<string, Record<string, string>>()
      for (const r of rates.data ?? []) {
        const m = rateBy.get(r.listing_id) ?? {}
        m[r.package_code] = r.rate_pkr.toString()
        rateBy.set(r.listing_id, m)
      }
      setListings(
        (ls.data ?? []).map((l) => ({
          name: l.name,
          category: l.category ?? '',
          max_occupancy: l.max_occupancy,
          active: l.active,
          bed_config: l.bed_config ?? '',
          size_sqm: l.size_sqm?.toString() ?? '',
          description: l.description ?? '',
          rates: rateBy.get(l.id) ?? {},
        })),
      )

      const vMap: Record<string, boolean> = {}
      for (const row of (va.data ?? []) as unknown as { verified_at: string | null; amenities: { code: string } | null }[]) {
        if (row.amenities) vMap[row.amenities.code] = row.verified_at !== null
      }
      setVerified(vMap)
      setInclusions((inc.data ?? []).map((i) => i.label).join('\n'))

      const medRows = (med.data ?? []) as unknown as {
        storage_path: string
        caption: string | null
        shot_type: string | null
        listing_id: string | null
        listings: { name: string } | null
      }[]
      if (medRows.length) {
        const { data: signed } = await supabase.storage.from('media').createSignedUrls(medRows.map((m) => m.storage_path), 3600)
        setPhotos(
          medRows.map((m, i) => ({
            storage_path: m.storage_path,
            listing_name: m.listings?.name ?? '',
            shot_type: m.shot_type ?? (m.listing_id ? 'category' : 'other'),
            caption: m.caption ?? '',
            previewUrl: signed?.[i]?.signedUrl ?? '',
          })),
        )
      }
      setLoaded(true)
    }
    load()
  }, [id, isNew])

  // ---- live progress (mirrors the vendor_onboarding view) ------------------
  const facts: VendorFacts = useMemo(() => {
    const active = listings.filter((l) => l.active && l.name.trim())
    const priced = active.filter((l) => Object.values(l.rates).some((r) => toInt(r)))
    const propertyShots = new Set(photos.filter((p) => !p.listing_name && SHOT_KEYS.includes(p.shot_type)).map((p) => p.shot_type))
    const withGallery = active.filter((l) => {
      const g = photos.filter((p) => p.listing_name === l.name)
      const types = new Set(g.map((p) => p.shot_type))
      return g.length >= GALLERY_MIN && CATEGORY_REQUIRED.every((k) => types.has(k))
    })
    return {
      vendor_type: vendorType,
      profile_complete: !!(description.trim() && address.trim() && corridorId),
      has_front_office: contacts.some((c) => c.whatsapp.trim() || c.email.trim()),
      agreement_signed: !!agreementOnFile?.signed || (recordAgreement && (signedDigital || signedPhysical)),
      listings_active: active.length,
      listings_priced: priced.length,
      amenities_verified: Object.values(verified).filter(Boolean).length,
      shots_done: propertyShots.size,
      photos_total: photos.length,
      listings_with_gallery: withGallery.length,
    }
  }, [listings, photos, vendorType, description, address, corridorId, contacts, agreementOnFile, recordAgreement, signedDigital, signedPhysical, verified])
  const steps = vendorSteps(facts)
  const ready = allDone(steps)

  // ---- photo uploads --------------------------------------------------------
  async function upload(files: FileList | null, target: { shot_type: string; listing_name: string }) {
    if (!files?.length) return
    setUploading(target.listing_name || target.shot_type)
    setError(null)
    try {
      const added: PhotoDraft[] = []
      for (const file of Array.from(files)) {
        const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const path = `vendor/${isNew ? 'new' : id}/${crypto.randomUUID()}-${safe}`
        const { error: upErr } = await supabase.storage.from('media').upload(path, file)
        if (upErr) throw new Error(`${file.name}: ${upErr.message}`)
        const { data: signed } = await supabase.storage.from('media').createSignedUrl(path, 3600)
        added.push({ storage_path: path, listing_name: target.listing_name, shot_type: target.shot_type, caption: '', previewUrl: signed?.signedUrl ?? '' })
      }
      setPhotos((p) => {
        // A shot-list slot holds exactly one photo: replace, don't stack.
        const isSlot = SHOT_KEYS.includes(target.shot_type) && !target.listing_name
        const kept = isSlot ? p.filter((x) => !(x.shot_type === target.shot_type && !x.listing_name)) : p
        return [...kept, ...added]
      })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(null)
    }
  }
  const removePhoto = (path: string) => setPhotos((p) => p.filter((x) => x.storage_path !== path))
  const setPhotoType = (path: string, shot_type: string) =>
    setPhotos((p) => p.map((x) => (x.storage_path === path ? { ...x, shot_type } : x)))
  /** Put an already-uploaded property photo into a shot-list slot (one photo per slot). */
  const assignShot = (path: string, key: string) =>
    setPhotos((p) =>
      p
        .filter((x) => !(x.shot_type === key && !x.listing_name && x.storage_path !== path))
        .map((x) => (x.storage_path === path ? { ...x, shot_type: key, listing_name: '' } : x)),
    )

  // ---- listings -------------------------------------------------------------
  const setListing = (i: number, patch: Partial<ListingDraft>) =>
    setListings((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const setRate = (i: number, code: string, v: string) =>
    setListings((ls) => ls.map((l, j) => (j === i ? { ...l, rates: { ...l.rates, [code]: v } } : l)))

  // ---- save -----------------------------------------------------------------
  /**
   * Portal access for one saved front-office contact: ensure the auth account
   * exists (ef_manage_users provision_vendor), then issue a fresh password —
   * generated client-side, shown once, never stored.
   */
  async function grantPortal(contactId: string) {
    const c = contacts.find((x) => x.id === contactId)
    if (!c?.email.trim()) return
    setPortalBusy(contactId)
    setError(null)
    try {
      await provisionVendorLogin(contactId)
      const password = generatePassword()
      const email = c.email.trim().toLowerCase()
      await setUserPassword(email, password)
      setPortalIssued({ email, password })
      setContacts((cs) => cs.map((x) => (x.id === contactId ? { ...x, auth_user_id: x.auth_user_id ?? 'linked' } : x)))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not set up portal access.')
    } finally {
      setPortalBusy(null)
    }
  }

  async function save() {
    setBusy(true)
    setError(null)
    setSaved(null)
    try {
      if (!name.trim()) throw new Error('Give the vendor a name.')
      if (status === 'live' && !ready && !wasLive) {
        throw new Error(`Can't go live yet — ${steps.filter((s) => !s.done).map((s) => s.label.toLowerCase()).join(', ')}.`)
      }
      let docUrl: string | null = null
      if (recordAgreement && agreementFile) {
        const path = `vendor/${crypto.randomUUID()}/${agreementFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
        const { error: upErr } = await supabase.storage.from('agreements').upload(path, agreementFile)
        if (upErr) throw new Error(`Agreement upload failed: ${upErr.message}`)
        docUrl = path
      }
      // Cover = the front-door shot, else the first property photo.
      const propertyPhotos = photos.filter((p) => !p.listing_name)
      const coverPath = (propertyPhotos.find((p) => p.shot_type === 'front_door') ?? propertyPhotos[0])?.storage_path ?? null

      const payload: VendorPayload = {
        vendor: {
          ...(isNew ? {} : { id }),
          name: name.trim(),
          vendor_type: vendorType,
          status,
          corridor_id: corridorId || null,
          stars_assigned: isCar ? null : toInt(stars),
          price_bracket: bracket || null,
          commission_pct: commission ? Number(commission) : null,
          notes: notes.trim() || null,
          description: description.trim() || null,
          property_subtype: subtype.trim() || null,
          address: address.trim() || null,
          phone: phone.trim() || null,
          checkin_time: checkinTime || null,
          checkout_time: checkoutTime || null,
          cancellation_policy: cancellationPolicy.trim() || null,
          noshow_policy: noshowPolicy.trim() || null,
          credit_tier: creditTier,
          total_rooms: isCar ? null : toInt(totalRooms),
          airport_transfer_included: airportTransfer,
          courtesies,
        },
        listings: listings
          .filter((l) => l.name.trim())
          .map((l) => ({
            name: l.name.trim(),
            category: l.category || null,
            max_occupancy: l.max_occupancy,
            active: l.active,
            bed_config: l.bed_config.trim() || null,
            size_sqm: toInt(l.size_sqm),
            description: l.description.trim() || null,
            rates: Object.fromEntries(
              Object.entries(l.rates)
                .map(([code, v]) => [code, toInt(v)] as const)
                .filter((e): e is readonly [string, number] => e[1] !== null),
            ),
          })),
        amenities: amenityList.map((a) => ({ code: a.code, verified: !!verified[a.code] })),
        inclusions: inclusions.split('\n').map((s) => s.trim()).filter(Boolean),
        media: photos.map((p, i) => ({
          storage_path: p.storage_path,
          listing_name: p.listing_name || null,
          caption: p.caption || null,
          sort: i,
          is_cover: p.storage_path === coverPath,
          shot_type: p.shot_type,
        })),
        front_office: contacts
          .filter((c) => c.whatsapp.trim() || c.email.trim())
          .map((c) => ({ name: c.name.trim() || 'Front office', whatsapp: c.whatsapp.trim() || null, email: c.email.trim() || null })),
        ...(recordAgreement
          ? {
              agreement: {
                tier: creditTier,
                doc_url: docUrl,
                signed_digital_at: signedDigital ? new Date().toISOString() : null,
                signed_physical_at: signedPhysical ? new Date().toISOString() : null,
              },
            }
          : {}),
      }
      const res = await onboardVendor(payload)
      setSaved(status === 'live' ? 'Saved — this vendor is live.' : 'Saved.')
      if (recordAgreement) {
        setAgreementOnFile({ signed: signedDigital || signedPhysical, when: new Date().toISOString() })
        setRecordAgreement(false)
      }
      if (isNew) navigate(`/ops/vendors/${res.vendor.id}`, { replace: true })
    } catch (err: unknown) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  if (!loaded && !error) return <p className="text-sm text-ink/50">Loading…</p>

  const propertyPhoto = (key: string) => photos.find((p) => p.shot_type === key && !p.listing_name)
  const otherPhotos = photos.filter((p) => !p.listing_name && !SHOT_KEYS.includes(p.shot_type))

  return (
    <div>
      <PageHead
        eyebrow={isNew ? 'New vendor' : 'Vendor setup'}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {name || 'Untitled vendor'}
            <Chip tone={statusTone(status)}>{status}</Chip>
          </span>
        }
        sub={isNew ? 'A vendor goes live only when every step of the plan is done.' : CORRIDOR_NOTE}
        actions={
          <>
            <Link to="/ops/vendors" className="text-[13px] font-semibold text-ink/55">← Supply</Link>
            {!isNew && (
              <Link to={`/ops/vendors/${id}/page`}>
                <ABtn variant="ghost">Preview property page</ABtn>
              </Link>
            )}
          </>
        }
      />

      <div className="grid items-start gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          {/* ---------------- identity ---------------- */}
          <ACard title="Identity" sub="What the booker reads first.">
            <div className="grid gap-3 md:grid-cols-3">
              <AField label="Type">
                <ASelect value={vendorType} onChange={(e) => setVendorType(e.target.value)} disabled={!isNew}>
                  {VENDOR_TYPES.map((t) => (
                    <option key={t.code} value={t.code}>{t.label}</option>
                  ))}
                </ASelect>
              </AField>
              <AField label="Name" className="md:col-span-2">
                <AInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Beach Luxury Hotel" />
              </AField>
              <AField label="Area — exactly one">
                <ASelect value={corridorId} onChange={(e) => setCorridorId(e.target.value)}>
                  <option value="">— pick an area —</option>
                  {corridors.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </ASelect>
              </AField>
              {!isCar && (
                <AField label="Stars">
                  <ASelect value={stars} onChange={(e) => setStars(e.target.value)}>
                    <option value="">—</option>
                    {[1, 2, 3, 4, 5].map((s) => (
                      <option key={s} value={s}>{s}★</option>
                    ))}
                  </ASelect>
                </AField>
              )}
              <AField label="Price bracket">
                <ASelect value={bracket} onChange={(e) => setBracket(e.target.value)}>
                  <option value="">—</option>
                  {['b1', 'b2', 'b3', 'b4', 'b5'].map((b) => (
                    <option key={b} value={b}>{b.toUpperCase()}</option>
                  ))}
                </ASelect>
              </AField>
              {!isCar && (
                <AField label="Total rooms">
                  <AInput inputMode="numeric" value={totalRooms} onChange={(e) => setTotalRooms(e.target.value)} placeholder="e.g. 210" />
                </AField>
              )}
              <AField label={isCar ? 'Fleet description' : 'Subtype'} className={isCar ? 'md:col-span-2' : ''}>
                <AInput value={subtype} onChange={(e) => setSubtype(e.target.value)} placeholder={isCar ? 'e.g. 14 vehicles, 2019 or newer' : 'business hotel · boutique · guesthouse'} />
              </AField>
              <AField label="Address" className="md:col-span-2">
                <AInput value={address} onChange={(e) => setAddress(e.target.value)} />
              </AField>
              <AField label="Switchboard phone">
                <AInput value={phone} onChange={(e) => setPhone(e.target.value)} />
              </AField>
              <AField label="Description — exactly what matters, no brochure talk" className="md:col-span-3">
                <ATextarea value={description} onChange={(e) => setDescription(e.target.value)} />
              </AField>
            </div>
          </ACard>

          {/* ---------------- front office ---------------- */}
          <ACard
            title="Front office"
            sub="Every contact here gets the request link, by WhatsApp and email — whoever answers first acts for the vendor."
            right={contacts.length < 6 ? (
              <ABtn variant="ghost" className="py-1.5" onClick={() => setContacts((cs) => [...cs, { name: '', whatsapp: '', email: '' }])}>
                + Add contact
              </ABtn>
            ) : undefined}
          >
            <div className="space-y-2">
              {contacts.map((c, i) => (
                <div key={i} className="grid items-end gap-2 md:grid-cols-[1fr_1fr_1fr_2rem]">
                  <AField label={i === 0 ? 'Contact / desk name' : ''}>
                    <AInput value={c.name} onChange={(e) => setContacts((cs) => cs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Reservations desk" />
                  </AField>
                  <AField label={i === 0 ? 'WhatsApp' : ''}>
                    <AInput value={c.whatsapp} onChange={(e) => setContacts((cs) => cs.map((x, j) => (j === i ? { ...x, whatsapp: e.target.value } : x)))} placeholder="+92 3xx xxx xxxx" />
                  </AField>
                  <AField label={i === 0 ? 'Email' : ''}>
                    <AInput value={c.email} onChange={(e) => setContacts((cs) => cs.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} placeholder="reservations@…" />
                  </AField>
                  {contacts.length > 1 ? (
                    <button type="button" aria-label="Remove contact" className="pb-3 text-ink/35 hover:text-ink" onClick={() => setContacts((cs) => cs.filter((_, j) => j !== i))}>
                      ✕
                    </button>
                  ) : (
                    <span />
                  )}
                </div>
              ))}
            </div>

            {/* Portal access — standing logins on top of the magic links. */}
            {contacts.some((c) => c.email.trim()) && (
              <div className="mt-4 border-t border-hairline pt-4">
                <div className="mb-2 text-[12.5px] font-semibold text-ink/60">
                  Vendor portal access
                  <span className="ml-2 font-normal text-ink/45">
                    Standing sign-in at corlington.pk — upcoming arrivals, guest names, settlements. Requests are still answered from the link.
                  </span>
                </div>
                {portalIssued && (
                  <Notice tone="ok">
                    Password for <b className="tabular">{portalIssued.email}</b>:&nbsp;
                    <b className="tabular select-all text-[15px]">{portalIssued.password}</b>
                    <button
                      type="button"
                      className="ml-2 rounded-md bg-sage px-2 py-0.5 text-[11.5px] font-semibold text-deep"
                      onClick={() => navigator.clipboard?.writeText(portalIssued.password)}
                    >
                      copy
                    </button>
                    <span className="ml-2 text-ink/55">Shown once — pass it to the hotel securely.</span>
                  </Notice>
                )}
                <ul className="mt-2 space-y-1.5">
                  {contacts.filter((c) => c.email.trim()).map((c) => (
                    <li key={c.email} className="flex flex-wrap items-center gap-2.5 text-[13px]">
                      <span className="min-w-0 flex-1 truncate">
                        <b>{c.name || 'Front office'}</b> · {c.email.trim().toLowerCase()}
                      </span>
                      {c.auth_user_id ? <Chip tone="ok">portal on</Chip> : <Chip tone="wait">no login yet</Chip>}
                      {c.id ? (
                        <ABtn
                          type="button"
                          variant="ghost"
                          className="px-3 py-1.5 text-[12.5px]"
                          disabled={portalBusy === c.id}
                          onClick={() => grantPortal(c.id!)}
                        >
                          {portalBusy === c.id ? 'Working…' : c.auth_user_id ? 'Issue new password' : 'Give access + password'}
                        </ABtn>
                      ) : (
                        <span className="text-[11.5px] text-ink/45">save the vendor first</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </ACard>

          {/* ---------------- agreement & credit ---------------- */}
          <ACard title="Agreement & credit" sub="The tier is set by the signed agreement; it decides which corporates book here on credit.">
            <div className="mb-3 flex flex-wrap gap-2">
              {CREDIT_TIERS.map((t) => (
                <ChipToggle key={t.code} on={creditTier === t.code} onClick={() => setCreditTier(t.code)} title={t.hint}>
                  {t.label}
                </ChipToggle>
              ))}
            </div>
            <p className="mb-4 text-xs text-ink/55">{CREDIT_TIERS.find((t) => t.code === creditTier)?.hint} · hotels are settled within 30 days of month-end.</p>
            <div className="grid gap-3 md:grid-cols-3">
              <AField label="Commission %"><AInput inputMode="decimal" value={commission} onChange={(e) => setCommission(e.target.value)} placeholder="12" /></AField>
              <div className="md:col-span-2">
                <span className="mb-1.5 block text-[12.5px] font-semibold text-ink/60">Agreement on file</span>
                <p className="text-[13.5px]">
                  {agreementOnFile?.signed
                    ? <span className="text-deep">Signed · {new Date(agreementOnFile.when!).toLocaleDateString('en-GB')}</span>
                    : agreementOnFile
                      ? <span className="text-brass">Recorded, not yet signed</span>
                      : <span className="text-ink/50">Nothing recorded yet</span>}
                </p>
              </div>
            </div>
            <div className="mt-3">
              <Toggle on={recordAgreement} onChange={setRecordAgreement} label="Record a signed agreement now" hint="Appends a versioned record — non-circumvention, rate parity and default-split clauses are in the template." />
              {recordAgreement && (
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <label className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" checked={signedDigital} onChange={(e) => setSignedDigital(e.target.checked)} /> Signed digitally</label>
                  <label className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" checked={signedPhysical} onChange={(e) => setSignedPhysical(e.target.checked)} /> Signed on paper</label>
                  <input type="file" accept=".pdf,image/*" onChange={(e) => setAgreementFile(e.target.files?.[0] ?? null)} className="text-[13px]" />
                </div>
              )}
            </div>
          </ACard>

          {/* ---------------- categories & rate card ---------------- */}
          <ACard
            title={isCar ? 'Vehicle classes & rate card' : 'Room categories & rate card'}
            sub="These rates are the contracted ceiling — hotels can only counter below them, never above."
            right={<ABtn variant="ghost" className="py-1.5" onClick={() => setListings((ls) => [...ls, emptyListing(categories[Math.min(ls.length, Math.max(0, categories.length - 1))] ?? '')])}>+ Add</ABtn>}
          >
            {listings.length === 0 && <p className="text-sm text-ink/50">No {isCar ? 'vehicle classes' : 'categories'} yet.</p>}
            <div className="space-y-4">
              {listings.map((l, i) => {
                const gallery = photos.filter((p) => p.listing_name === l.name)
                return (
                  <div key={i} className={`rounded-2xl border-[1.5px] border-hairline p-4 ${l.active ? '' : 'opacity-60'}`}>
                    <div className="grid gap-3 md:grid-cols-4">
                      {categories.length > 0 && (
                        <AField label={isCar ? 'Class' : 'Type'}>
                          <ASelect value={l.category} onChange={(e) => setListing(i, { category: e.target.value })}>
                            <option value="">—</option>
                            {categories.map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </ASelect>
                        </AField>
                      )}
                      <AField
                        label={isCar ? 'Model' : "Room category — the hotel's own name for it"}
                        className={categories.length > 0 ? 'md:col-span-2' : 'md:col-span-3'}
                      >
                        <AInput value={l.name} onChange={(e) => setListing(i, { name: e.target.value })} placeholder={isCar ? 'Toyota Corolla Altis 1.6' : 'Standard twin'} />
                      </AField>
                      <AField label={isCar ? 'Passengers (max)' : 'Max occupancy'}>
                        <AInput inputMode="numeric" value={l.max_occupancy} onChange={(e) => setListing(i, { max_occupancy: Math.max(1, Math.min(20, parseInt(e.target.value) || 1)) })} />
                      </AField>
                      {!isCar && (
                        <>
                          <AField label="Bed configuration"><AInput value={l.bed_config} onChange={(e) => setListing(i, { bed_config: e.target.value })} placeholder="1 king · 2 twin" /></AField>
                          <AField label="Size m²"><AInput inputMode="numeric" value={l.size_sqm} onChange={(e) => setListing(i, { size_sqm: e.target.value })} /></AField>
                        </>
                      )}
                      <AField label="What's different about it" className={isCar ? 'md:col-span-3' : 'md:col-span-2'}>
                        <AInput value={l.description} onChange={(e) => setListing(i, { description: e.target.value })} placeholder={isCar ? '2023 · insured · tracker' : 'sea view · bathtub · 28 m²'} />
                      </AField>
                      {!isCar && <div />}
                      {packages.map((p) => (
                        <AField key={p.code} label={p.label} hint={`${p.unit} · ${p.code}`}>
                          <AInput inputMode="numeric" value={l.rates[p.code] ?? ''} onChange={(e) => setRate(i, p.code, e.target.value)} placeholder="PKR" className="tabular text-right" />
                        </AField>
                      ))}
                      <div className="flex items-end gap-2 pb-5">
                        <ChipToggle on={l.active} onClick={() => setListing(i, { active: !l.active })}>{l.active ? 'Active' : 'Inactive'}</ChipToggle>
                      </div>
                    </div>

                    {/* gallery */}
                    <div className="mt-3 border-t border-paper pt-3">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="text-[12.5px] font-semibold text-ink/60">{isCar ? 'Vehicle photos' : 'Room-type gallery — label every photo'}</span>
                        <Chip tone={gallery.length >= GALLERY_MIN ? 'ok' : 'hot'}>{gallery.length} / {GALLERY_MIN} minimum</Chip>
                        {!isCar && CATEGORY_REQUIRED.map((k) => {
                          const has = gallery.some((p) => p.shot_type === k)
                          return <Chip key={k} tone={has ? 'ok' : 'wait'}>{has ? '✓ ' : ''}{CATEGORY_SHOTS.find((c) => c.key === k)?.label}</Chip>
                        })}
                        {!l.name.trim() && <span className="text-xs text-brass">name the {isCar ? 'model' : 'room'} first</span>}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {gallery.map((p) => (
                          <div key={p.storage_path} className="flex flex-col gap-1">
                            <Thumb photo={p} onRemove={() => removePhoto(p.storage_path)} />
                            {!isCar && (
                              <select
                                className="w-[88px] rounded-md border border-hairline bg-white px-1 py-0.5 text-[10.5px] text-ink/70"
                                value={p.shot_type}
                                onChange={(e) => setPhotoType(p.storage_path, e.target.value)}
                                aria-label="Label this photo"
                              >
                                {p.shot_type === 'category' && <option value="category">unlabeled</option>}
                                {CATEGORY_SHOTS.map((c) => (
                                  <option key={c.key} value={c.key}>{c.label}</option>
                                ))}
                              </select>
                            )}
                          </div>
                        ))}
                        {l.name.trim() && (
                          <UploadBox
                            label="+ Add photos"
                            hint={isCar ? 'real vehicles' : 'label each after upload'}
                            multiple
                            busy={uploading === l.name}
                            onFiles={(f) => upload(f, { shot_type: isCar ? 'category' : 'detail', listing_name: l.name })}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </ACard>

          {/* ---------------- shot list ---------------- */}
          {!isCar ? (
            <ACard title="Property shot list — 8 required" sub="Entrance to breakfast, the same eight for every property — bookers compare like with like. The front door becomes the cover.">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {SHOT_LIST.map((s) => {
                  const p = propertyPhoto(s.key)
                  return p ? (
                    <div key={s.key} className="relative overflow-hidden rounded-xl bg-paper">
                      <img src={p.previewUrl} alt={s.label} className="aspect-[4/3] w-full object-cover" />
                      <div className="flex items-center justify-between px-2 py-1.5 text-[11.5px]">
                        <span className="font-semibold text-deep">✓ {s.label}</span>
                        <span className="flex gap-2">
                          <label className="cursor-pointer text-pine">replace<input type="file" accept="image/*" className="hidden" onChange={(e) => upload(e.target.files, { shot_type: s.key, listing_name: '' })} /></label>
                          <button type="button" className="text-ink/40" onClick={() => assignShot(p.storage_path, 'other')}>unassign</button>
                        </span>
                      </div>
                    </div>
                  ) : (
                    <UploadBox key={s.key} label={s.label} hint={s.hint} busy={uploading === s.key} onFiles={(f) => upload(f, { shot_type: s.key, listing_name: '' })} tall />
                  )
                })}
              </div>
              <div className="mt-4 border-t border-paper pt-3">
                <div className="mb-2 text-[12.5px] font-semibold text-ink/60">More property photos (optional)</div>
                <div className="flex flex-wrap gap-2">
                  {otherPhotos.map((p) => (
                    <div key={p.storage_path} className="flex flex-col gap-1">
                      <Thumb photo={p} onRemove={() => removePhoto(p.storage_path)} />
                      <select
                        className="w-[88px] rounded-md border border-hairline bg-white px-1 py-0.5 text-[10.5px] text-ink/70"
                        value=""
                        onChange={(e) => e.target.value && assignShot(p.storage_path, e.target.value)}
                        aria-label="Use this photo as a shot-list slot"
                      >
                        <option value="">use as…</option>
                        {SHOT_LIST.map((s) => (
                          <option key={s.key} value={s.key}>{s.label}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                  <UploadBox label="+ Add" hint="exterior, dining, meeting rooms" multiple busy={uploading === 'other'} onFiles={(f) => upload(f, { shot_type: 'other', listing_name: '' })} />
                </div>
              </div>
            </ACard>
          ) : (
            <ACard title="Fleet photos" sub="Real vehicles, not brochure renders — at least three across the fleet.">
              <div className="flex flex-wrap gap-2">
                {otherPhotos.map((p) => <Thumb key={p.storage_path} photo={p} onRemove={() => removePhoto(p.storage_path)} />)}
                <UploadBox label="+ Add photos" hint="fleet, interiors, documents" multiple busy={uploading === 'other'} onFiles={(f) => upload(f, { shot_type: 'other', listing_name: '' })} />
              </div>
            </ACard>
          )}

          {/* ---------------- amenities & courtesies ---------------- */}
          {!isCar && (
            <ACard title="Verified amenities & corporate courtesies" sub="Only what we have checked on site counts — unverified claims never reach a booker.">
              <div className="mb-1 text-[12.5px] font-semibold text-ink/60">Verified on the site visit</div>
              <div className="mb-4 flex flex-wrap gap-2">
                {amenityList.map((a) => (
                  <ChipToggle key={a.code} on={!!verified[a.code]} onClick={() => setVerified((v) => ({ ...v, [a.code]: !v[a.code] }))}>
                    {verified[a.code] ? '✓ ' : ''}{a.label}
                  </ChipToggle>
                ))}
              </div>
              <div className="mb-1 text-[12.5px] font-semibold text-ink/60">Corporate courtesies — the standard practices</div>
              <div className="mb-2 flex flex-wrap gap-2">
                {[...new Set([...COURTESIES, ...courtesies])].map((c) => (
                  <ChipToggle key={c} on={courtesies.includes(c)} onClick={() => setCourtesies((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]))}>
                    {c}
                  </ChipToggle>
                ))}
              </div>
              <div className="mb-4 flex gap-2">
                <AInput value={customCourtesy} onChange={(e) => setCustomCourtesy(e.target.value)} placeholder="Add another courtesy…" className="max-w-xs" />
                <ABtn variant="ghost" onClick={() => { if (customCourtesy.trim()) { setCourtesies((cs) => [...cs, customCourtesy.trim()]); setCustomCourtesy('') } }}>Add</ABtn>
              </div>
              <Toggle on={airportTransfer} onChange={setAirportTransfer} label="Airport transfer included" hint="Shown as a glance tile on the property page." />
              <AField label="Included with every stay — one per line" className="mt-3" hint="Breakfast type, wifi, water…">
                <ATextarea value={inclusions} onChange={(e) => setInclusions(e.target.value)} />
              </AField>
            </ACard>
          )}

          {/* ---------------- policies ---------------- */}
          <ACard title="Policies" sub="Frozen onto every voucher exactly as written here.">
            <div className="grid gap-3 md:grid-cols-2">
              {!isCar && (
                <>
                  <AField label="Check-in from"><AInput type="time" value={checkinTime} onChange={(e) => setCheckinTime(e.target.value)} /></AField>
                  <AField label="Check-out by"><AInput type="time" value={checkoutTime} onChange={(e) => setCheckoutTime(e.target.value)} /></AField>
                </>
              )}
              <AField label="Cancellation"><ATextarea value={cancellationPolicy} onChange={(e) => setCancellationPolicy(e.target.value)} /></AField>
              <AField label="No-show"><ATextarea value={noshowPolicy} onChange={(e) => setNoshowPolicy(e.target.value)} /></AField>
              <AField label="Internal notes (ops only)" className="md:col-span-2"><ATextarea value={notes} onChange={(e) => setNotes(e.target.value)} /></AField>
            </div>
          </ACard>
        </div>

        {/* ---------------- spine ---------------- */}
        <aside className="space-y-4 lg:sticky lg:top-[72px]">
          <ACard>
            <AField
              label="Status"
              hint={
                status === 'live' && !ready
                  ? wasLive
                    ? 'Live since before the plan existed — complete it anyway.'
                    : 'Blocked until the plan is complete.'
                  : undefined
              }
            >
              <ASelect value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="prospect">Prospect</option>
                <option value="onboarding">Onboarding</option>
                <option value="live" disabled={!ready && !wasLive}>Live{ready || wasLive ? '' : ' — plan incomplete'}</option>
                <option value="suspended">Suspended</option>
              </ASelect>
            </AField>
            <div className="mt-4">
              <Plan steps={steps} />
            </div>
            {ready && status !== 'live' && (
              <div className="mt-3">
                <Notice tone="ok">All steps done — set status to Live and save.</Notice>
              </div>
            )}
            <div className="mt-4 space-y-2">
              {error && <Notice tone="error">{error}</Notice>}
              {saved && <Notice tone="ok">{saved}</Notice>}
              <ABtn className="w-full" onClick={save} disabled={busy || !!uploading}>
                {busy ? 'Saving…' : isNew ? 'Create vendor' : 'Save changes'}
              </ABtn>
              <p className="text-center text-[11.5px] text-ink/50">One save writes everything — audit-logged under your name.</p>
            </div>
          </ACard>
        </aside>
      </div>
    </div>
  )
}

function Thumb({ photo, onRemove }: { photo: PhotoDraft; onRemove: () => void }) {
  return (
    <div className="relative size-[88px] overflow-hidden rounded-xl bg-paper">
      {photo.previewUrl ? <img src={photo.previewUrl} alt="" className="size-full object-cover" /> : <div className="grid size-full place-items-center text-[10px] text-ink/40">no preview</div>}
      <button type="button" onClick={onRemove} className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-white/90 text-[11px] text-ink/70" aria-label="Remove photo">✕</button>
    </div>
  )
}

function UploadBox({
  label,
  hint,
  onFiles,
  multiple,
  busy,
  tall,
}: {
  label: string
  hint?: string
  onFiles: (files: FileList | null) => void
  multiple?: boolean
  busy?: boolean
  tall?: boolean
}) {
  return (
    <label
      className={`grid cursor-pointer place-items-center rounded-xl border-[1.5px] border-dashed border-hairline px-2 text-center hover:border-brass ${
        tall ? 'aspect-[4/3]' : 'size-[88px]'
      }`}
    >
      <span>
        <span className="block text-[12px] font-semibold text-deep">{busy ? 'Uploading…' : label}</span>
        {hint && tall && <span className="block text-[10.5px] text-ink/50">{hint}</span>}
      </span>
      <input type="file" accept="image/*" multiple={multiple} className="hidden" disabled={busy} onChange={(e: ChangeEvent<HTMLInputElement>) => { onFiles(e.target.files); e.target.value = '' }} />
    </label>
  )
}
