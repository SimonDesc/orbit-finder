import { LoaderCircle, Lock, Moon, Satellite, Send, Sun } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { canRun, type Pass, type SatApp } from '@/lib/api'
import { fmtDay, fmtRelative, fmtTime } from '@/lib/format'
import { cn } from '@/lib/utils'

import { Empty } from './SceneList'

interface Props {
  app: SatApp | null
  passes: Pass[]
  loading: boolean
  error: string | null
  tleAgeHours: number | null
  activeIndex: number | null
  onSelect: (i: number | null) => void
  licensed: boolean
  ordering: boolean
  onRequest: () => void
}

const addMinutes = (iso: string, min: number) =>
  new Date(new Date(iso).getTime() + min * 60_000).toISOString()

/** Upcoming passes over the area, framed as chances to run the selected app. */
export function OpportunityList({
  app,
  passes,
  loading,
  error,
  tleAgeHours,
  activeIndex,
  onSelect,
  licensed,
  ordering,
  onRequest,
}: Props) {
  if (loading) {
    return (
      <div className="grid gap-2">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    )
  }
  if (error) return <Empty tone="error">Couldn't predict passes: {error}</Empty>
  if (!app) return <Empty>Pick an app to see when it can run over this area.</Empty>
  if (!passes.length) return <Empty>No pass over this area in the next 5 days.</Empty>

  const usable = passes.filter((p) => canRun(app, p))
  const next = usable[0]

  return (
    <div className="space-y-3">
      {next ? (
        <div className="rounded-xl border border-amber-300/40 bg-amber-300/10 p-3">
          <p className="text-[11px] font-medium tracking-wide text-amber-200 uppercase">
            Next opportunity
          </p>
          <p className="mt-0.5 font-semibold">
            {fmtDay(next.time)} at {fmtTime(next.time)}{' '}
            <span className="font-normal text-muted-foreground">({fmtRelative(next.time)})</span>
          </p>
          <p className="text-sm text-muted-foreground">
            Insight delivered around {fmtTime(addMinutes(next.time, app.latency_min))} ·{' '}
            {usable.length} usable pass{usable.length > 1 ? 'es' : ''} in 5 days · €
            {usable.length * app.price_eur_per_pass} to monitor them all
          </p>
          {licensed ? (
            <Button className="mt-2.5 w-full" onClick={onRequest} disabled={ordering}>
              {ordering ? <LoaderCircle className="animate-spin" /> : <Send />}
              Request this mission · €{usable.length * app.price_eur_per_pass}
            </Button>
          ) : (
            <p className="mt-2.5 flex items-center gap-1.5 rounded-md border border-border bg-background/60 p-2 text-xs text-muted-foreground">
              <Lock className="size-3.5 shrink-0" />
              Your organisation has no licence for {app.name}. Switch account or request access
              from the partner.
            </p>
          )}
        </div>
      ) : (
        <Empty>
          No pass in the next 5 days can run {app.name}: optical sensors need daylight.
        </Empty>
      )}

      <ol className="grid grid-cols-1 gap-1.5">
        {passes.map((p, i) => {
          const ok = canRun(app, p)
          const active = i === activeIndex
          return (
            <li key={`${p.norad_id}-${p.time}`}>
              <button
                type="button"
                onClick={() => onSelect(active ? null : i)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg border p-2 text-left transition-colors',
                  active
                    ? 'border-amber-300/60 bg-amber-300/10'
                    : 'border-border hover:border-foreground/25 hover:bg-muted/40',
                  !ok && !active && 'opacity-55',
                )}
              >
                <span
                  className={cn(
                    'flex size-7 shrink-0 items-center justify-center rounded-full [&_svg]:size-3.5',
                    p.daylight ? 'bg-amber-300/15 text-amber-300' : 'bg-slate-500/20 text-slate-300',
                  )}
                >
                  {p.daylight ? <Sun /> : <Moon />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {fmtDay(p.time)} {fmtTime(p.time)}
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                      {fmtRelative(p.time)}
                    </span>
                  </p>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Satellite className="size-3" />
                    {p.satellite.replace('SENTINEL', 'Sentinel')} · {Math.round(p.offset_km)} km
                    off center · {ok ? 'can run' : 'night, optical app can’t run'}
                  </p>
                </div>
              </button>
            </li>
          )
        })}
      </ol>

      <p className="text-xs text-muted-foreground">
        Passes are computed from public orbits (CelesTrak TLE + SGP4) of Sentinel-2A/B/C, used here
        as stand-ins for an AI-enabled fleet, with a 290 km swath.
        {tleAgeHours != null &&
          ` Orbit data is ${
            tleAgeHours < 48 ? `${Math.round(tleAgeHours)} h` : `${Math.round(tleAgeHours / 24)} days`
          } old.`}
      </p>
    </div>
  )
}
