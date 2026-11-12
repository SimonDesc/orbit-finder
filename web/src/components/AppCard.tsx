import { Clock, Cpu, Euro, PackageOpen, Sun, Thermometer } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import type { SatApp } from '@/lib/api'

interface Props {
  apps: SatApp[]
  app: SatApp | null
  reason: string | null
  recommendedId: string | null
  onChange: (id: string) => void
}

/** The app the assistant recommends, with what it delivers; the user can swap it. */
export function AppCard({ apps, app, reason, recommendedId, onChange }: Props) {
  return (
    <section className="space-y-3 rounded-xl border border-sky-400/30 bg-sky-400/5 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-medium tracking-wide text-sky-300 uppercase">
            {app && app.id === recommendedId ? 'Recommended onboard app' : 'Selected onboard app'}
          </p>
          {app ? (
            <>
              <h2 className="flex items-center gap-1.5 font-semibold">
                <Cpu className="size-4 text-sky-300" />
                {app.name}
              </h2>
              <p className="text-xs text-muted-foreground">by {app.partner}</p>
            </>
          ) : (
            <h2 className="font-semibold text-muted-foreground">No app selected</h2>
          )}
        </div>
        <select
          aria-label="Change app"
          value={app?.id ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 max-w-[9rem] shrink-0 rounded-md border border-border bg-background px-1.5 text-xs"
        >
          {!app && <option value="">Choose…</option>}
          {apps.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {a.category}
            </option>
          ))}
        </select>
      </div>

      {app && (
        <>
          <p className="text-sm">
            {reason && app.id === recommendedId ? reason : app.summary}
          </p>
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <Fact icon={<PackageOpen />} label="Delivers" value={app.output} wide />
            <Fact
              icon={app.sensor === 'thermal' ? <Thermometer /> : <Sun />}
              label="Sensor"
              value={app.sensor === 'thermal' ? 'Thermal IR · day & night' : 'Optical · daylight only'}
            />
            <Fact icon={<Clock />} label="Insight in" value={`~${app.latency_min} min after pass`} />
            <Fact icon={<Euro />} label="Price" value={`€${app.price_eur_per_pass} per pass`} />
            <div className="flex items-end">
              <Badge variant="secondary">{app.category}</Badge>
            </div>
          </dl>
        </>
      )}
    </section>
  )
}

function Fact({
  icon,
  label,
  value,
  wide,
}: {
  icon: React.ReactNode
  label: string
  value: string
  wide?: boolean
}) {
  return (
    <div className={wide ? 'col-span-2' : undefined}>
      <dt className="flex items-center gap-1 text-muted-foreground [&_svg]:size-3">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  )
}
