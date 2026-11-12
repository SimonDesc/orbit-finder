import { Cloud, ExternalLink, ImageOff } from 'lucide-react'

import { Skeleton } from '@/components/ui/skeleton'
import type { Scene } from '@/lib/api'
import { fmtDateTime, fmtPlatform } from '@/lib/format'
import { cn } from '@/lib/utils'

interface Props {
  scenes: Scene[]
  matched: number | null
  loading: boolean
  error: string | null
  activeId: string | null
  onSelect: (id: string) => void
}

export function SceneList({ scenes, matched, loading, error, activeId, onSelect }: Props) {
  if (loading) {
    return (
      <div className="grid gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    )
  }

  if (error) return <Empty tone="error">Couldn't load scenes: {error}</Empty>

  if (!scenes.length) {
    return (
      <Empty>
        No Sentinel-2 scene matches. Try a longer time window or a higher cloud tolerance.
      </Empty>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {matched != null && matched > scenes.length
          ? `Showing the ${scenes.length} most recent of ${matched} scenes`
          : `${scenes.length} scene${scenes.length > 1 ? 's' : ''}, most recent first`}
      </p>
      <ul className="grid gap-2">
        {scenes.map((s) => {
          const p = s.properties
          const active = s.id === activeId
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                className={cn(
                  'flex w-full gap-3 rounded-lg border p-2 text-left transition-colors',
                  active
                    ? 'border-fuchsia-300/60 bg-fuchsia-300/10'
                    : 'border-border hover:border-foreground/25 hover:bg-muted/40',
                )}
              >
                {p.thumbnail ? (
                  <img
                    src={p.thumbnail}
                    alt={`Preview of ${s.id}`}
                    loading="lazy"
                    className="size-16 shrink-0 rounded-md bg-muted object-cover"
                  />
                ) : (
                  <div className="flex size-16 shrink-0 items-center justify-center rounded-md bg-muted">
                    <ImageOff className="size-4 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-medium">{fmtDateTime(p.datetime)}</p>
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span>{fmtPlatform(p.platform)}</span>
                    {p.tile && <span>{p.tile.replace('MGRS-', 'Tile ')}</span>}
                    {p.cloud_cover != null && (
                      <span className="flex items-center gap-0.5">
                        <Cloud className="size-3" />
                        {Math.round(p.cloud_cover)}%
                      </span>
                    )}
                  </p>
                </div>
              </button>
              {active && (
                <div className="mt-2 space-y-2 rounded-lg border border-border p-2">
                  {p.thumbnail && (
                    <img
                      src={p.thumbnail}
                      alt={`True-colour preview of ${s.id}`}
                      className="w-full rounded-md"
                    />
                  )}
                  <div className="flex flex-wrap gap-3 text-xs">
                    {p.visual && <Link href={p.visual}>Full-resolution image (COG)</Link>}
                    {p.stac_url && <Link href={p.stac_url}>STAC metadata</Link>}
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Link({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-sky-300 hover:underline"
    >
      {children}
      <ExternalLink className="size-3" />
    </a>
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
