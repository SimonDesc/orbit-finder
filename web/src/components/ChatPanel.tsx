import {
  Anchor,
  Check,
  Clock,
  Cpu,
  Euro,
  Flame,
  History,
  MapPin,
  Moon,
  Satellite,
  SquarePen,
  Sun,
  TriangleAlert,
  Waves,
} from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import type { Demo, SatApp } from '@/lib/api'
import { fmtDate, fmtDay, fmtRelative, fmtTime } from '@/lib/format'
import { cn } from '@/lib/utils'

import { Hint } from './Hint'
import { Logo } from './Logo'

/** One line of the conversation. Assistant lines are structured: the UI draws them. */
export type ChatBody =
  (
  | { role: 'user'; text: string }
  | { role: 'assistant'; kind: 'text'; text: string }
  | { role: 'assistant'; kind: 'error'; text: string }
  | {
      role: 'assistant'
      kind: 'mission'
      intent: string
      place: string
      app: SatApp | null
      reason: string | null
      warnings: string[]
      replay: string | null // event date for demo replays
    }
  | {
      role: 'assistant'
      kind: 'passes'
      usable: number
      total: number
      next: { satellite: string; time: string } | null
      selected: number
    }
  | {
      role: 'assistant'
      kind: 'result'
      date: string
      stats: { label: string; value: string; color?: string }[]
    }
  | { role: 'assistant'; kind: 'booked'; app: string; passes: number; total: number }
)

export type ChatMsg = { id: number } & ChatBody

export interface QuickReply {
  label: string
  icon?: ReactNode
  primary?: boolean
  onClick: () => void
}

export interface PastMission {
  id: number
  title: string
  appId: string | null
  at: string
}

const APP_ICONS: Record<string, ReactNode> = {
  'vessel-detection': <Anchor />,
  'wildfire-detection': <Flame />,
  'flood-mapping': <Waves />,
}
const APP_TONES: Record<string, string> = {
  'vessel-detection': 'text-pink-300 bg-pink-400/15',
  'wildfire-detection': 'text-orange-300 bg-orange-400/15',
  'flood-mapping': 'text-sky-300 bg-sky-400/15',
}

function AppIcon({ appId, className }: { appId: string | null; className?: string }) {
  return (
    <span
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4',
        (appId && APP_TONES[appId]) ?? 'bg-sky-400/15 text-sky-300',
        className,
      )}
    >
      {(appId && APP_ICONS[appId]) ?? <Cpu />}
    </span>
  )
}


interface Props {
  messages: ChatMsg[]
  replies: QuickReply[]
  demos: Demo[]
  history: PastMission[]
  onDemo: (d: Demo) => void
  onNew: () => void
  onRestore: (id: number) => void
}

/** The left column: the customer talks, the assistant answers with structured cards. */
export function ChatPanel({
  messages,
  replies,
  demos,
  history,
  onDemo,
  onNew,
  onRestore,
}: Props) {
  const [showHistory, setShowHistory] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  const empty = !messages.length

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, replies.length])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-1 border-b border-border px-3 py-2">
        <h1>
          <Logo />
        </h1>
        <div className="relative ml-auto flex items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Past missions"
            title="Past missions"
            aria-expanded={showHistory}
            disabled={!history.length}
            onClick={() => setShowHistory(!showHistory)}
          >
            <History />
          </Button>
          <Button size="sm" variant="outline" onClick={onNew} disabled={empty}>
            <SquarePen />
            New mission
          </Button>
          {showHistory && history.length > 0 && (
            <div className="absolute top-9 right-0 z-30 w-72 rounded-lg border border-border bg-popover p-1 shadow-xl">
              {history.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => {
                    onRestore(h.id)
                    setShowHistory(false)
                  }}
                  className="flex w-full items-center gap-2 rounded-md p-2 text-left hover:bg-muted"
                >
                  <AppIcon appId={h.appId} className="size-6 [&_svg]:size-3" />
                  <span className="min-w-0 flex-1 truncate text-sm">{h.title}</span>
                  <span className="text-[10px] text-muted-foreground">{h.at}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {empty ? (
          <Welcome demos={demos} onDemo={onDemo} />
        ) : (
          messages.map((m) => <Message key={m.id} m={m} />)
        )}
        {replies.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {replies.map((r) => (
              <Button
                key={r.label}
                size="sm"
                variant={r.primary ? 'default' : 'outline'}
                onClick={r.onClick}
              >
                {r.icon}
                {r.label}
              </Button>
            ))}
          </div>
        )}
        <div ref={end} />
      </div>

    </div>
  )
}

function Welcome({ demos, onDemo }: { demos: Demo[]; onDemo: (d: Demo) => void }) {
  return (
    <div className="space-y-5 pt-2">
      <div>
        <p className="font-heading text-xl leading-tight font-semibold tracking-tight">
          What should a satellite watch for you?
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick a mission: I find the onboard AI app, the passes and the price.
        </p>
      </div>
      <section className="space-y-1.5">
        <h2 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Demo missions
        </h2>
        {demos.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => onDemo(d)}
            className="flex w-full items-center gap-3 rounded-xl border border-border p-2.5 text-left transition-colors hover:border-foreground/30 hover:bg-muted/40"
          >
            <AppIcon appId={d.app_id} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{d.title}</span>
              <span className="block text-xs text-muted-foreground">
                {d.event_date ? `Replay · ${fmtDate(d.event_date)}` : 'Live · latest image'}
              </span>
            </span>
          </button>
        ))}
      </section>
    </div>
  )
}

function Bubble({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-xl border border-border bg-muted/30 p-3', className)}>
      {children}
    </div>
  )
}

function Chip({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums [&_svg]:size-3 [&_svg]:text-muted-foreground">
      {icon}
      {children}
    </span>
  )
}

function Message({ m }: { m: ChatMsg }) {
  if (m.role === 'user') {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-sky-500/20 px-3 py-2 text-sm">
          {m.text}
        </p>
      </div>
    )
  }
  switch (m.kind) {
    case 'text':
      return <p className="text-sm text-muted-foreground">{m.text}</p>
    case 'error':
      return (
        <p className="flex items-start gap-1.5 text-sm text-red-300">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          {m.text}
        </p>
      )
    case 'mission':
      return (
        <Bubble className="space-y-2.5">
          <p className="text-sm">{m.intent}</p>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="size-3.5 shrink-0 text-sky-300" />
            <span className="truncate">{m.place}</span>
            {m.warnings.length > 0 && (
              <span className="ml-auto flex shrink-0 items-center gap-1 text-amber-300">
                <TriangleAlert className="size-3.5" />
                <Hint label="Notes">
                  {m.warnings.map((w) => (
                    <p key={w}>{w}</p>
                  ))}
                </Hint>
              </span>
            )}
          </p>
          {m.app ? (
            <div className="flex items-center gap-2.5 rounded-lg bg-background/60 p-2">
              <AppIcon appId={m.app.id} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  {m.app.name}
                  {m.reason && <Hint label="Why this app">{m.reason}</Hint>}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Chip icon={m.app.sensor === 'thermal' ? <Moon /> : <Sun />}>
                    {m.app.sensor === 'thermal' ? 'Day & night' : 'Daylight'}
                  </Chip>
                  <Chip icon={<Clock />}>{m.app.latency_min} min</Chip>
                  <Chip icon={<Euro />}>{m.app.price_eur_per_pass}/pass</Chip>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-amber-300">No app in the catalog fits yet.</p>
          )}
          {m.replay && (
            <p className="text-xs text-muted-foreground">Replay of {m.replay}</p>
          )}
        </Bubble>
      )
    case 'passes':
      return (
        <Bubble className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-sm">
            <Satellite className="size-4 text-amber-300" />
            <span className="font-medium">{m.usable} passes</span>
            <span className="text-muted-foreground">can run it in the next 48 h</span>
          </p>
          {m.next && (
            <p className="text-xs text-muted-foreground">
              Next: {m.next.satellite}, {fmtDay(m.next.time)} {fmtTime(m.next.time)} (
              {fmtRelative(m.next.time)}). The {m.selected} soonest are selected on the right.
            </p>
          )}
        </Bubble>
      )
    case 'result':
      return (
        <Bubble className="space-y-2">
          <p className="text-xs text-muted-foreground">Sample output · {fmtDate(m.date)}</p>
          <div className="grid grid-cols-2 gap-2">
            {m.stats.map((s) => (
              <div key={s.label}>
                <p className="text-xl leading-none font-semibold tabular-nums">{s.value}</p>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  {s.color && <span className="size-2 rounded-sm" style={{ background: s.color }} />}
                  {s.label}
                </p>
              </div>
            ))}
          </div>
        </Bubble>
      )
    case 'booked':
      return (
        <Bubble className="flex items-center gap-2 border-emerald-400/30 bg-emerald-400/10">
          <Check className="size-4 shrink-0 text-emerald-300" />
          <p className="text-sm">
            {m.app}: {m.passes} pass{m.passes > 1 ? 'es' : ''} booked · €
            {m.total.toLocaleString('en')}
          </p>
        </Bubble>
      )
  }
}
