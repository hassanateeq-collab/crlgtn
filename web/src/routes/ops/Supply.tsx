import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import {
  SHOT_LIST,
  allDone,
  nextStep,
  vendorSteps,
  type VendorProgressRow,
} from '@/lib/onboarding'
import { ABtn, Chip, ChipToggle, PageHead, Progress, Stat, statusTone } from '@/components/atlas'
import { CorporateCards } from './Corporates'

/**
 * Supply & clients setup — every hotel, operator and apartment host with its
 * photos, property facts and onboarding progress; corporates beneath. The
 * numbers come from the vendor_onboarding / corporate_onboarding views
 * (migration 019), so this page and the editor never disagree.
 */

const TYPE_LABEL: Record<string, string> = {
  hotel: 'Hotel',
  rent_a_car: 'Rent-a-car',
  property: 'Apartments',
  tour: 'Tours',
  restaurant: 'Restaurant',
}

export function Supply() {
  const [rows, setRows] = useState<VendorProgressRow[]>([])
  const [corridors, setCorridors] = useState<Record<string, string>>({})
  const [covers, setCovers] = useState<Record<string, string>>({})
  const [type, setType] = useState<'all' | 'hotel' | 'rent_a_car' | 'property'>('all')
  const [status, setStatus] = useState<'all' | 'live' | 'onboarding' | 'prospect'>('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const [v, c] = await Promise.all([
        supabase.from('vendor_onboarding').select('*').order('name'),
        supabase.from('corridors').select('id, name'),
      ])
      const list = (v.data ?? []) as VendorProgressRow[]
      setRows(list)
      setCorridors(Object.fromEntries((c.data ?? []).map((x) => [x.id, x.name])))
      const paths = list.map((r) => r.cover_path).filter((p): p is string => !!p)
      if (paths.length) {
        const { data: signed } = await supabase.storage.from('media').createSignedUrls(paths, 3600)
        const map: Record<string, string> = {}
        signed?.forEach((s, i) => {
          if (s.signedUrl) map[paths[i]] = s.signedUrl
        })
        setCovers(map)
      }
      setLoading(false)
    }
    load()
  }, [])

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) => (type === 'all' || r.vendor_type === type) && (status === 'all' || r.status === status),
      ),
    [rows, type, status],
  )

  const stats = useMemo(() => {
    const live = rows.filter((r) => r.status === 'live').length
    const onboarding = rows.filter((r) => r.status === 'onboarding').length
    const prospects = rows.filter((r) => r.status === 'prospect').length
    const ready = rows.filter((r) => r.status !== 'live' && allDone(vendorSteps(r))).length
    const photosShort = rows.filter(
      (r) => r.vendor_type !== 'rent_a_car' && r.shots_done < SHOT_LIST.length,
    ).length
    return { live, onboarding, prospects, ready, photosShort }
  }, [rows])

  return (
    <div>
      <PageHead
        eyebrow="Supply & clients"
        title="Setup & onboarding"
        sub="Every property with its pictures, facts and what's left before it can take bookings. Corporates below."
        actions={
          <Link to="/ops/vendors/new">
            <ABtn>+ New hotel / operator</ABtn>
          </Link>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Live" value={stats.live} hint="taking requests" />
        <Stat label="Onboarding" value={stats.onboarding} hint="in setup" tone="hot" />
        <Stat label="Prospects" value={stats.prospects} hint="not started" />
        <Stat label="Ready for go-live" value={stats.ready} hint="all steps done, not yet live" tone={stats.ready ? 'hot' : 'ink'} />
        <Stat label="Shot list short" value={stats.photosShort} hint="hotels under 8 required photos" tone={stats.photosShort ? 'bad' : 'ink'} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(['all', 'hotel', 'property', 'rent_a_car'] as const).map((t) => (
          <ChipToggle key={t} on={type === t} onClick={() => setType(t)}>
            {t === 'all' ? 'All' : TYPE_LABEL[t]}
          </ChipToggle>
        ))}
        <span className="mx-1 h-5 w-px bg-hairline" />
        {(['all', 'live', 'onboarding', 'prospect'] as const).map((s) => (
          <ChipToggle key={s} on={status === s} onClick={() => setStatus(s)}>
            {s === 'all' ? 'Any status' : s[0].toUpperCase() + s.slice(1)}
          </ChipToggle>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-ink/50">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="rounded-2xl bg-white p-6 text-sm text-ink/60">Nothing matches. Add a vendor to start onboarding.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((r) => (
            <VendorCard key={r.vendor_id} row={r} corridor={corridors[r.corridor_id ?? ''] ?? null} cover={r.cover_path ? covers[r.cover_path] : undefined} />
          ))}
        </div>
      )}

      <div className="mt-10">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="text-[20px]">Corporates</h2>
            <p className="text-sm text-ink/60">Tier, terms, official email and who can sign in.</p>
          </div>
          <div className="flex gap-2">
            <Link to="/ops/corporates" className="text-[13px] font-semibold text-pine">All corporates →</Link>
            <Link to="/ops/corporates/new"><ABtn variant="ghost" className="py-1.5">+ New corporate</ABtn></Link>
          </div>
        </div>
        <CorporateCards />
      </div>
    </div>
  )
}

function VendorCard({ row, corridor, cover }: { row: VendorProgressRow; corridor: string | null; cover?: string }) {
  const steps = vendorSteps(row)
  const next = nextStep(steps)
  const done = steps.filter((s) => s.done).length
  const isCar = row.vendor_type === 'rent_a_car'
  const shots = new Set(row.shot_types ?? [])

  return (
    <article className="flex flex-col overflow-hidden rounded-[20px] bg-white shadow-[0_1px_3px_rgba(20,36,31,.05),0_14px_36px_-22px_rgba(20,36,31,.16)]">
      <div className="relative h-40 bg-gradient-to-br from-[#D9E4DD] to-[#B9CDC3]">
        {cover ? (
          <img src={cover} alt="" className="absolute inset-0 size-full object-cover" />
        ) : (
          <div className="absolute inset-0 grid place-items-center px-6 text-center text-xs text-deep/70">
            {isCar ? 'No fleet photo yet' : 'No cover yet — the front-door shot becomes the cover'}
          </div>
        )}
        <span className="absolute left-3 top-3 rounded-full bg-white px-2.5 py-0.5 text-[11px] font-semibold text-deep">
          {TYPE_LABEL[row.vendor_type] ?? row.vendor_type}
        </span>
        <span className="absolute bottom-3 left-3">
          <Chip tone={statusTone(row.status)}>{row.status}</Chip>
        </span>
        <span className="absolute bottom-3 right-3">
          <Chip tone="ink">{row.credit_tier}</Chip>
        </span>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <h3 className="text-[17px]">{row.name}</h3>
        <p className="text-[12.5px] text-ink/55">
          {[corridor, row.stars_assigned ? `${row.stars_assigned}★` : null, row.price_bracket?.toUpperCase(), row.total_rooms ? `${row.total_rooms} rooms` : null]
            .filter(Boolean)
            .join(' · ') || 'Area not set'}
        </p>

        <div className="mt-3 flex items-center gap-3">
          <Progress value={done} max={steps.length} />
          <span className="tabular text-xs text-ink/55">
            {done}/{steps.length}
          </span>
        </div>

        {!isCar && (
          <div className="mt-3 flex flex-wrap gap-1.5" title="Shot list">
            {SHOT_LIST.map((s) => (
              <span
                key={s.key}
                title={s.label}
                className={`rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold ${
                  shots.has(s.key) ? 'bg-sage text-deep' : 'bg-paper text-ink/35 line-through decoration-ink/20'
                }`}
              >
                {s.label}
              </span>
            ))}
          </div>
        )}

        <p className="mt-3 text-[13px]">
          {row.status === 'live' ? (
            <span className="text-deep">Live · {row.listings_active} {isCar ? 'vehicle classes' : 'categories'} · {row.photos_total} photos</span>
          ) : next ? (
            <span>
              <span className="font-semibold text-brass">Next:</span> {next.label} — <span className="text-ink/60">{next.detail}</span>
            </span>
          ) : (
            <span className="font-semibold text-deep">Ready for go-live</span>
          )}
        </p>

        <div className="mt-auto flex items-center gap-3 pt-4">
          <Link to={`/ops/vendors/${row.vendor_id}`} className="text-[13px] font-semibold text-pine">
            Open setup →
          </Link>
          <Link to={`/ops/vendors/${row.vendor_id}/page`} className="text-[13px] font-semibold text-ink/50">
            Preview page
          </Link>
        </div>
      </div>
    </article>
  )
}
