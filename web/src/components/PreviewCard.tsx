import { Eye, EyeOff, LoaderCircle, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { PREVIEWABLE, type Preview, type SatApp } from '@/lib/api'
import { fmtDay } from '@/lib/format'

import { Empty } from './SceneList'

interface Props {
  app: SatApp | null
  preview: Preview | null
  loading: boolean
  error: string | null
  visible: boolean
  onRun: () => void
  onToggle: () => void
}

const WHY_NOT: Record<string, string> = {
  'wildfire-detection':
    'FireSentry works on thermal infrared, which Sentinel-2 doesn’t carry: no public image to preview it on.',
  'change-detection':
    'DeltaScan compares two acquisitions of the same place; a two-date preview is not in this demo yet.',
}

const fmtKm2 = (v: number | null | undefined) => (v == null ? '–' : `${v.toLocaleString('en')} km²`)
const fmtPct = (v: number | null | undefined) => (v == null ? '–' : `${Math.round(v * 100)}%`)

function stats(p: Preview): [string, string][] {
  const s = p.summary
  switch (p.app_id) {
    case 'vessel-detection':
      return [
        ['Vessels detected', String(s.vessels ?? 0)],
        ['Over 100 m', String(s.large_vessels ?? 0)],
      ]
    case 'flood-mapping':
      return [
        ['Open water', fmtKm2(s.water_km2)],
        ['Share of the area', fmtPct(s.water_share)],
      ]
    default:
      return [
        ['Vegetation', fmtKm2(s.vegetation_km2)],
        ['Low vigour', fmtPct(s.stressed_share)],
      ]
  }
}

/** Runs a transparent ground-side baseline of the app on a real image: "this is what you get". */
export function PreviewCard({ app, preview, loading, error, visible, onRun, onToggle }: Props) {
  if (!app) return null
  if (!PREVIEWABLE.has(app.id)) {
    return WHY_NOT[app.id] ? <Empty>{WHY_NOT[app.id]}</Empty> : null
  }
  const current = preview?.app_id === app.id ? preview : null

  return (
    <section className="space-y-2 rounded-lg border border-fuchsia-300/25 bg-fuchsia-300/5 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Sparkles className="size-3.5 text-fuchsia-300" />
            What you get: try it on a real image
          </p>
          <p className="text-xs text-muted-foreground">
            {current
              ? `Sentinel-2 image of ${fmtDay(current.datetime)} · ${Math.round(current.cloud_cover ?? 0)}% cloud on the tile`
              : `Runs a simple baseline of ${app.name} on the clearest recent Sentinel-2 image of the area.`}
          </p>
        </div>
        {current ? (
          <Button size="xs" variant="ghost" onClick={onToggle} aria-label="Toggle preview layer">
            {visible ? <EyeOff /> : <Eye />}
            {visible ? 'Hide' : 'Show'}
          </Button>
        ) : (
          <Button size="sm" disabled={loading} onClick={onRun}>
            {loading ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
            {loading ? 'Analysing…' : 'Run'}
          </Button>
        )}
      </div>

      {loading && (
        <p className="text-xs text-muted-foreground">
          Finding the clearest image, then reading its bands at full resolution from the public
          archive: up to ~20 s on this small demo server.
        </p>
      )}
      {error && !loading && <p className="text-xs text-red-300">{error}</p>}

      {current && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {stats(current).map(([label, value]) => (
              <div key={label} className="rounded-md bg-background/60 p-2">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-lg font-semibold tabular-nums">{value}</p>
              </div>
            ))}
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">
            {current.app_id === 'vessel-detection'
              ? `Bright objects on open sea in the near-infrared band; ${current.summary.static_removed ?? 0} static ones (islets, platforms) dropped by checking another date. `
              : `Classical spectral index on public 10 m bands (${current.pixel_m} m grid). `}
            Window of up to 30 km around the area centre. Onboard, the partner’s model runs on the
            raw frame and only this kind of result is downlinked, minutes after the pass.
          </p>
        </>
      )}
    </section>
  )
}
