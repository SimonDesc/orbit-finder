import { Cloud, Eye, EyeOff, LoaderCircle, Play } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { PREVIEWABLE, type Preview, type SatApp } from '@/lib/api'
import { fmtDate } from '@/lib/format'
import { cn } from '@/lib/utils'

import { Hint } from './Hint'
import { Empty } from './SceneList'

export type Compare = 'after' | 'before'

interface Props {
  app: SatApp | null
  preview: Preview | null
  loading: boolean
  error: string | null
  visible: boolean
  compare: Compare
  /** Set for demo replays: the result comes from that day's image, not the latest one. */
  eventDate: string | null
  onRun: () => void
  onToggle: () => void
  onCompare: (c: Compare) => void
}

const num = (v: number | null | undefined, unit = '') =>
  v == null ? '–' : `${v.toLocaleString('en')}${unit && ` ${unit}`}`
const pct = (v: number | null | undefined) => (v == null ? '–' : `${Math.round(v * 100)}%`)

/** The two numbers that matter for each app, with their colour on the map. */
export function stats(p: Preview): { label: string; value: string; color?: string }[] {
  const s = p.summary
  switch (p.app_id) {
    case 'vessel-detection':
      return [
        { label: 'vessels', value: num(s.vessels), color: '#f472b6' },
        { label: 'over 100 m', value: num(s.large_vessels) },
      ]
    case 'wildfire-detection':
      return [
        { label: 'active hotspots', value: num(s.hotspots), color: '#fb923c' },
        { label: 'burned', value: num(s.burned_ha, 'ha'), color: '#991b1b' },
      ]
    case 'flood-mapping':
      return s.flooded_km2 != null
        ? [
            { label: 'flooded', value: num(s.flooded_km2, 'km²'), color: '#38bdf8' },
            { label: 'usual water', value: num(s.usual_water_km2, 'km²'), color: '#1e40af' },
          ]
        : [
            { label: 'water', value: num(s.water_km2, 'km²'), color: '#38bdf8' },
            { label: 'of the area', value: pct(s.water_share) },
          ]
    default:
      return [
        { label: 'vegetation', value: num(s.vegetation_km2, 'km²'), color: '#16a34a' },
        { label: 'low vigour', value: pct(s.stressed_share), color: '#dc3c28' },
      ]
  }
}

function Method({ p }: { p: Preview }) {
  const how: Record<string, string> = {
    'vessel-detection': `Bright objects on open sea in the near-infrared band. ${p.summary.static_removed ?? 0} static objects (islets, platforms) dropped because they were also there on another date.`,
    'wildfire-detection':
      'Sentinel-2 has no thermal band: flames are found in its SWIR bands, where they saturate (HOTMAP, Murphy et al. 2016). Burned = vegetation lost since the “before” image (dNBR), clouds excluded.',
    'flood-mapping':
      'Water from the MNDWI index, clouds masked. Water already there on the “before” date (rivers, canals, sea) is not flood.',
    'crop-health': 'Vegetation index (NDVI) on the 10 m bands.',
  }
  return (
    <>
      <p>{how[p.app_id]}</p>
      <p className="text-muted-foreground">
        A simple public baseline, not the partner’s model. Onboard, the model runs on the raw
        frame and only this small result is downlinked, minutes after the pass. Window: up to
        30 km around the area centre, {p.pixel_m} m grid.
      </p>
    </>
  )
}

/** Runs a transparent ground-side baseline of the app on a real image: "this is what you get". */
export function PreviewCard({
  app,
  preview,
  loading,
  error,
  visible,
  compare,
  eventDate,
  onRun,
  onToggle,
  onCompare,
}: Props) {
  if (!app) return <Empty>Pick an app first.</Empty>
  if (!PREVIEWABLE.has(app.id)) return <Empty>No preview for {app.name} yet.</Empty>
  const current = preview?.app_id === app.id ? preview : null

  if (!current) {
    return (
      <div className="space-y-2">
        <Button className="w-full" disabled={loading} onClick={onRun}>
          {loading ? <LoaderCircle className="animate-spin" /> : <Play />}
          {loading
            ? 'Analysing the image…'
            : eventDate
              ? `Run on ${fmtDate(eventDate)}`
              : 'Run on the latest image'}
        </Button>
        {loading && (
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full w-1/3 animate-[progress_1.4s_ease-in-out_infinite] rounded-full bg-fuchsia-300" />
          </div>
        )}
        {loading && (
          // Cold reads from the public archive are slow on the small demo server.
          <p className="text-[11px] text-muted-foreground">Up to ~20 s</p>
        )}
        {error && !loading && <p className="text-xs text-red-300">{error}</p>}
      </div>
    )
  }

  const hasBefore = !!(current.reference_id && current.reference_datetime)

  return (
    <div className="space-y-3">
      {hasBefore ? (
        <div role="group" aria-label="Image shown" className="grid grid-cols-2 gap-1 rounded-lg bg-muted/60 p-1 text-xs">
          {(
            [
              ['before', 'Before', current.reference_datetime!],
              ['after', 'After', current.datetime],
            ] as const
          ).map(([c, label, date]) => (
            <button
              key={c}
              type="button"
              aria-pressed={visible && compare === c}
              onClick={() => {
                onCompare(c)
                if (!visible) onToggle()
              }}
              className={cn(
                'rounded-md px-2 py-1 transition-colors',
                visible && compare === c
                  ? 'bg-background shadow'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="block font-medium">{label}</span>
              <span className="block text-[10px] text-muted-foreground">{fmtDate(date)}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{fmtDate(current.datetime)}</p>
      )}

      <div className="grid grid-cols-2 gap-3">
        {stats(current).map((s) => (
          <div key={s.label}>
            <p className="text-2xl leading-none font-semibold tabular-nums">{s.value}</p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              {s.color && <span className="size-2 rounded-sm" style={{ background: s.color }} />}
              {s.label}
            </p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        {current.cloud_cover != null && (
          <span className="flex items-center gap-1">
            <Cloud className="size-3" />
            {Math.round(current.cloud_cover)}%
          </span>
        )}
        <span>Sentinel-2</span>
        <Hint label="How it is computed">
          <Method p={current} />
        </Hint>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={onToggle}
          aria-label={visible ? 'Hide the result on the map' : 'Show the result on the map'}
          title={visible ? 'Hide on map' : 'Show on map'}
          className="ml-auto"
        >
          {visible ? <Eye /> : <EyeOff />}
        </Button>
      </div>
    </div>
  )
}
