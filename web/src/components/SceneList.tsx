import { Cloud, CloudSun, ExternalLink, ImageOff } from 'lucide-react'
import { useState } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import { Slider } from '@/components/ui/slider'
import type { Scene } from '@/lib/api'
import { fmtDateTime, fmtPlatform } from '@/lib/format'
import { cn } from '@/lib/utils'

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
      <p className="text-xs text-muted-foreground">
        Latest Sentinel-2 images of the area, as a reference to compare the app's results with.
        The selected image is shown on the map at full 10 m resolution.
      </p>
      {largeArea && (
        <p className="rounded-lg border border-amber-300/30 bg-amber-300/5 p-2 text-xs text-amber-100">
          This area is larger than one image (~110 km). Pick an image below, or zoom in and use
          “Search this area” for a sharper reference.
        </p>
      )}
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
            onMaxCloudChange(Array.isArray(v) ? v[0] : v)
          }}
        />
      </div>

      {loading ? (
        <div className="grid gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : error ? (
        <Empty tone="error">Couldn't load images: {error}</Empty>
      ) : !scenes.length ? (
        <Empty>No image matches. Try a longer period or a higher cloud tolerance.</Empty>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {matched != null && matched > scenes.length
              ? `${scenes.length} most recent of ${matched} images`
              : `${scenes.length} image${scenes.length > 1 ? 's' : ''}, most recent first`}
          </p>
          <ul className="grid gap-1.5">
            {scenes.map((s) => {
              const p = s.properties
              const active = s.id === activeId
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(s.id)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg border p-1.5 text-left transition-colors',
                      active
                        ? 'border-fuchsia-300/60 bg-fuchsia-300/10'
                        : 'border-border hover:border-foreground/25 hover:bg-muted/40',
                    )}
                  >
                    {p.thumbnail ? (
                      <img
                        src={p.thumbnail}
                        alt=""
                        loading="lazy"
                        className="size-11 shrink-0 rounded-md bg-muted object-cover"
                      />
                    ) : (
                      <div className="flex size-11 shrink-0 items-center justify-center rounded-md bg-muted">
                        <ImageOff className="size-4 text-muted-foreground" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{fmtDateTime(p.datetime)}</p>
                      <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <span>{fmtPlatform(p.platform)}</span>
                        {p.cloud_cover != null && (
                          <span className="flex items-center gap-0.5">
                            <Cloud className="size-3" />
                            {Math.round(p.cloud_cover)}%
                          </span>
                        )}
                        {active && p.stac_url && (
                          <a
                            href={p.stac_url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-0.5 text-sky-300 hover:underline"
                          >
                            STAC <ExternalLink className="size-3" />
                          </a>
                        )}
                      </p>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}

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
