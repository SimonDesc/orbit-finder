import {
  CloudOff,
  FileJson,
  LoaderCircle,
  Lock,
  Moon,
  Send,
  ShieldCheck,
  Sun,
  Timer,
  Webhook,
} from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  nextTier,
  type Pass,
  type PricingTerms,
  type Priority,
  quote,
  type SatApp,
} from '@/lib/api'
import { fmtDay, fmtRelative, fmtTime } from '@/lib/format'
import { cn } from '@/lib/utils'

import { Hint } from './Hint'
import { Empty } from './SceneList'

interface Props {
  app: SatApp | null
  passes: Pass[]
  usable: boolean[]
  loading: boolean
  error: string | null
  selected: Set<string>
  onSelect: (times: Set<string>) => void
  activeIndex: number | null
  onHover: (i: number | null) => void
  priority: Priority
  onPriority: (p: Priority) => void
  terms: PricingTerms | null
  licensed: boolean
  ordering: boolean
  onBook: () => void
  fleetSize: number | null
  reachKm: number | null
}

const eur = (v: number) => `€${v.toLocaleString('en')}`

/** Pick the passes to buy, see the price move, book. */
export function BookingRail({
  app,
  passes,
  usable,
  loading,
  error,
  selected,
  onSelect,
  activeIndex,
  onHover,
  priority,
  onPriority,
  terms,
  licensed,
  ordering,
  onBook,
  fleetSize,
  reachKm,
}: Props) {
  if (loading) {
    return (
      <div className="space-y-2 p-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    )
  }
  if (error) return <div className="p-3"><Empty tone="error">Couldn't predict passes: {error}</Empty></div>
  if (!app) return <div className="p-3"><Empty>Pick an app first.</Empty></div>

  const usableTimes = passes.filter((_, i) => usable[i]).map((p) => p.time)
  const hidden = passes.length - usableTimes.length
  const n = usableTimes.filter((t) => selected.has(t)).length
  const q = terms ? quote(app, n, priority, terms) : null
  const tier = terms ? nextTier(n, terms) : null
  const toggle = (t: string) => {
    const s = new Set(selected)
    if (s.has(t)) s.delete(t)
    else s.add(t)
    onSelect(s)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <section className="space-y-2">
          <div className="flex items-center gap-1.5">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Passes
            </h3>
            <Hint label="How passes are computed">
              <p>
                Passes of Loft Orbital’s {fleetSize ?? ''} YAM satellites, which host the apps,
                from their public orbits (CelesTrak TLE + SGP4), over the next 48 h.
              </p>
              <p className="text-muted-foreground">
                Payloads are assumed to point up to ~{reachKm ?? 250} km either side of the
                ground track.
              </p>
            </Hint>
            <span className="ml-auto flex gap-0.5">
              {(
                [
                  ['Next 3', usableTimes.slice(0, 3)],
                  ['All', usableTimes],
                  ['None', []],
                ] as const
              ).map(([label, times]) => (
                <Button
                  key={label}
                  size="xs"
                  variant="ghost"
                  onClick={() => onSelect(new Set(times))}
                >
                  {label}
                </Button>
              ))}
            </span>
          </div>
          {!usableTimes.length ? (
            <Empty>No pass can run {app.name} in the next 48 h.</Empty>
          ) : (
            <ol className="space-y-0.5">
              {passes.map((p, i) => {
                if (!usable[i]) return null
                const on = selected.has(p.time)
                return (
                  <li key={`${p.norad_id}-${p.time}`}>
                    <label
                      onMouseEnter={() => onHover(i)}
                      onMouseLeave={() => onHover(null)}
                      className={cn(
                        'flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
                        on ? 'bg-amber-300/10' : 'hover:bg-muted/50',
                        activeIndex === i && 'ring-1 ring-amber-300/50',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(p.time)}
                        className="size-3.5 accent-amber-300"
                      />
                      {p.daylight ? (
                        <Sun className="size-3.5 shrink-0 text-amber-300" />
                      ) : (
                        <Moon className="size-3.5 shrink-0 text-slate-400" />
                      )}
                      <span className="w-24 shrink-0 tabular-nums">
                        {fmtDay(p.time).split(' ')[0]} {fmtTime(p.time)}
                      </span>
                      <span className="flex-1 truncate text-xs text-muted-foreground">
                        {p.satellite}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {fmtRelative(p.time)}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ol>
          )}
          {hidden > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {hidden} night pass{hidden > 1 ? 'es' : ''} hidden: {app.name} needs daylight.
            </p>
          )}
        </section>

        <section className="space-y-1.5">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Options
          </h3>
          <Row icon={<Timer />} label="Tasking">
            <div className="flex rounded-md bg-muted p-0.5 text-xs">
              {(['standard', 'priority'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={priority === p}
                  onClick={() => onPriority(p)}
                  className={cn(
                    'rounded px-2 py-0.5 capitalize transition-colors',
                    priority === p ? 'bg-background shadow' : 'text-muted-foreground',
                  )}
                >
                  {p}
                  {p === 'priority' && terms && ` +${Math.round(terms.priority.priority * 100)}%`}
                </button>
              ))}
            </div>
          </Row>
          <Row icon={<FileJson />} label="Delivery" locked>
            GeoJSON
          </Row>
          <Row icon={<Webhook />} label="Push to" locked>
            Webhook + email
          </Row>
          <Row icon={<CloudOff />} label="Cloudy pass" locked>
            Credited if &gt; 60%
          </Row>
          <Row icon={<ShieldCheck />} label="Data retention" locked>
            90 days
          </Row>
        </section>
      </div>

      <footer className="space-y-2 border-t border-border p-3">
        {q && (
          <dl className="space-y-0.5 text-xs">
            <Line label={`${n} × ${eur(q.list_price_eur)}`} value={eur(n * q.list_price_eur)} />
            {q.discount > 0 && (
              <Line
                label={`Volume −${Math.round(q.discount * 100)}%`}
                value={`−${eur(Math.round(n * q.list_price_eur * q.discount))}`}
                tone="text-emerald-300"
              />
            )}
            {q.surcharge > 0 && (
              <Line
                label={`Priority +${Math.round(q.surcharge * 100)}%`}
                value={`+${eur(q.total_eur - Math.round(n * q.list_price_eur * (1 - q.discount)))}`}
              />
            )}
            <div className="flex items-baseline justify-between pt-1">
              <dt className="text-sm font-medium">Total</dt>
              <dd className="text-xl font-semibold tabular-nums">{eur(q.total_eur)}</dd>
            </div>
            {tier && n > 0 && (
              <p className="text-[11px] text-emerald-300/90">
                +{tier.min_passes - n} pass{tier.min_passes - n > 1 ? 'es' : ''} for −
                {Math.round(tier.discount * 100)}%
              </p>
            )}
          </dl>
        )}
        {licensed ? (
          <Button className="w-full" disabled={!n || ordering} onClick={onBook}>
            {ordering ? <LoaderCircle className="animate-spin" /> : <Send />}
            {n ? `Book ${n} pass${n > 1 ? 'es' : ''}` : 'Select passes to book'}
          </Button>
        ) : (
          <p className="flex items-center justify-center gap-1.5 rounded-md bg-muted p-2 text-xs text-muted-foreground">
            <Lock className="size-3.5" />
            No licence for {app.name} on this account
          </p>
        )}
        <p className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
          Billed per pass flown · cancel anytime
          <Hint label="Billing">
            A pass is billed once flown, at the unit price of the order. Cancelling stops all
            later passes.
          </Hint>
        </p>
      </footer>
    </div>
  )
}

function Row({
  icon,
  label,
  locked,
  children,
}: {
  icon: ReactNode
  label: string
  locked?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground [&_svg]:size-3.5">{icon}</span>
      <span className="flex-1 text-muted-foreground">{label}</span>
      <span className={cn('flex items-center gap-1 text-xs', locked && 'text-muted-foreground')}>
        {children}
        {locked && <Lock className="size-3" aria-label="Set by your contract" />}
      </span>
    </div>
  )
}

function Line({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className={cn('flex justify-between text-muted-foreground tabular-nums', tone)}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
