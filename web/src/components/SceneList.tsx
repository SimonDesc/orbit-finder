import { Cloud, CloudSun, ImageOff } from 'lucide-react'
import { useState } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import { Slider } from '@/components/ui/slider'
import type { Scene } from '@/lib/api'
import { fmtDateTime, fmtPlatform } from '@/lib/format'
import { cn } from '@/lib/utils'

import { Hint } from './Hint'

interface Props {
  largeArea: boolean
  scenes: Scene[]
  matched: number | null
  loading: boolean
  error: string | null
  activeId: string | null
  maxCloud: number
  onMaxCloudChange: (v: number) => void
  onSelect: (id: string) => void
}

/** Archive imagery of the area: the "before" picture the app's results are compared with. */
export function SceneList({
  largeArea,
  scenes,
  matched,
  loading,
  error,
  activeId,
  maxCloud,
  onMaxCloudChange,
  onSelect,
}: Props) {
  const [dragCloud, setDragCloud] = useState<number | null>(null)
  const cloud = dragCloud ?? maxCloud

  return (
    <div className="space-y-3">
      {largeArea && (
        <p className="flex items-center gap-1.5 text-xs text-amber-200">
          Area larger than one image
          <Hint label="Large area">
            One Sentinel-2 image covers ~110 km. Pick an image below, or zoom in and use “Search
            this area” for a sharper reference.
          </Hint>
        </p>
      )}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <CloudSun className="size-3.5 shrink-0" />
        <Slider
          aria-label="Maximum cloud cover"
          min={0}
          max={100}
          step={5}
          value={[cloud]}
          onValueChange={(v) => setDragCloud(Array.isArray(v) ? v[0] : v)}
          onValueCommitted={(v) => {
            setDragCloud(null)
            onMaxCloudChange(Array.isArray(v) ? v[0] : v)
          }}
          className="flex-1"
        />
        <span className="w-14 text-right font-medium text-foreground tabular-nums">≤ {cloud}%</span>
        <Hint label="Reference imagery">
          Sentinel-2 images of the area, to compare the app’s results with. Click one to show it on
          the map at full 10 m resolution.
          {matched != null && matched > scenes.length && ` Showing the ${scenes.length} most recent of ${matched}.`}
        </Hint>
      </div>

      {loading ? (
        <div className="grid grid-cols-3 gap-1.5">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="aspect-square w-full" />
          ))}
        </div>
      ) : error ? (
        <Empty tone="error">Couldn't load images: {error}</Empty>
      ) : !scenes.length ? (
        <Empty>No image. Raise the cloud limit or widen the period.</Empty>
      ) : (
        <ul className="grid grid-cols-3 gap-1.5">
          {scenes.map((s) => {
            const p = s.properties
            const active = s.id === activeId
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onSelect(s.id)}
                  title={`${fmtDateTime(p.datetime)} · ${fmtPlatform(p.platform)}`}
                  className={cn(
                    'relative block aspect-square w-full overflow-hidden rounded-lg bg-muted transition',
                    active ? 'ring-2 ring-fuchsia-300' : 'opacity-85 hover:opacity-100',
                  )}
                >
                  {p.thumbnail ? (
                    <img src={p.thumbnail} alt="" loading="lazy" className="size-full object-cover" />
                  ) : (
                    <ImageOff className="m-auto size-4 text-muted-foreground" />
                  )}
                  {p.cloud_cover != null && (
                    <span className="absolute top-1 right-1 flex items-center gap-0.5 rounded bg-black/60 px-1 text-[10px] text-white">
                      <Cloud className="size-2.5" />
                      {Math.round(p.cloud_cover)}%
                    </span>
                  )}
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 pt-3 pb-1 text-left text-[11px] font-medium text-white">
                    {fmtShortDate(p.datetime)}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

const shortDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })
const fmtShortDate = (iso: string) => shortDate.format(new Date(iso))

export function Empty({ children, tone }: { children: React.ReactNode; tone?: 'error' }) {
  return (
    <p
      className={cn(
        'rounded-lg border border-dashed p-4 text-center text-sm',
        tone === 'error'
          ? 'border-destructive/50 text-destructive'
          : 'border-border text-muted-foreground',
      )}
    >
      {children}
    </p>
  )
}
