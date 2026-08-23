import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { upsertCorporate, ApiError, type CorporatePayload } from '@/lib/api'
import {
  CORP_TIERS,
  TERMS_BY_TIER,
  TERM_LABEL,
  allDone,
  corporateSteps,
  termsWithinCeiling,
  type CorporateFacts,
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
 * Corporate setup — tier + terms under the cash-flow ceiling, the official
 * address of record, countersign, and booker provisioning (the save creates
 * the sign-in accounts so the closed-access OTP works the first time).
 */

interface UserDraft {
  role: string
  name: string
  email: string
  phone: string
  linked: boolean
}

const ROLES = [
  { code: 'corp_booker', label: 'Booker' },
  { code: 'corp_approver', label: 'Approver' },
  { code: 'corp_finance', label: 'Finance' },
  { code: 'corp_admin', label: 'Admin' },
]

const fmtPkr = (n: number) => `PKR ${n.toLocaleString('en-PK')}`
const toInt = (s: string) => {
  const n = parseInt(s.replace(/[^0-9]/g, ''), 10)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

export function CorporateEditor() {
  const { id } = useParams()
  const isNew = !id || id === 'new'
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [status, setStatus] = useState('prospect')
  const [tier, setTier] = useState<'A' | 'B' | 'C'>('C')
  const [terms, setTerms] = useState('on_checkout')
  const [limit, setLimit] = useState('')
  const [securityType, setSecurityType] = useState('none')
  const [securityAmount, setSecurityAmount] = useState('')
  const [officialEmail, setOfficialEmail] = useState('')
  const [countersign, setCountersign] = useState(false)
  const [threshold, setThreshold] = useState('')
  const [approvalRequired, setApprovalRequired] = useState(false)
  const [notes, setNotes] = useState('')
  const [users, setUsers] = useState<UserDraft[]>([])
  const [agreementOnFile, setAgreementOnFile] = useState<{ signed: boolean; when: string | null } | null>(null)
  const [recordAgreement, setRecordAgreement] = useState(false)
  const [signedDigital, setSignedDigital] = useState(false)
  const [signedPhysical, setSignedPhysical] = useState(false)
  const [agreementFile, setAgreementFile] = useState<File | null>(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(isNew)

  useEffect(() => {
    if (isNew) return
    async function load() {
      const [c, u, ag] = await Promise.all([
        supabase.from('corporates').select('*').eq('id', id).single(),
        supabase.from('corporate_users').select('role, name, email, phone, auth_user_id').eq('corporate_id', id).order('name'),
        supabase.from('agreements').select('signed_digital_at, signed_physical_at').eq('party_type', 'corporate').eq('party_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ])
      if (c.error) {
        setError(c.error.message)
        return
      }
      const d = c.data
      setName(d.name)
      setStatus(d.status)
      setTier(d.tier ?? 'C')
      setTerms(d.credit_terms)
      setLimit(d.credit_limit_pkr?.toString() ?? '')
      setSecurityType(d.security_type)
      setSecurityAmount(d.security_amount_pkr?.toString() ?? '')
      setOfficialEmail(d.official_email ?? '')
      setCountersign(!!d.countersign_required)
      setThreshold(d.countersign_threshold_pkr?.toString() ?? '')
      setApprovalRequired(!!d.approval_required)
      setNotes(d.notes ?? '')
      setUsers((u.data ?? []).map((x) => ({ role: x.role, name: x.name, email: x.email, phone: x.phone ?? '', linked: !!x.auth_user_id })))
      if (ag.data) {
        const when = ag.data.signed_digital_at ?? ag.data.signed_physical_at
        setAgreementOnFile({ signed: !!when, when })
      }
      setLoaded(true)
    }
    load()
  }, [id, isNew])

  const facts: CorporateFacts = useMemo(
    () => ({
      tier,
      credit_terms: terms,
      credit_set: toInt(limit) > 0,
      has_official_email: !!officialEmail.trim(),
      users_total: users.filter((u) => u.email.trim()).length,
      users_linked: users.filter((u) => u.email.trim() && u.linked).length,
      agreement_signed: !!agreementOnFile?.signed || (recordAgreement && (signedDigital || signedPhysical)),
    }),
    [tier, terms, limit, officialEmail, users, agreementOnFile, recordAgreement, signedDigital, signedPhysical],
  )
  const steps = corporateSteps(facts)
  const ready = allDone(steps)
  const ceilingOk = termsWithinCeiling(tier, terms)
  const pendingAccounts = users.filter((u) => u.email.trim() && !u.linked).length

  const setUser = (i: number, patch: Partial<UserDraft>) => setUsers((us) => us.map((u, j) => (j === i ? { ...u, ...patch } : u)))

  async function save() {
    setBusy(true)
    setError(null)
    setSaved(null)
    try {
      if (!name.trim()) throw new Error('Give the corporate a name.')
      if (!ceilingOk) throw new Error(`Terms ${terms} exceed the tier ${tier} ceiling — the cash-flow rule.`)
      for (const u of users) {
        if (u.email.trim() && !u.name.trim()) throw new Error(`Booker ${u.email} needs a name.`)
      }
      let docUrl: string | null = null
      if (recordAgreement && agreementFile) {
        const path = `corporate/${crypto.randomUUID()}/${agreementFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
        const { error: upErr } = await supabase.storage.from('agreements').upload(path, agreementFile)
        if (upErr) throw new Error(`Agreement upload failed: ${upErr.message}`)
        docUrl = path
      }
      const payload: CorporatePayload = {
        corporate: {
          ...(isNew ? {} : { id }),
          name: name.trim(),
          status,
          tier,
          credit_terms: terms,
          credit_limit_pkr: toInt(limit),
          security_type: securityType,
          security_amount_pkr: securityType === 'none' ? 0 : toInt(securityAmount),
          official_email: officialEmail.trim() || null,
          countersign_required: countersign,
          countersign_threshold_pkr: countersign && threshold ? toInt(threshold) : null,
          approval_required: approvalRequired,
          notes: notes.trim() || null,
        },
        users: users
          .filter((u) => u.email.trim())
          .map((u) => ({ role: u.role, name: u.name.trim(), email: u.email.trim(), phone: u.phone.trim() || undefined })),
        ...(recordAgreement
          ? {
              agreement: {
                tier,
                doc_url: docUrl,
                signed_digital_at: signedDigital ? new Date().toISOString() : null,
                signed_physical_at: signedPhysical ? new Date().toISOString() : null,
              },
            }
          : {}),
      }
      const res = await upsertCorporate(payload)
      setUsers(res.users.map((x) => ({ role: x.role, name: x.name, email: x.email, phone: x.phone ?? '', linked: !!x.auth_user_id })))
      setSaved(
        res.provisioned.length
          ? `Saved. Sign-in accounts created for ${res.provisioned.join(', ')} — they get a code the first time they sign in.`
          : 'Saved.',
      )
      if (recordAgreement) {
        setAgreementOnFile({ signed: signedDigital || signedPhysical, when: new Date().toISOString() })
        setRecordAgreement(false)
      }
      if (isNew) navigate(`/ops/corporates/${res.corporate.id}`, { replace: true })
    } catch (err: unknown) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  if (!loaded && !error) return <p className="text-sm text-ink/50">Loading…</p>

  return (
    <div>
      <PageHead
        eyebrow={isNew ? 'New corporate' : 'Corporate setup'}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {name || 'Untitled corporate'}
            <Chip tone={statusTone(status)}>{status}</Chip>
          </span>
        }
        sub="Closed access: only people provisioned here can sign in."
        actions={<Link to="/ops/corporates" className="text-[13px] font-semibold text-ink/55">← Corporates</Link>}
      />

      <div className="grid items-start gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <ACard title="Identity">
            <div className="grid gap-3 md:grid-cols-3">
              <AField label="Company name" className="md:col-span-2"><AInput value={name} onChange={(e) => setName(e.target.value)} /></AField>
              <AField label="Official email — address of record" className="md:col-span-3" hint="Countersign emails and invoices go here. Never a booker's login.">
                <AInput type="email" value={officialEmail} onChange={(e) => setOfficialEmail(e.target.value)} placeholder="finance@company.com.pk" />
              </AField>
            </div>
          </ACard>

          <ACard title="Tier & credit" sub="The cash-flow rule: A ≤ d20 · B ≤ d15 · C ≤ d7 — always below the 30-day hotel settlement. New corporates start at C.">
            <div className="mb-3 flex flex-wrap gap-2">
              {CORP_TIERS.map((t) => (
                <ChipToggle key={t} on={tier === t} onClick={() => setTier(t)}>Tier {t}</ChipToggle>
              ))}
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <AField label="Credit terms — from checkout">
                <ASelect value={terms} onChange={(e) => setTerms(e.target.value)}>
                  {(ceilingOk ? TERMS_BY_TIER[tier] : [...TERMS_BY_TIER[tier], terms]).map((t) => (
                    <option key={t} value={t}>{TERM_LABEL[t] ?? t}</option>
                  ))}
                </ASelect>
              </AField>
              <AField label="Credit limit (PKR)"><AInput inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="1,500,000" className="tabular" /></AField>
              <AField label="Security">
                <ASelect value={securityType} onChange={(e) => setSecurityType(e.target.value)}>
                  <option value="none">None</option>
                  <option value="deposit">Standing deposit</option>
                  <option value="bank_guarantee">Bank guarantee</option>
                </ASelect>
              </AField>
              {securityType !== 'none' && (
                <AField label="Security amount (PKR)"><AInput inputMode="numeric" value={securityAmount} onChange={(e) => setSecurityAmount(e.target.value)} className="tabular" /></AField>
              )}
            </div>
            {!ceilingOk && (
              <div className="mt-3">
                <Notice tone="error">{TERM_LABEL[terms] ?? terms} exceeds the tier {tier} ceiling. Pick {TERMS_BY_TIER[tier].map((t) => t.replace('_', ' ')).join(' / ')} — or raise the tier.</Notice>
              </div>
            )}
            <div className="mt-4 space-y-2">
              <Toggle on={countersign} onChange={setCountersign} label="Booking countersign required" hint="Every booking waits for a click + name + designation from the official address — a leaked login alone can't commit spend." />
              {countersign && (
                <AField label="Only above this amount (PKR) — leave blank for every booking" className="pl-1">
                  <AInput inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="150,000" className="tabular max-w-xs" />
                </AField>
              )}
              <Toggle on={approvalRequired} onChange={setApprovalRequired} label="Internal approver must clear bookings" hint="The corporate's own approver role signs off inside the portal before a request goes out." />
            </div>
          </ACard>

          <ACard title="Agreement" sub="Preferred-channel commitment in exchange for negotiated rates and credit.">
            <p className="mb-3 text-[13.5px]">
              {agreementOnFile?.signed
                ? <span className="text-deep">Signed · {new Date(agreementOnFile.when!).toLocaleDateString('en-GB')}</span>
                : agreementOnFile
                  ? <span className="text-brass">Recorded, not yet signed</span>
                  : <span className="text-ink/50">Nothing recorded yet</span>}
            </p>
            <Toggle on={recordAgreement} onChange={setRecordAgreement} label="Record a signed agreement now" />
            {recordAgreement && (
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <label className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" checked={signedDigital} onChange={(e) => setSignedDigital(e.target.checked)} /> Signed digitally</label>
                <label className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" checked={signedPhysical} onChange={(e) => setSignedPhysical(e.target.checked)} /> Signed on paper</label>
                <input type="file" accept=".pdf,image/*" onChange={(e) => setAgreementFile(e.target.files?.[0] ?? null)} className="text-[13px]" />
              </div>
            )}
          </ACard>

          <ACard
            title="Bookers — provisioned accounts"
            sub="Saving creates the sign-in account for anyone without one. No email goes out now; they get a code when they first sign in."
            right={<ABtn variant="ghost" className="py-1.5" onClick={() => setUsers((us) => [...us, { role: 'corp_booker', name: '', email: '', phone: '', linked: false }])}>+ Add person</ABtn>}
          >
            {users.length === 0 && <p className="text-sm text-ink/50">Nobody can sign in yet.</p>}
            <div className="space-y-2">
              {users.map((u, i) => (
                <div key={i} className="grid items-end gap-2 rounded-2xl border-[1.5px] border-hairline p-3 md:grid-cols-[1fr_1.3fr_1fr_0.9fr_auto]">
                  <AField label="Name"><AInput value={u.name} onChange={(e) => setUser(i, { name: e.target.value })} /></AField>
                  <AField label="Work email"><AInput type="email" value={u.email} onChange={(e) => setUser(i, { email: e.target.value })} disabled={u.linked} /></AField>
                  <AField label="Phone"><AInput value={u.phone} onChange={(e) => setUser(i, { phone: e.target.value })} /></AField>
                  <AField label="Role">
                    <ASelect value={u.role} onChange={(e) => setUser(i, { role: e.target.value })}>
                      {ROLES.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                    </ASelect>
                  </AField>
                  <div className="pb-2.5">
                    {u.linked ? <Chip tone="ok">can sign in</Chip> : <Chip tone="hot">account on save</Chip>}
                  </div>
                </div>
              ))}
            </div>
          </ACard>

          <ACard title="Internal notes (ops only)">
            <ATextarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </ACard>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-[72px]">
          <ACard>
            <AField label="Status">
              <ASelect value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="prospect">Prospect</option>
                <option value="onboarding">Onboarding</option>
                <option value="live">Live</option>
                <option value="suspended">Suspended</option>
              </ASelect>
            </AField>
            <div className="mt-4"><Plan steps={steps} /></div>
            {ready && status !== 'live' && <div className="mt-3"><Notice tone="ok">Setup complete — set status to Live and save.</Notice></div>}
            {pendingAccounts > 0 && <div className="mt-3"><Notice>{pendingAccounts} sign-in account{pendingAccounts > 1 ? 's' : ''} will be created on save.</Notice></div>}
            <div className="mt-4 space-y-2">
              {error && <Notice tone="error">{error}</Notice>}
              {saved && <Notice tone="ok">{saved}</Notice>}
              <ABtn className="w-full" onClick={save} disabled={busy || !ceilingOk}>{busy ? 'Saving…' : isNew ? 'Create corporate' : 'Save changes'}</ABtn>
              <p className="text-center text-[11.5px] text-ink/50">
                {toInt(limit) > 0 ? `${fmtPkr(toInt(limit))} on tier ${tier} · ${terms.replace('_', ' ')}` : 'Audit-logged under your name.'}
              </p>
            </div>
          </ACard>
        </aside>
      </div>
    </div>
  )
}
