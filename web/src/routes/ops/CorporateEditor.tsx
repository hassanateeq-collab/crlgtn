import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { upsertCorporate, ApiError } from '@/lib/api'
import { Button, Card, Field, Input, Notice } from '@/components/ui'

/**
 * Corporate + credit profile + users (M1). One save calls ef_upsert_corporate.
 * Users are upserted by email, never deleted from this form.
 */

interface UserDraft {
  role: string
  name: string
  email: string
  phone: string
  linked: boolean
}

export function CorporateEditor() {
  const { id } = useParams()
  const isNew = !id || id === 'new'
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [status, setStatus] = useState('prospect')
  const [creditLimit, setCreditLimit] = useState('0')
  const [terms, setTerms] = useState('on_checkout')
  const [securityType, setSecurityType] = useState('none')
  const [securityAmount, setSecurityAmount] = useState('0')
  const [feeWaivedUntil, setFeeWaivedUntil] = useState('')
  const [approvalRequired, setApprovalRequired] = useState(false)
  const [notes, setNotes] = useState('')
  const [users, setUsers] = useState<UserDraft[]>([])

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(isNew)

  useEffect(() => {
    if (isNew) return
    async function load() {
      const [c, u] = await Promise.all([
        supabase.from('corporates').select('*').eq('id', id).single(),
        supabase
          .from('corporate_users')
          .select('role, name, email, phone, auth_user_id')
          .eq('corporate_id', id)
          .order('name'),
      ])
      if (c.error) { setError(c.error.message); return }
      setName(c.data.name)
      setStatus(c.data.status)
      setCreditLimit(c.data.credit_limit_pkr.toString())
      setTerms(c.data.credit_terms)
      setSecurityType(c.data.security_type)
      setSecurityAmount(c.data.security_amount_pkr.toString())
      setFeeWaivedUntil(c.data.fee_waived_until ?? '')
      setApprovalRequired(c.data.approval_required)
      setNotes(c.data.notes ?? '')
      setUsers(
        (u.data ?? []).map((x) => ({
          role: x.role,
          name: x.name,
          email: x.email,
          phone: x.phone ?? '',
          linked: x.auth_user_id !== null,
        })),
      )
      setLoaded(true)
    }
    load()
  }, [id, isNew])

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await upsertCorporate({
        corporate: {
          ...(isNew ? {} : { id }),
          name: name.trim(),
          status,
          credit_limit_pkr: parseInt(creditLimit || '0', 10),
          credit_terms: terms,
          security_type: securityType,
          security_amount_pkr: securityType === 'none' ? 0 : parseInt(securityAmount || '0', 10),
          fee_waived_until: feeWaivedUntil || null,
          approval_required: approvalRequired,
          notes: notes.trim() || null,
        },
        users: users
          .filter((u) => u.name.trim() && u.email.trim())
          .map((u) => ({
            role: u.role,
            name: u.name.trim(),
            email: u.email.trim(),
            phone: u.phone.trim() || undefined,
          })),
      })
      navigate('/ops/corporates')
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
    <form onSubmit={save} className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl">{isNew ? 'Add corporate' : `Edit · ${name}`}</h1>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={() => navigate('/ops/corporates')}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save corporate'}
          </Button>
        </div>
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      <Card title="Company & credit profile" footer={
        <span className="text-xs text-ink/60">
          Limit, terms and security are set by judgment on financials, references and
          track record — there is no formula.
        </span>
      }>
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
          <Field label="Credit limit (PKR)">
            <Input
              inputMode="numeric" className="tabular"
              value={creditLimit}
              onChange={(e) => setCreditLimit(e.target.value.replace(/\D/g, ''))}
            />
          </Field>
          <Field label="Payment terms">
            <select className={selectCls} value={terms} onChange={(e) => setTerms(e.target.value)}>
              <option value="on_checkout">upon checkout</option>
              <option value="d7">7 days</option>
              <option value="d15">15 days</option>
              <option value="d30">30 days</option>
            </select>
          </Field>
          <Field label="Security">
            <select
              className={selectCls}
              value={securityType}
              onChange={(e) => setSecurityType(e.target.value)}
            >
              <option value="none">none</option>
              <option value="deposit">deposit</option>
              <option value="bank_guarantee">bank guarantee</option>
            </select>
          </Field>
          {securityType !== 'none' && (
            <Field label="Security amount (PKR)">
              <Input
                inputMode="numeric" className="tabular"
                value={securityAmount}
                onChange={(e) => setSecurityAmount(e.target.value.replace(/\D/g, ''))}
              />
            </Field>
          )}
          <Field label="Fee waived until" hint="Corporate fee published day one; waived 6–12 months">
            <Input
              type="date"
              value={feeWaivedUntil}
              onChange={(e) => setFeeWaivedUntil(e.target.value)}
            />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input
              type="checkbox" className="size-4 accent-[#1D5C4D]"
              checked={approvalRequired}
              onChange={(e) => setApprovalRequired(e.target.checked)}
            />
            Bookings require approver sign-off
          </label>
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

      <Card title="Users" footer={
        <span className="text-xs text-ink/60">
          Accounts are provisioned here and linked when the person first signs in with
          their email code. Removing a row does not delete the user.
        </span>
      }>
        <div className="space-y-2">
          {users.map((u, i) => (
            <div key={i} className="grid grid-cols-[8rem_1fr_1fr_9rem_2rem] items-center gap-2">
              <select
                className={selectCls}
                value={u.role}
                onChange={(e) =>
                  setUsers((us) => us.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))
                }
              >
                <option value="corp_admin">admin</option>
                <option value="corp_booker">booker</option>
                <option value="corp_approver">approver</option>
                <option value="corp_finance">finance</option>
              </select>
              <Input
                placeholder="Name"
                value={u.name}
                onChange={(e) =>
                  setUsers((us) => us.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                }
              />
              <Input
                type="email" placeholder="email@company.com"
                value={u.email}
                disabled={u.linked}
                onChange={(e) =>
                  setUsers((us) => us.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))
                }
              />
              <Input
                placeholder="+92…"
                value={u.phone}
                onChange={(e) =>
                  setUsers((us) => us.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)))
                }
              />
              {!u.linked ? (
                <button
                  type="button"
                  aria-label="Remove user row"
                  className="text-ink/40 hover:text-ink"
                  onClick={() => setUsers((us) => us.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              ) : (
                <span className="text-xs text-ink/40" title="Has signed in">✓</span>
              )}
            </div>
          ))}
          <Button
            type="button" variant="ghost"
            onClick={() =>
              setUsers((us) => [
                ...us,
                { role: 'corp_booker', name: '', email: '', phone: '', linked: false },
              ])
            }
          >
            Add user
          </Button>
        </div>
      </Card>
    </form>
  )
}
