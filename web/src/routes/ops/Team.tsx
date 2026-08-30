import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useIdentity } from '@/lib/identity'
import { setOpsActive, setUserPassword, upsertOpsUser, ApiError, type OpsUser } from '@/lib/api'
import { generatePassword } from '@/lib/passwords'
import { ABtn, ACard, AField, AInput, ASelect, Chip, Notice, PageHead } from '@/components/atlas'

/**
 * The ops team — who runs Corlington. Admins add members and issue passwords;
 * a password is generated here, set server-side, shown ONCE, stored nowhere.
 * The email-code sign-in works alongside once mail secrets are configured.
 */

export function Team() {
  const { identity } = useIdentity()
  const isAdmin = identity?.opsRole === 'ops_admin'
  const [rows, setRows] = useState<OpsUser[] | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('ops_agent')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [issued, setIssued] = useState<{ email: string; password: string } | null>(null)

  const load = () =>
    supabase.from('ops_users').select('id, name, email, role, active, auth_user_id').order('name')
      .then(({ data }) => setRows((data ?? []) as OpsUser[]))
  useEffect(() => {
    load()
  }, [])

  async function add() {
    setBusy('add')
    setError(null)
    try {
      if (!name.trim() || !email.trim()) throw new Error('Name and work email are required.')
      await upsertOpsUser({ name: name.trim(), email: email.trim(), role })
      setName('')
      setEmail('')
      await load()
    } catch (err: unknown) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Failed')
    } finally {
      setBusy(null)
    }
  }

  async function issuePassword(u: OpsUser) {
    setBusy(u.id)
    setError(null)
    setIssued(null)
    try {
      const password = generatePassword()
      await setUserPassword(u.email, password)
      setIssued({ email: u.email, password })
    } catch (err: unknown) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Failed')
    } finally {
      setBusy(null)
    }
  }

  async function toggleActive(u: OpsUser) {
    setBusy(u.id)
    setError(null)
    try {
      await setOpsActive(u.id, !u.active)
      await load()
    } catch (err: unknown) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <PageHead
        eyebrow="Ops"
        title="Team"
        sub="Who runs Corlington. Admins add members and issue passwords — each password is shown once, then exists only with its owner."
      />
      {error && <div className="mb-4"><Notice tone="error">{error}</Notice></div>}
      {issued && (
        <div className="mb-4">
          <Notice tone="ok">
            Password for <b className="tabular">{issued.email}</b>:&nbsp;
            <b className="tabular select-all text-[15px]">{issued.password}</b>
            <button
              type="button"
              className="ml-3 font-semibold text-pine"
              onClick={() => navigator.clipboard?.writeText(issued.password)}
            >
              copy
            </button>
            <span className="mt-1 block text-[12px]">
              Shown once — share it over a safe channel and close this. They can sign in immediately.
            </span>
          </Notice>
        </div>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[1fr_320px]">
        <ACard title="Members">
          <div className="space-y-2">
            {rows?.map((u) => (
              <div key={u.id} className={`flex flex-wrap items-center gap-3 rounded-2xl border-[1.5px] border-hairline px-4 py-3 ${u.active ? '' : 'opacity-60'}`}>
                <span className="min-w-0">
                  <span className="block text-[14.5px] font-semibold">{u.name}</span>
                  <span className="block text-[12.5px] text-ink/55">{u.email}</span>
                </span>
                <span className="ml-auto flex flex-wrap items-center gap-2">
                  <Chip tone={u.role === 'ops_admin' ? 'ink' : 'sage'}>{u.role === 'ops_admin' ? 'admin' : 'agent'}</Chip>
                  <Chip tone={u.auth_user_id ? 'ok' : 'hot'}>{u.auth_user_id ? 'can sign in' : 'no account yet'}</Chip>
                  {!u.active && <Chip tone="bad">deactivated</Chip>}
                  {isAdmin && (
                    <>
                      <ABtn variant="ghost" className="py-1.5" disabled={busy !== null} onClick={() => issuePassword(u)}>
                        {busy === u.id ? '…' : 'Issue password'}
                      </ABtn>
                      {u.id !== identity?.authUserId && u.email !== identity?.email && (
                        <button
                          type="button"
                          className="text-[12.5px] font-semibold text-ink/45 hover:text-ink"
                          disabled={busy !== null}
                          onClick={() => toggleActive(u)}
                        >
                          {u.active ? 'deactivate' : 'reactivate'}
                        </button>
                      )}
                    </>
                  )}
                </span>
              </div>
            ))}
            {rows && rows.length === 0 && <p className="text-sm text-ink/50">No team members yet.</p>}
            {!rows && <p className="text-sm text-ink/50">Loading…</p>}
          </div>
        </ACard>

        {isAdmin ? (
          <ACard title="Add a member" sub="Creates their sign-in account immediately; issue a password after, or let them use email codes once mail is configured.">
            <div className="space-y-3">
              <AField label="Name"><AInput value={name} onChange={(e) => setName(e.target.value)} /></AField>
              <AField label="Work email"><AInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></AField>
              <AField label="Role" hint="Admins can manage accounts and money; agents run the board.">
                <ASelect value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="ops_agent">Ops agent</option>
                  <option value="ops_admin">Ops admin</option>
                </ASelect>
              </AField>
              <ABtn className="w-full" disabled={busy !== null} onClick={add}>
                {busy === 'add' ? 'Adding…' : 'Add member'}
              </ABtn>
            </div>
          </ACard>
        ) : (
          <Notice>Only ops admins can add members or issue passwords.</Notice>
        )}
      </div>
    </div>
  )
}
