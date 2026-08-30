import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { upsertBookingFile, ApiError } from '@/lib/api'
import { countdown, datePkt } from '@/lib/format'
import { ABtn, ACard, AField, AInput, ChipToggle, Notice, Toggle } from '@/components/atlas'
import { OffersBoard } from './OffersBoard'

/**
 * The booking file (Atlas, per the approved prototype): one form, the services
 * as segments, area chips with self-explaining descriptors, the landmark →
 * area suggestion from migration 020, guest steppers, and the dark spine that
 * live-summarizes the draft. Drafts save through ef_upsert_booking_file and
 * reload from the row, so closing the browser mid-thought costs nothing.
 */

interface RoomDraft {
  guests: number
}

interface CorridorRow {
  id: string
  name: string
  descriptor: string | null
  grouping: string | null
}

interface LandmarkRow {
  id: string
  name: string
  aliases: string[]
  corridor_id: string
  note: string | null
}

export function FileEditor() {
  const { id } = useParams()
  const isNew = !id || id === 'new'
  const navigate = useNavigate()

  const [corridors, setCorridors] = useState<CorridorRow[]>([])
  const [landmarks, setLandmarks] = useState<LandmarkRow[]>([])
  const [dealbreakerOptions, setDealbreakerOptions] = useState<{ code: string; label: string }[]>([])

  const [ref, setRef] = useState<string | null>(null)
  const [fileStatus, setFileStatus] = useState('draft')
  const [service, setService] = useState<'hotel' | 'car'>('hotel')
  const [name, setName] = useState('')
  const [checkIn, setCheckIn] = useState('')
  const [checkOut, setCheckOut] = useState('')
  const [rooms, setRooms] = useState<RoomDraft[]>([{ guests: 1 }])
  const [dealbreakers, setDealbreakers] = useState<Set<string>>(new Set())
  const [corridorId, setCorridorId] = useState('')
  const [autoAccept, setAutoAccept] = useState(false)
  const [travelers, setTravelers] = useState<{ name: string; email: string; phone: string }[]>([])
  const [meetingQuery, setMeetingQuery] = useState('')
  const [meetingPick, setMeetingPick] = useState<LandmarkRow | null>(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(isNew)
  const [windowExpiresAt, setWindowExpiresAt] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const [refreshKey, setRefreshKey] = useState(0)
  const [booking, setBooking] = useState<{
    grand_total_pkr: number
    nights: number
    vendors: { name: string } | null
  } | null>(null)

  useEffect(() => {
    if (!windowExpiresAt) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [windowExpiresAt])

  const windowRemaining = windowExpiresAt ? new Date(windowExpiresAt).getTime() - now : null
  const windowOpen = windowRemaining !== null && windowRemaining > 0
  const readOnly = fileStatus !== 'draft'
  const isCar = service === 'car'

  useEffect(() => {
    supabase.from('corridors').select('id, name, descriptor, grouping').order('sort')
      .then(({ data }) => setCorridors((data ?? []) as CorridorRow[]))
    supabase.from('landmarks').select('id, name, aliases, corridor_id, note').order('name')
      .then(({ data }) => setLandmarks((data ?? []) as LandmarkRow[]))
    supabase.from('amenities').select('code, label').eq('dealbreaker_eligible', true).order('label')
      .then(({ data }) => setDealbreakerOptions(data ?? []))
  }, [])

  useEffect(() => {
    if (isNew) return
    async function load() {
      const [f, t] = await Promise.all([
        supabase.from('booking_files').select('*').eq('id', id).single(),
        supabase.from('travelers').select('name, email, phone').eq('booking_file_id', id).order('name'),
      ])
      if (f.error) {
        setError(f.error.message)
        return
      }
      setRef(f.data.ref)
      setFileStatus(f.data.status)
      setService(f.data.service ?? 'hotel')
      setName(f.data.name)
      setCheckIn(f.data.check_in)
      setCheckOut(f.data.check_out)
      setRooms(Array.isArray(f.data.rooms) && f.data.rooms.length ? f.data.rooms : [{ guests: 1 }])
      setDealbreakers(new Set((f.data.dealbreakers ?? []) as string[]))
      setCorridorId(f.data.corridor_id ?? '')
      setAutoAccept(f.data.auto_accept)
      setWindowExpiresAt(f.data.window_expires_at)

      if (f.data.status === 'confirmed' || f.data.status === 'completed') {
        const { data: bk } = await supabase
          .from('bookings')
          .select('grand_total_pkr, nights, vendors(name)')
          .eq('booking_file_id', id)
          .maybeSingle()
        setBooking((bk as never) ?? null)
      }
      setTravelers((t.data ?? []).map((x) => ({ name: x.name, email: x.email ?? '', phone: x.phone ?? '' })))
      setLoaded(true)
    }
    load()
  }, [id, isNew, refreshKey])

  const nights = useMemo(() => {
    if (!checkIn || !checkOut) return null
    const n = Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86_400_000)
    return n > 0 ? n : null
  }, [checkIn, checkOut])

  const guests = rooms.reduce((s, r) => s + r.guests, 0)
  const corridor = corridors.find((c) => c.id === corridorId) ?? null

  // Landmark suggestions: match name or any alias, case-insensitively.
  const suggestions = useMemo(() => {
    const q = meetingQuery.trim().toLowerCase()
    if (q.length < 2 || meetingPick) return []
    return landmarks
      .filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          l.aliases.some((a) => a.toLowerCase().includes(q)),
      )
      .slice(0, 6)
  }, [meetingQuery, landmarks, meetingPick])

  function pickLandmark(l: LandmarkRow) {
    setMeetingPick(l)
    setMeetingQuery(l.name)
    setCorridorId(l.corridor_id)
  }

  async function save(e: FormEvent, thenResults = false) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { file } = await upsertBookingFile({
        file: {
          ...(isNew ? {} : { id }),
          name: name.trim(),
          service,
          check_in: checkIn,
          check_out: checkOut,
          rooms,
          dealbreakers: [...dealbreakers],
          corridor_id: corridorId || null,
          auto_accept: autoAccept,
        },
        travelers: travelers
          .filter((t) => t.name.trim())
          .map((t) => ({
            name: t.name.trim(),
            email: t.email.trim() || undefined,
            phone: t.phone.trim() || undefined,
          })),
      })
      setSavedAt(new Date().toLocaleTimeString())
      if (thenResults) {
        navigate(`/files/${file.id}/results`)
      } else if (isNew) {
        navigate(`/files/${file.id}`, { replace: true })
      } else {
        setRef(file.ref)
      }
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  if (!loaded && !error) return <p className="text-sm text-ink/50">Loading…</p>

  const cap = isCar ? 12 : 6
  const findLabel = isCar ? 'Save & find cars' : 'Save & find hotels'

  return (
    <form onSubmit={(e) => save(e)} className="grid items-start gap-5 lg:grid-cols-[1fr_300px]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-[26px]">{isNew ? 'New booking file' : name || 'Booking file'}</h1>
          <button type="button" className="text-[13px] font-semibold text-pine" onClick={() => navigate('/files')}>
            ← Home
          </button>
        </div>

        {error && <Notice tone="error">{error}</Notice>}
        {readOnly && !booking && (
          <Notice>This request has been sent — the form is locked while hotels answer.</Notice>
        )}
        {booking && (
          <Notice tone="ok">
            Booked — {booking.vendors?.name} · {booking.nights} night{booking.nights > 1 ? 's' : ''} ·
            total <span className="tabular font-semibold">PKR {booking.grand_total_pkr.toLocaleString('en-PK')}</span>.
            Nothing payable at the desk except personal extras.
          </Notice>
        )}

        {!isNew && readOnly && id && (
          <OffersBoard
            fileId={id}
            windowOpen={windowOpen}
            nights={nights}
            roomsCount={rooms.length}
            onBooked={() => setRefreshKey((k) => k + 1)}
          />
        )}

        <fieldset disabled={readOnly} className="space-y-4">
          {isNew && (
            <div className="flex rounded-2xl bg-white p-1 shadow-[inset_0_0_0_1.5px_#E3E9E4]">
              {(
                [
                  { key: 'hotel', label: 'Hotels', act: () => setService('hotel') },
                  { key: 'apt', label: 'Apartments', soon: true, act: () => undefined },
                  { key: 'car', label: 'Rent-a-car', act: () => setService('car') },
                  { key: 'transfer', label: 'Airport transfer', act: () => navigate('/transfers') },
                ] as const
              ).map((s) => {
                const on = ('soon' in s && s.soon) ? false : service === s.key
                return (
                  <button
                    key={s.key}
                    type="button"
                    disabled={'soon' in s && s.soon}
                    title={'soon' in s && s.soon ? 'Apartments are coming soon' : undefined}
                    className={`flex-1 rounded-xl px-2 py-2.5 text-[13.5px] font-semibold transition ${
                      on ? 'bg-deep text-white' : 'text-ink/55 hover:text-ink disabled:text-ink/30'
                    }`}
                    onClick={s.act}
                  >
                    {s.label}
                    {'soon' in s && s.soon && <span className="block text-[10px] font-medium opacity-70">coming soon</span>}
                  </button>
                )
              })}
            </div>
          )}

          <ACard title={isCar ? 'Rental' : 'Trip'}>
            <div className="grid gap-3">
              <AField label="File name — for your own list">
                <AInput required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Audit team, September" />
              </AField>
              <div className="grid gap-3 sm:grid-cols-2">
                <AField label={isCar ? 'From (first day)' : 'Check-in'}>
                  <AInput type="date" required value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
                </AField>
                <AField label={isCar ? 'Until (return day)' : 'Check-out'}>
                  <AInput type="date" required value={checkOut} min={checkIn || undefined} onChange={(e) => setCheckOut(e.target.value)} />
                </AField>
              </div>

              {!isCar && (
                <>
                  <div className="relative">
                    <AField label="Where is your meeting? — optional, we suggest the area" >
                      <AInput
                        value={meetingQuery}
                        onChange={(e) => {
                          setMeetingQuery(e.target.value)
                          setMeetingPick(null)
                        }}
                        placeholder="e.g. Expo Centre, Aga Khan Hospital, Korangi…"
                      />
                    </AField>
                    {suggestions.length > 0 && (
                      <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-hairline bg-white shadow-lg">
                        {suggestions.map((l) => (
                          <li key={l.id}>
                            <button
                              type="button"
                              className="flex w-full items-baseline justify-between gap-3 px-3.5 py-2.5 text-left text-[13.5px] hover:bg-paper"
                              onClick={() => pickLandmark(l)}
                            >
                              <span className="font-semibold">{l.name}</span>
                              <span className="text-[11.5px] text-ink/50">
                                {corridors.find((c) => c.id === l.corridor_id)?.name}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {meetingPick && (
                      <p className="mt-1.5 rounded-xl bg-sage px-3 py-2 text-[12.5px] text-deep">
                        <b className="font-semibold">{meetingPick.name}</b> → stay in{' '}
                        <b className="font-semibold">{corridors.find((c) => c.id === meetingPick.corridor_id)?.name}</b>
                        {meetingPick.note ? ` · ${meetingPick.note}` : ''}
                        <button
                          type="button"
                          className="ml-2 font-semibold text-pine"
                          onClick={() => {
                            setMeetingPick(null)
                            setMeetingQuery('')
                          }}
                        >
                          clear
                        </button>
                      </p>
                    )}
                  </div>

                  <div>
                    <span className="mb-1.5 block text-[12.5px] font-semibold text-ink/60">Area — optional, narrows the search</span>
                    <div className="flex flex-wrap gap-2">
                      <ChipToggle on={!corridorId} onClick={() => { setCorridorId(''); setMeetingPick(null) }}>
                        Anywhere
                      </ChipToggle>
                      {corridors.map((c) => (
                        <ChipToggle key={c.id} on={corridorId === c.id} onClick={() => setCorridorId(c.id)} title={c.descriptor ?? undefined}>
                          {c.name}
                        </ChipToggle>
                      ))}
                    </div>
                    {corridor?.descriptor && (
                      <p className="mt-2 text-[12.5px] text-ink/55">{corridor.descriptor}</p>
                    )}
                  </div>
                </>
              )}
            </div>
          </ACard>

          <ACard title={isCar ? 'Vehicles & passengers' : 'Rooms & guests'}>
            <div>
              {rooms.map((r, i) => (
                <div key={i} className="flex items-center gap-3 border-b border-paper py-2.5 last:border-0">
                  <span className="w-[84px] text-[13.5px] font-semibold">
                    {isCar ? 'Vehicle' : 'Room'} {i + 1}
                  </span>
                  <div className="flex items-center gap-3 rounded-xl bg-paper p-1">
                    <button
                      type="button"
                      aria-label="Fewer"
                      className="size-[30px] rounded-lg bg-white font-semibold text-deep shadow-[0_1px_2px_rgba(20,36,31,.1)]"
                      onClick={() => setRooms((rs) => rs.map((x, j) => (j === i ? { guests: Math.max(1, x.guests - 1) } : x)))}
                    >
                      −
                    </button>
                    <span className="tabular min-w-[86px] text-center text-[14px] font-semibold">
                      {r.guests} {isCar ? 'passenger' : 'guest'}{r.guests > 1 ? 's' : ''}
                    </span>
                    <button
                      type="button"
                      aria-label="More"
                      className="size-[30px] rounded-lg bg-white font-semibold text-deep shadow-[0_1px_2px_rgba(20,36,31,.1)]"
                      onClick={() => setRooms((rs) => rs.map((x, j) => (j === i ? { guests: Math.min(cap, x.guests + 1) } : x)))}
                    >
                      +
                    </button>
                  </div>
                  {rooms.length > 1 && (
                    <button
                      type="button"
                      aria-label={`Remove ${isCar ? 'vehicle' : 'room'} ${i + 1}`}
                      className="ml-auto text-[15px] text-ink/35 hover:text-ink"
                      onClick={() => setRooms((rs) => rs.filter((_, j) => j !== i))}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {rooms.length < 9 && (
                <button
                  type="button"
                  className="mt-2 text-[13px] font-semibold text-pine"
                  onClick={() => setRooms((rs) => [...rs, { guests: 1 }])}
                >
                  + Add another
                </button>
              )}
            </div>
          </ACard>

          {!isCar && dealbreakerOptions.length > 0 && (
            <ACard title="Deal-breakers" sub="Hotels missing any of these are excluded — only amenities we've verified on site count.">
              <div className="flex flex-wrap gap-2">
                {dealbreakerOptions.map((a) => (
                  <ChipToggle
                    key={a.code}
                    on={dealbreakers.has(a.code)}
                    onClick={() =>
                      setDealbreakers((d) => {
                        const next = new Set(d)
                        if (next.has(a.code)) next.delete(a.code)
                        else next.add(a.code)
                        return next
                      })
                    }
                  >
                    {a.label}
                  </ChipToggle>
                ))}
              </div>
            </ACard>
          )}

          <ACard>
            <Toggle
              on={autoAccept}
              onChange={setAutoAccept}
              label="Auto-accept the first offer"
              hint="For urgent trips: the first hotel to accept is booked instantly — no second look. Leave off to compare offers yourself."
            />
          </ACard>

          <ACard title="Travelers" sub="Optional now — vouchers are emailed to travelers once details exist.">
            <div className="space-y-2">
              {travelers.map((t, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_9rem_2rem] items-center gap-2">
                  <AInput placeholder="Name" value={t.name}
                    onChange={(e) => setTravelers((ts) => ts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  <AInput type="email" placeholder="email (optional)" value={t.email}
                    onChange={(e) => setTravelers((ts) => ts.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} />
                  <AInput placeholder="+92… (optional)" value={t.phone}
                    onChange={(e) => setTravelers((ts) => ts.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)))} />
                  <button type="button" aria-label="Remove traveler" className="text-ink/35 hover:text-ink"
                    onClick={() => setTravelers((ts) => ts.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="text-[13px] font-semibold text-pine"
                onClick={() => setTravelers((ts) => [...ts, { name: '', email: '', phone: '' }])}
              >
                + Add traveler
              </button>
            </div>
          </ACard>
        </fieldset>
      </div>

      {/* ---- the spine ------------------------------------------------------ */}
      <aside className="overflow-hidden rounded-[20px] bg-white shadow-[0_1px_3px_rgba(20,36,31,.05),0_14px_36px_-22px_rgba(20,36,31,.16)] lg:sticky lg:top-[76px]">
        <div className="bg-deep px-5 py-4 text-white">
          <div className="tabular text-xs font-semibold text-[#e8c789]">
            {ref ?? 'CF-····-KHI'} · {fileStatus === 'draft' ? 'draft' : fileStatus}
          </div>
          <div className="mt-0.5 font-display text-[16px] font-semibold">{name || 'Untitled file'}</div>
        </div>
        <dl className="px-5 py-3.5">
          <dt className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-ink/55">Stay</dt>
          <dd className="mt-0.5 text-[14px]">
            {checkIn && checkOut ? (
              <>
                {datePkt(checkIn)} → {datePkt(checkOut)}
                {nights ? ` · ${nights} ${isCar ? 'day' : 'night'}${nights > 1 ? 's' : ''}` : ''}
              </>
            ) : (
              '—'
            )}
          </dd>
          <dt className="mt-3 text-[11.5px] font-semibold uppercase tracking-[0.04em] text-ink/55">
            {isCar ? 'Vehicles' : 'Rooms'}
          </dt>
          <dd className="mt-0.5 font-display text-[15px] font-semibold text-deep">
            {rooms.length} {isCar ? 'vehicle' : 'room'}{rooms.length > 1 ? 's' : ''} · {guests}{' '}
            {isCar ? 'passenger' : 'guest'}{guests > 1 ? 's' : ''}
          </dd>
          {!isCar && (
            <>
              <dt className="mt-3 text-[11.5px] font-semibold uppercase tracking-[0.04em] text-ink/55">Area</dt>
              <dd className="mt-0.5 text-[14px]">{corridor?.name ?? 'Anywhere in Karachi'}</dd>
            </>
          )}
          <dt className="mt-3 text-[11.5px] font-semibold uppercase tracking-[0.04em] text-ink/55">Decision window</dt>
          <dd className="mt-0.5 text-[14px]">
            {windowOpen ? (
              <span className="tabular inline-block rounded-lg bg-[#FBF3E2] px-2 py-1 font-semibold text-brass">
                {countdown(windowRemaining!)}
              </span>
            ) : windowExpiresAt ? (
              <span className="text-ink/50">window ended</span>
            ) : (
              <span className="text-ink/50">starts when you send{autoAccept ? ' · auto-accept ON' : ''}</span>
            )}
          </dd>
        </dl>
        <div className="space-y-2 border-t border-paper px-5 pb-5 pt-3.5">
          {!readOnly && (
            <>
              <ABtn type="button" disabled={busy} className="w-full" onClick={(e) => save(e as unknown as FormEvent, true)}>
                {busy ? 'Saving…' : findLabel}
              </ABtn>
              <ABtn type="submit" variant="ghost" disabled={busy} className="w-full">
                Save draft
              </ABtn>
            </>
          )}
          {readOnly && !isNew && fileStatus === 'draft' && null}
          {savedAt && !error && <p className="text-center text-[11.5px] text-ink/45">Saved {savedAt}</p>}
          <p className="text-center text-[11.5px] text-ink/45">
            {readOnly ? 'Locked while hotels answer.' : 'Drafts save automatically — resume from home.'}
          </p>
        </div>
      </aside>
    </form>
  )
}
