import { useEffect, useState } from 'react'

import { PASS_DAYS, type Pass } from '@/lib/api'
import { fmtDay, fmtTime } from '@/lib/format'
import { cn } from '@/lib/utils'

interface Props {
  passes: Pass[]
  usable: boolean[]
  selected: Set<string>
  activeIndex: number | null
  onToggle: (time: string) => void
  onHover: (i: number | null) => void
}

const SPAN_MS = PASS_DAYS * 86_400_000

/** 48 h at a glance: each pass is a tick; click one to add it to the booking or remove it. */
export function PassTimeline({ passes, usable, selected, activeIndex, onToggle, onHover }: Props) {
  const [start, setStart] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setStart(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const x = (t: number) => `${Math.min(100, Math.max(0, ((t - start) / SPAN_MS) * 100))}%`
  // Day boundaries and every 6 h, in the viewer's time zone.
  const ticks: { t: number; label: string; day: boolean }[] = []
  const first = new Date(start)
  first.setMinutes(0, 0, 0)
  first.setHours(Math.ceil(first.getHours() / 6) * 6)
  for (let t = first.getTime(); t < start + SPAN_MS; t += 6 * 3_600_000) {
    const d = new Date(t)
    const midnight = d.getHours() === 0
    ticks.push({ t, label: midnight ? fmtDay(d.toISOString()) : fmtTime(d.toISOString()), day: midnight })
  }

  return (
    <div className="relative h-16 shrink-0 border-t border-border bg-background px-4 select-none">
      <div className="absolute inset-x-4 top-7 h-px bg-border" />
      {ticks.map((k) => (
        <div key={k.t} className="absolute top-0 bottom-0" style={{ left: `calc(1rem + (100% - 2rem) * ${parseFloat(x(k.t)) / 100})` }}>
          <div className={cn('h-full w-px', k.day ? 'bg-border' : 'bg-border/40')} />
          <span
            className={cn(
              'absolute bottom-1 left-1 text-[10px] whitespace-nowrap',
              k.day ? 'font-medium text-foreground/80' : 'text-muted-foreground',
            )}
          >
            {k.label}
          </span>
        </div>
      ))}
      <span className="absolute top-1 left-4 text-[10px] font-medium text-sky-300">Now</span>
      {passes.map((p, i) => {
        const t = new Date(p.time).getTime()
        const ok = usable[i]
        const on = selected.has(p.time)
        const active = i === activeIndex
        return (
          <button
            key={`${p.norad_id}-${p.time}`}
            type="button"
            disabled={!ok}
            onClick={() => onToggle(p.time)}
            onMouseEnter={() => onHover(i)}
            onMouseLeave={() => onHover(null)}
            aria-pressed={on}
            aria-label={`${p.satellite} ${fmtDay(p.time)} ${fmtTime(p.time)}`}
            title={`${p.satellite} · ${fmtDay(p.time)} ${fmtTime(p.time)}${ok ? (on ? ' · selected' : ' · click to add') : ' · night: optical app can’t run'}`}
            className="absolute top-7 -translate-x-1/2 -translate-y-1/2 p-1"
            style={{ left: `calc(1rem + (100% - 2rem) * ${parseFloat(x(t)) / 100})` }}
          >
            <span
              className={cn(
                'block rounded-full border-2 transition-transform',
                ok ? 'size-3.5 border-amber-300' : 'size-2 border-slate-500 bg-slate-600',
                on && 'bg-amber-300',
                ok && !on && 'bg-background',
                active && 'scale-150',
              )}
            />
          </button>
        )
      })}
    </div>
  )
}
