import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { updateLead, ApiError, type Lead, type LeadStatus, type LeadKind } from '@/lib/api'
import { ABtn, ACard, ATextarea, Chip, Notice, PageHead, Stat } from '@/components/atlas'

/**
 * Leads — enquiries from the public site (corlington.com).
 *
 * The marketing forms write here through ef_lead; this is where they get
 * worked. A lead is a stranger's claim about themselves, so nothing here
 * provisions anything: qualifying a lead is a note and a status, and turning
 * one into a real client stays the separate, deliberate act of onboarding a
 * corporate or a vendor.
 */

const STATUSES: LeadStatus[] = ['new', 'contacted', 'qualified', 'converted', 'rejected']

const statusChip = (s: LeadStatus) =>
  s === 'converted' ? 'ok' : s === 'rejected' ? 'bad' : s === 'new' ? 'hot' : 'sage'

/** Next sensible step, so the common case is one click rather than a dropdown. */
const NEXT: Partial<Record<LeadStatus, LeadStatus>> = {
  new: 'contacted',
  contacted: 'qualified',
  qualified: 'converted',
}

function when(iso: string) {
  const d = new Date(iso)
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export function Leads() {
  const [rows, setRows] = useState<Lead[] | null>(null)
  const [kind, setKind] = useState<LeadKind | 'all'>('all')
  const [show, setShow] = useState<'open' | 'all'>('open')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openNote, setOpenNote] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')

  const load = () =>
    supabase
      .from('leads')
      .select(
        'id, kind, status, org, person, email, phone, city, volume, notes, source_page, ops_note, handled_by, handled_at, created_at',
      )
      .order('created_at', { ascending: false })
      .then(({ data, error: e }) => {
        if (e) setError(e.message)
        setRows((data ?? []) as Lead[])
      })

  useEffect(() => {
    load()
  }, [])

  const counts = useMemo(() => {
    const r = rows ?? []
    return {
      total: r.length,
      neu: r.filter((l) => l.status === 'new').length,
      corporate: r.filter((l) => l.kind === 'corporate').length,
      vendor: r.filter((l) => l.kind === 'vendor').length,
    }
  }, [rows])

  const visible = useMemo(() => {
    let r = rows ?? []
    if (kind !== 'all') r = r.filter((l) => l.kind === kind)
    if (show === 'open') r = r.filter((l) => l.status !== 'converted' && l.status !== 'rejected')
    return r
  }, [rows, kind, show])

  async function setStatus(lead: Lead, status: LeadStatus) {
    setBusy(lead.id)
    setError(null)
    try {
      await updateLead({ id: lead.id, status })
      await load()
    } catch (err: unknown) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Failed')
    } finally {
      setBusy(null)
    }
  }

  async function saveNote(lead: Lead) {
    setBusy(lead.id)
    setError(null)
    try {
      await updateLead({ id: lead.id, ops_note: noteDraft })
      setOpenNote(null)
      await load()
    } catch (err: unknown) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Failed')
    } finally {
      setBusy(null)
    }
  }

  const Filter = ({
    on,
    onClick,
    children,
  }: {
    on: boolean
    onClick: () => void
    children: React.ReactNode
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition ${
        on ? 'bg-deep text-white' : 'bg-white text-ink/60 shadow-[inset_0_0_0_1.5px_#E3E9E4] hover:text-ink'
      }`}
    >
      {children}
    </button>
  )

  return (
    <div>
      <PageHead
        eyebrow="Ops"
        title="Leads"
        sub="Enquiries from corlington.com — companies asking for an account and vendors asking to be listed. Working a lead here never provisions anything; onboarding stays a separate, deliberate step."
      />

      {error && (
        <div className="mb-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Unworked" value={counts.neu} tone={counts.neu ? 'hot' : 'ink'} hint="status new" />
        <Stat label="All leads" value={counts.total} />
        <Stat label="Companies" value={counts.corporate} />
        <Stat label="Vendors" value={counts.vendor} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Filter on={kind === 'all'} onClick={() => setKind('all')}>Both sides</Filter>
        <Filter on={kind === 'corporate'} onClick={() => setKind('corporate')}>Companies</Filter>
        <Filter on={kind === 'vendor'} onClick={() => setKind('vendor')}>Vendors</Filter>
        <span className="mx-1 h-4 w-px bg-hair" />
        <Filter on={show === 'open'} onClick={() => setShow('open')}>Open</Filter>
        <Filter on={show === 'all'} onClick={() => setShow('all')}>Including closed</Filter>
        <button
          type="button"
          onClick={load}
          className="ml-auto text-[12.5px] font-semibold text-pine hover:text-deep"
        >
          Refresh
        </button>
      </div>

      {rows === null && <p className="text-sm text-ink/50">Loading…</p>}

      {rows !== null && visible.length === 0 && (
        <ACard>
          <p className="text-sm text-ink/60">
            {counts.total === 0
              ? 'No enquiries yet. The forms on corlington.com and corlington.com/vendors.html land here the moment someone submits one.'
              : 'Nothing open in this view. Switch to “Including closed” to see worked leads.'}
          </p>
        </ACard>
      )}

      <div className="space-y-3">
        {visible.map((l) => (
          <div
            key={l.id}
            className="rounded-2xl bg-white px-5 py-4 shadow-[0_1px_3px_rgba(20,36,31,.05)]"
          >
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[15.5px] font-semibold">{l.org}</span>
                  <Chip tone={l.kind === 'vendor' ? 'sage' : 'wait'}>
                    {l.kind === 'vendor' ? 'Vendor' : 'Company'}
                  </Chip>
                  <Chip tone={statusChip(l.status)}>{l.status}</Chip>
                </div>
                <div className="mt-1 text-[13px] text-ink/60">
                  {l.person} ·{' '}
                  <a className="text-pine hover:underline" href={`mailto:${l.email}`}>
                    {l.email}
                  </a>{' '}
                  ·{' '}
                  <a className="text-pine hover:underline" href={`tel:${l.phone.replace(/\s/g, '')}`}>
                    {l.phone}
                  </a>
                </div>
                <div className="mt-0.5 text-[12.5px] text-ink/50">
                  {[l.city, l.volume].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
              <div className="text-right text-[12px] text-ink/45">
                <div className="tabular">{when(l.created_at)}</div>
                {l.source_page && <div className="tabular">{l.source_page}</div>}
              </div>
            </div>

            {l.notes && (
              <p className="mt-3 whitespace-pre-wrap rounded-xl bg-paper px-3 py-2 text-[13.5px] leading-relaxed text-ink/75">
                {l.notes}
              </p>
            )}

            {l.ops_note && (
              <p className="mt-2 whitespace-pre-wrap border-l-2 border-brass px-3 py-1 text-[13px] leading-relaxed text-ink/70">
                {l.ops_note}
              </p>
            )}

            {openNote === l.id ? (
              <div className="mt-3">
                <ATextarea
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="What happened on the call?"
                  rows={3}
                />
                <div className="mt-2 flex gap-2">
                  <ABtn onClick={() => saveNote(l)} disabled={busy === l.id}>
                    {busy === l.id ? 'Saving…' : 'Save note'}
                  </ABtn>
                  <ABtn variant="ghost" onClick={() => setOpenNote(null)}>
                    Cancel
                  </ABtn>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {NEXT[l.status] && (
                  <ABtn onClick={() => setStatus(l, NEXT[l.status]!)} disabled={busy === l.id}>
                    {busy === l.id ? 'Saving…' : `Mark ${NEXT[l.status]}`}
                  </ABtn>
                )}
                <ABtn
                  variant="ghost"
                  onClick={() => {
                    setOpenNote(l.id)
                    setNoteDraft(l.ops_note ?? '')
                  }}
                >
                  {l.ops_note ? 'Edit note' : 'Add note'}
                </ABtn>
                <select
                  value={l.status}
                  disabled={busy === l.id}
                  onChange={(e) => setStatus(l, e.target.value as LeadStatus)}
                  className="ml-auto rounded-xl border-[1.5px] border-hair bg-white px-3 py-1.5 text-[12.5px] font-semibold text-ink/70"
                  aria-label={`Status for ${l.org}`}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
