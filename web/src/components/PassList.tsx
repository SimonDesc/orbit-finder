import { Moon, Sun } from 'lucide-react'

import { Skeleton } from '@/components/ui/skeleton'
import type { Pass } from '@/lib/api'
import { fmtDay, fmtRelative, fmtTime, fmtUtcTime } from '@/lib/format'
import { cn } from '@/lib/utils'

import { Empty } from './SceneList'

interface Props {
  passes: Pass[]
  loading: boolean
  error: string | null
  tleAgeHours: number | null
  activeIndex: number | null
  onSelect: (i: number | null) => void
}

export function PassList({ passes, loading, error, tleAgeHours, activeIndex, onSelect }: Props) {
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

  if (!passes.length) {
    return <Empty>No Sentinel-2 pass over this area in the next 5 days.</Empty>
  }

  const nextDay = passes.find((p) => p.daylight)

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {nextDay
          ? `Next imaging opportunity: ${fmtDay(nextDay.time)}, ${fmtRelative(nextDay.time)}.`
          : 'No daytime pass in the next 5 days.'}{' '}
        Optical sensors only image in daylight.
      </p>
      <ol className="grid gap-2">
        {passes.map((p, i) => {
          const active = i === activeIndex
          return (
            <li key={`${p.norad_id}-${p.time}`}>
              <button
                type="button"
                onClick={() => onSelect(active ? null : i)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg border p-2.5 text-left transition-colors',
                  active
                    ? 'border-amber-300/60 bg-amber-300/10'
                    : 'border-border hover:border-foreground/25 hover:bg-muted/40',
                  !p.daylight && !active && 'opacity-60',
                )}
              >
                <span
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-full',
                    p.daylight ? 'bg-amber-300/15 text-amber-300' : 'bg-slate-500/15 text-slate-400',
                  )}
                >
                  {p.daylight ? <Sun className="size-4" /> : <Moon className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {p.satellite.replace('SENTINEL', 'Sentinel')} · {fmtDay(p.time)} {fmtTime(p.time)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {fmtRelative(p.time)} · {fmtUtcTime(p.time)} · {Math.round(p.offset_km)} km from
                    center · {p.daylight ? 'imaging possible' : 'night, no optical imaging'}
                  </p>
                </div>
              </button>
            </li>
          )
        })}
      </ol>
      <p className="text-xs text-muted-foreground">
        Geometric estimate from public orbits (CelesTrak TLE + SGP4) and a 290 km swath, not the
        operator's acquisition plan.
        {tleAgeHours != null &&
          ` Orbit data is ${tleAgeHours < 48 ? `${Math.round(tleAgeHours)} h` : `${Math.round(tleAgeHours / 24)} days`} old.`}
      </p>
    </div>
  )
}
