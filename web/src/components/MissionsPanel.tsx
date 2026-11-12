import { CalendarClock, LoaderCircle, MapPin, Sparkles, XCircle } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { type Account, type Order, PREVIEWABLE, type SatApp } from '@/lib/api'
import { fmtDateTime, fmtDay, fmtRelative, fmtTime } from '@/lib/format'
import { cn } from '@/lib/utils'

import { Empty } from './SceneList'

interface Props {
  account: Account | null
  apps: SatApp[]
  orders: Order[]
  loading: boolean
  error: string | null
  cancelling: string | null
  onCancel: (id: string) => void
  onShow: (order: Order) => void
}

const STATUS_STYLE: Record<Order['status'], string> = {
  active: 'bg-emerald-400/15 text-emerald-300',
  completed: 'bg-sky-400/15 text-sky-300',
  cancelled: 'bg-slate-500/20 text-slate-300',
}

/** The account's missions with live usage: what is booked, consumed and billed. */
export function MissionsPanel({
  account,
  apps,
  orders,
  loading,
  error,
  cancelling,
  onCancel,
  onShow,
}: Props) {
  if (loading) {
    return (
      <div className="grid gap-2">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    )
  }
  if (error) return <Empty tone="error">Couldn't load missions: {error}</Empty>

  const billed = orders.reduce((s, o) => s + o.usage.billed_eur, 0)
  const committed = orders.reduce((s, o) => s + o.usage.committed_eur, 0)

  return (
    <div className="space-y-3">
      <div>
        <h2 className="font-semibold">My missions</h2>
        <p className="text-xs text-muted-foreground">
          {account?.name} · licensed for{' '}
          {account?.licensed_apps.map((id) => apps.find((a) => a.id === id)?.name ?? id).join(', ')}
        </p>
      </div>

      {orders.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Billed so far" value={`€${billed}`} />
          <Stat label="Committed" value={`€${committed}`} />
        </div>
      )}

      {!orders.length ? (
        <Empty>No mission yet. Ask for a need, then “Request this mission”.</Empty>
      ) : (
        <ul className="grid grid-cols-1 gap-2">
          {orders.map((o) => {
            const app = apps.find((a) => a.id === o.app_id)
            const next = o.passes.find((p) => p.state === 'scheduled')
            const u = o.usage
            return (
              <li key={o.id} className="space-y-2 rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{app?.name ?? o.app_id}</p>
                    <button
                      type="button"
                      onClick={() => onShow(o)}
                      className="flex max-w-full items-center gap-1 text-xs text-sky-300 hover:underline"
                    >
                      <MapPin className="size-3 shrink-0" />
                      <span className="truncate">{o.place}</span>
                    </button>
                  </div>
                  <Badge className={cn('shrink-0 capitalize', STATUS_STYLE[o.status])}>
                    {o.status}
                  </Badge>
                </div>

                <div>
                  <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="bg-amber-300"
                      style={{
                        width: `${(u.passes_consumed / u.passes_booked) * 100}%`,
                      }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {u.passes_consumed}/{u.passes_booked} passes used · €{u.billed_eur} billed of €
                    {u.committed_eur} · €{u.price_eur_per_pass}/pass
                  </p>
                </div>

                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <CalendarClock className="size-3.5" />
                    {next
                      ? `Next: ${fmtDay(next.time)} ${fmtTime(next.time)} (${fmtRelative(next.time)})`
                      : `Ordered ${fmtDateTime(o.created_at)}`}
                  </span>
                  <div className="flex items-center">
                    {PREVIEWABLE.has(o.app_id) && (
                      <Button variant="ghost" size="xs" onClick={() => onShow(o)}>
                        <Sparkles />
                        Sample output
                      </Button>
                    )}
                    {o.status === 'active' && (
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={cancelling === o.id}
                        onClick={() => onCancel(o.id)}
                      >
                        {cancelling === o.id ? (
                          <LoaderCircle className="animate-spin" />
                        ) : (
                          <XCircle />
                        )}
                        Cancel
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        Usage is metered from pass times: a booked pass is billed once flown, unless the mission was
        cancelled before it.
      </p>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  )
}
