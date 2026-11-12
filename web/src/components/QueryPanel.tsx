import { CloudSun, MapPin, Radar, Satellite, TriangleAlert } from 'lucide-react'
import { useState } from 'react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import type { SearchQuery } from '@/lib/api'
import { todayIso } from '@/lib/format'

interface Props {
  intent: string | null
  query: SearchQuery
  warnings: string[]
  onChange: (q: SearchQuery) => void
}

/** The structured query the AI produced, shown as editable filters: the user stays in control. */
export function QueryPanel({ intent, query, warnings, onChange }: Props) {
  // Local value only while dragging; the query is updated once the thumb is released.
  const [dragCloud, setDragCloud] = useState<number | null>(null)
  const cloud = dragCloud ?? query.max_cloud

  const sensorIcon = query.sensor === 'radar' ? <Radar /> : <Satellite />

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card/60 p-3">
      {intent && (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Understood: </span>
          {intent}
        </p>
      )}

      <div className="flex flex-wrap gap-1.5">
        <Badge variant="secondary" className="max-w-full">
          <MapPin />
          <span className="truncate">{query.place}</span>
        </Badge>
        <Badge variant="secondary">
          {sensorIcon}
          {query.sensor === 'any' ? 'Any sensor → optical' : query.sensor}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="date-from" className="text-xs text-muted-foreground">
            From
          </Label>
          <Input
            id="date-from"
            type="date"
            value={query.date_from}
            max={query.date_to}
            onChange={(e) => e.target.value && onChange({ ...query, date_from: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="date-to" className="text-xs text-muted-foreground">
            To
          </Label>
          <Input
            id="date-to"
            type="date"
            value={query.date_to}
            min={query.date_from}
            max={todayIso()}
            onChange={(e) => e.target.value && onChange({ ...query, date_to: e.target.value })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <CloudSun className="size-3.5" /> Max cloud cover
          </span>
          <span className="font-medium text-foreground tabular-nums">{cloud}%</span>
        </div>
        <Slider
          aria-label="Maximum cloud cover"
          min={0}
          max={100}
          step={5}
          value={[cloud]}
          onValueChange={(v) => setDragCloud(Array.isArray(v) ? v[0] : v)}
          onValueCommitted={(v) => {
            setDragCloud(null)
            onChange({ ...query, max_cloud: Array.isArray(v) ? v[0] : v })
          }}
        />
      </div>

      {warnings.map((w) => (
        <Alert key={w}>
          <TriangleAlert />
          <AlertDescription>{w}</AlertDescription>
        </Alert>
      ))}
    </section>
  )
}
