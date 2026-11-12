import { ChevronDown, ChevronUp, GripHorizontal, X } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

interface Pos {
  x: number
  y: number
}

interface Props {
  id: string // remembers where the user left it
  title: string
  icon?: ReactNode
  /** Default place, from the top corner of the map on `side`. */
  defaultOffset: Pos
  side?: 'left' | 'right'
  width?: number
  z: number
  onFocus: () => void
  onClose: () => void
  /** Below md the map is too small to float over: the panel flows in the page instead. */
  floating: boolean
  accent?: string
  children: ReactNode
}

const MARGIN = 8
const key = (id: string) => `orbit-finder-panel-${id}`

function loadPos(id: string): Pos | null {
  try {
    const v = JSON.parse(localStorage.getItem(key(id)) ?? 'null')
    return v && typeof v.x === 'number' && typeof v.y === 'number' ? v : null
  } catch {
    return null
  }
}

function savePos(id: string, pos: Pos) {
  try {
    localStorage.setItem(key(id), JSON.stringify(pos))
  } catch {
    /* not persisted: fine */
  }
}

/** A card that floats over the map: drag it by its title bar, fold it, or close it. */
export function FloatingPanel({
  id,
  title,
  icon,
  defaultOffset,
  side = 'right',
  width = 340,
  z,
  onFocus,
  onClose,
  floating,
  accent = 'border-white/15',
  children,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<Pos | null>(() => loadPos(id))
  const [folded, setFolded] = useState(false)
  const drag = useRef<{ dx: number; dy: number } | null>(null)

  /** Keep the title bar inside the map, whatever the window size. */
  const clamp = useCallback(
    (p: Pos): Pos => {
      const parent = ref.current?.offsetParent as HTMLElement | null
      if (!parent) return p
      const maxX = parent.clientWidth - Math.min(width, parent.clientWidth) - MARGIN
      const maxY = parent.clientHeight - 40
      return {
        x: Math.round(Math.max(MARGIN, Math.min(p.x, maxX))),
        y: Math.round(Math.max(MARGIN, Math.min(p.y, maxY))),
      }
    },
    [width],
  )

  useLayoutEffect(() => {
    if (!floating || pos) return
    const parent = ref.current?.offsetParent as HTMLElement | null
    if (!parent) return
    const x = side === 'left' ? defaultOffset.x : parent.clientWidth - width - defaultOffset.x
    setPos(clamp({ x, y: defaultOffset.y }))
  }, [floating, pos, clamp, width, side, defaultOffset.x, defaultOffset.y])

  useEffect(() => {
    if (!floating) return
    const onResize = () => setPos((p) => (p ? clamp(p) : p))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [floating, clamp])

  const onPointerDown = (e: React.PointerEvent) => {
    if (!floating || !pos || (e.target as HTMLElement).closest('button')) return
    onFocus()
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    setPos(clamp({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy }))
  }
  const onPointerUp = () => {
    if (!drag.current) return
    drag.current = null
    if (pos) savePos(id, pos)
  }

  return (
    <section
      ref={ref}
      onPointerDownCapture={onFocus}
      aria-label={title}
      style={
        floating
          ? { left: pos?.x ?? 0, top: pos?.y ?? 0, width, zIndex: z, visibility: pos ? 'visible' : 'hidden' }
          : undefined
      }
      className={cn(
        'flex flex-col overflow-hidden rounded-xl border bg-background/85 shadow-2xl backdrop-blur-md',
        accent,
        floating ? 'absolute max-h-[calc(100%-16px)]' : 'relative w-full',
      )}
    >
      <header
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={() => setFolded(!folded)}
        className={cn(
          'flex shrink-0 items-center gap-1.5 border-b border-white/10 px-2.5 py-1.5 select-none',
          floating && 'cursor-grab touch-none active:cursor-grabbing',
        )}
      >
        {floating && <GripHorizontal className="size-3.5 text-muted-foreground" />}
        <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-[11px] font-medium tracking-wide uppercase [&_svg]:size-3.5">
          {icon}
          {title}
        </span>
        <button
          type="button"
          onClick={() => setFolded(!folded)}
          aria-label={folded ? `Expand ${title}` : `Fold ${title}`}
          className="rounded p-0.5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
        >
          {folded ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${title}`}
          className="rounded p-0.5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </header>
      {!folded && <div className="min-h-0 overflow-y-auto p-3">{children}</div>}
    </section>
  )
}

/** True from the md breakpoint, where panels float over the map. */
export function useFloatingPanels() {
  const query = '(min-width: 768px)'
  const [floating, setFloating] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const m = window.matchMedia(query)
    const on = () => setFloating(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return floating
}
