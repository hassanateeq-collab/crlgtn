import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { upsertBookingFile, ApiError } from '@/lib/api'
import { datePkt } from '@/lib/format'
import { Button, Card, Field, Input, Notice } from '@/components/ui'

/**
 * The booking file form (spec §9) with the file spine — the signature element
 * from §10: ref, status, stay summary, and the slot where the decision-window
 * countdown lives from M5 on.
 *
 * Drafts are resumable by design: everything saves through
 * ef_upsert_booking_file and reloads from the row, so closing the browser
 * mid-thought costs nothing.
 */

interface RoomDraft {
  guests: number
}

export function FileEditor() {
  const { id } = useParams()
  const isNew = !id || id === 'new'
  const navigate = useNavigate()

  const [corridors, setCorridors] = useState<{ id: string; name: string }[]>([])
  const [dealbreakerOptions, setDealbreakerOptions] = useState<
    { code: string; label: string }[]
  >([])

  const [ref, setRef] = useState<string | null>(null)
  const [fileStatus, setFileStatus] = useState('draft')
  const [name, setName] = useState('')
  const [checkIn, setCheckIn] = useState('')
  const [checkOut, setCheckOut] = useState('')
  const [rooms, setRooms] = useState<RoomDraft[]>([{ guests: 1 }])
  const [dealbreakers, setDealbreakers] = useState<Set<string>>(new Set())
  const [corridorId, setCorridorId] = useState('')
  const [autoAccept, setAutoAccept] = useState(false)
  const [travelers, setTravelers] = useState<{ name: string; email: string; phone: string }[]>([])

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(isNew)

  const readOnly = fileStatus !== 'draft'

  useEffect(() => {
    supabase.from('corridors').select('id, name').order('sort')
      .then(({ data }) => setCorridors(data ?? []))
    supabase
      .from('amenities')
      .select('code, label')
      .eq('dealbreaker_eligible', true)
      .order('label')
      .then(({ data }) => setDealbreakerOptions(data ?? []))
  }, [])

  useEffect(() => {
    if (isNew) return
    async function load() {
      const [f, t] = await Promise.all([
        supabase.from('booking_files').select('*').eq('id', id).single(),
        supabase
          .from('travelers')
          .select('name, email, phone')
          .eq('booking_file_id', id)
          .order('name'),
      ])
      if (f.error) {
        setError(f.error.message)
        return
      }
      setRef(f.data.ref)
      setFileStatus(f.data.status)
      setName(f.data.name)
      setCheckIn(f.data.check_in)
      setCheckOut(f.data.check_out)
      setRooms(
        Array.isArray(f.data.rooms) && f.data.rooms.length
          ? f.data.rooms
          : [{ guests: 1 }],
      )
      setDealbreakers(new Set((f.data.dealbreakers ?? []) as string[]))
      setCorridorId(f.data.corridor_id ?? '')
      setAutoAccept(f.data.auto_accept)
      setTravelers(
        (t.data ?? []).map((x) => ({
          name: x.name,
          email: x.email ?? '',
          phone: x.phone ?? '',
        })),
      )
      setLoaded(true)
    }
    load()
  }, [id, isNew])

  const nights = useMemo(() => {
    if (!checkIn || !checkOut) return null
    const n = Math.round(
      (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86_400_000,
    )
    return n > 0 ? n : null
  }, [checkIn, checkOut])

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { file } = await upsertBookingFile({
        file: {
          ...(isNew ? {} : { id }),
          name: name.trim(),
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
      if (isNew) {
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

  const selectCls =
    'w-full rounded-md border border-hairline bg-white px-3 py-2 text-sm text-ink focus:border-pine focus:outline-none'

  return (
    <form onSubmit={save} className="grid gap-6 lg:grid-cols-[16rem_1fr]">
      {/* ---- the spine ------------------------------------------------------ */}
      <aside className="h-fit rounded-lg border border-hairline bg-white lg:sticky lg:top-6">
        <div className="border-b border-hairline px-4 py-3">
          <div className="tabular text-sm text-deep">{ref ?? 'CF-····-KHI'}</div>
          <div className="mt-1 text-xs text-ink/50">
            {fileStatus === 'draft' ? 'draft — not sent' : fileStatus}
          </div>
        </div>
        <dl className="space-y-3 px-4 py-3 text-sm">
          <div>
            <dt className="text-xs text-ink/50">Stay</dt>
            <dd>
              {checkIn && checkOut ? (
                <>
                  {datePkt(checkIn)} → {datePkt(checkOut)}
                  {nights && (
                    <span className="tabular block text-xs text-ink/50">
                      {nights} night{nights > 1 ? 's' : ''}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-ink/40">—</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink/50">Rooms</dt>
            <dd className="tabular">
              {rooms.length} · {rooms.reduce((s, r) => s + r.guests, 0)} guests
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink/50">Decision window</dt>
            {/* Brass is reserved for exactly this — the countdown arrives at M5. */}
            <dd className="text-xs text-ink/40">starts when offers arrive</dd>
          </div>
        </dl>
        <div className="space-y-2 border-t border-hairline px-4 py-3">
          <Button type="submit" disabled={busy || readOnly} className="w-full">
            {busy ? 'Saving…' : readOnly ? 'Locked' : 'Save draft'}
          </Button>
          {!isNew && fileStatus === 'draft' && (
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => navigate(`/files/${id}/results`)}
            >
              Find hotels
            </Button>
          )}
          {savedAt && !error && (
            <p className="text-center text-xs text-ink/40">Saved {savedAt}</p>
          )}
        </div>
      </aside>

      {/* ---- the form ------------------------------------------------------- */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl">{isNew ? 'New booking file' : name || 'Booking file'}</h1>
          <Button type="button" variant="ghost" onClick={() => navigate('/files')}>
            Back to files
          </Button>
        </div>

        {error && <Notice tone="error">{error}</Notice>}
        {readOnly && (
          <Notice>This file has been sent and can no longer be edited.</Notice>
        )}

        <fieldset disabled={readOnly} className="space-y-6">
          <Card title="Trip">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="sm:col-span-3">
                <Field label="File name" hint="For your own list — e.g. 'Audit team, March visit'">
                  <Input required value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
              </div>
              <Field label="Check-in">
                <Input
                  type="date" required value={checkIn}
                  onChange={(e) => setCheckIn(e.target.value)}
                />
              </Field>
              <Field label="Check-out">
                <Input
                  type="date" required value={checkOut} min={checkIn || undefined}
                  onChange={(e) => setCheckOut(e.target.value)}
                />
              </Field>
              <Field label="Corridor" hint="Optional — narrows the search area">
                <select
                  className={selectCls} value={corridorId}
                  onChange={(e) => setCorridorId(e.target.value)}
                >
                  <option value="">Anywhere in Karachi</option>
                  {corridors.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </Field>
            </div>
          </Card>

          <Card title="Rooms">
            <div className="space-y-2">
              {rooms.map((r, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="w-16 text-sm text-ink/60">Room {i + 1}</span>
                  <select
                    className={`${selectCls} !w-40`}
                    value={r.guests}
                    onChange={(e) =>
                      setRooms((rs) =>
                        rs.map((x, j) => (j === i ? { guests: Number(e.target.value) } : x)),
                      )
                    }
                  >
                    {[1, 2, 3, 4, 5, 6].map((n) => (
                      <option key={n} value={n}>
                        {n} guest{n > 1 ? 's' : ''}
                      </option>
                    ))}
                  </select>
                  {rooms.length > 1 && (
                    <button
                      type="button"
                      aria-label={`Remove room ${i + 1}`}
                      className="text-ink/40 hover:text-ink"
                      onClick={() => setRooms((rs) => rs.filter((_, j) => j !== i))}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              {rooms.length < 9 && (
                <Button
                  type="button" variant="ghost"
                  onClick={() => setRooms((rs) => [...rs, { guests: 1 }])}
                >
                  Add room
                </Button>
              )}
            </div>
          </Card>

          <Card
            title="Deal-breakers"
            footer={
              <span className="text-xs text-ink/60">
                Hotels missing any of these are excluded from results — only verified
                amenities count.
              </span>
            }
          >
            <div className="flex flex-wrap gap-2">
              {dealbreakerOptions.map((a) => {
                const on = dealbreakers.has(a.code)
                return (
                  <button
                    key={a.code}
                    type="button"
                    aria-pressed={on}
                    className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                      on
                        ? 'bg-pine text-paper'
                        : 'border border-hairline bg-white text-ink/70 hover:bg-sage/60'
                    }`}
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
                  </button>
                )
              })}
            </div>
          </Card>

          <Card
            title="Urgency"
            footer={
              <span className="text-xs text-ink/60">
                With auto-accept on, the first hotel to accept is booked instantly —
                no second look.
              </span>
            }
          >
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-[#1D5C4D]"
                checked={autoAccept}
                onChange={(e) => setAutoAccept(e.target.checked)}
              />
              Auto-accept the first offer
            </label>
          </Card>

          <Card
            title="Travelers"
            footer={
              <span className="text-xs text-ink/60">
                Optional now — vouchers are emailed to travelers once details exist.
              </span>
            }
          >
            <div className="space-y-2">
              {travelers.map((t, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_9rem_2rem] items-center gap-2">
                  <Input
                    placeholder="Name"
                    value={t.name}
                    onChange={(e) =>
                      setTravelers((ts) =>
                        ts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                      )
                    }
                  />
                  <Input
                    type="email" placeholder="email (optional)"
                    value={t.email}
                    onChange={(e) =>
                      setTravelers((ts) =>
                        ts.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)),
                      )
                    }
                  />
                  <Input
                    placeholder="+92… (optional)"
                    value={t.phone}
                    onChange={(e) =>
                      setTravelers((ts) =>
                        ts.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)),
                      )
                    }
                  />
                  <button
                    type="button"
                    aria-label="Remove traveler"
                    className="text-ink/40 hover:text-ink"
                    onClick={() => setTravelers((ts) => ts.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </div>
              ))}
              <Button
                type="button" variant="ghost"
                onClick={() =>
                  setTravelers((ts) => [...ts, { name: '', email: '', phone: '' }])
                }
              >
                Add traveler
              </Button>
            </div>
          </Card>
        </fieldset>
      </div>
    </form>
  )
}
