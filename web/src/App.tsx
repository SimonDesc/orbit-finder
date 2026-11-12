import { CalendarRange, ClipboardList, Images, MapPin, Play, Send, Sparkles, Ticket } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { BookingRail } from '@/components/BookingRail'
import { type ChatBody, type ChatMsg, ChatPanel, type PastMission, type QuickReply } from '@/components/ChatPanel'
import { FloatingPanel, useFloatingPanels } from '@/components/FloatingPanel'
import { MapView } from '@/components/MapView'
import { MissionsPanel } from '@/components/MissionsPanel'
import { PassTimeline } from '@/components/PassTimeline'
import { type Compare, PreviewCard, stats } from '@/components/PreviewCard'
import { SceneList } from '@/components/SceneList'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import {
  type Account,
  type BBox,
  canRun,
  cancelOrder,
  createOrder,
  type Demo,
  fetchAccounts,
  fetchApps,
  fetchDemos,
  fetchPricing,
  listOrders,
  type Order,
  PASS_DAYS,
  type Pass,
  predictPasses,
  PREVIEWABLE,
  type Preview,
  type PricingTerms,
  type Priority,
  quote,
  runPreview,
  type SatApp,
  type Scene,
  type SearchQuery,
  searchScenes,
  setCurrentAccount,
} from '@/lib/api'
import { fmtDate, todayIso } from '@/lib/format'
import { cn } from '@/lib/utils'

const LOOKBACK_DAYS = 60
const DAY_MS = 86_400_000
const DEFAULT_SELECTION = 3 // passes pre-selected for booking
const daysBefore = (iso: string, days: number) =>
  new Date(new Date(iso).getTime() - days * DAY_MS).toISOString().slice(0, 10)
const minIso = (a: string, b: string) => (a < b ? a : b)
const bboxKey = (b: BBox) => b.join(',')

/** One Sentinel-2 image covers ~110 km: above this span a single reference image is meaningless. */
const MAX_REFERENCE_SPAN_DEG = 1.5
const isLargeArea = (b: BBox) =>
  b[2] - b[0] > MAX_REFERENCE_SPAN_DEG || b[3] - b[1] > MAX_REFERENCE_SPAN_DEG

const ACCOUNT_KEY = 'orbit-finder-account'
const DEFAULT_ACCOUNT = 'civil-protection-sud'

function initialAccount() {
  let id = DEFAULT_ACCOUNT
  try {
    id = localStorage.getItem(ACCOUNT_KEY) ?? DEFAULT_ACCOUNT
  } catch {
    /* storage unavailable: keep the default */
  }
  setCurrentAccount(id)
  return id
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'

/**
 * The best reference covers the whole area (tile and swath edges often cut it), then is the least
 * cloudy. Coverage is compared in 10% steps so a clear image beats a marginally larger one.
 */
const sceneScore = (s: Scene) =>
  Math.round((s.properties.coverage ?? 0) * 10) * 1000 - (s.properties.cloud_cover ?? 100)
const bestScene = (scenes: Scene[]) =>
  scenes.reduce<Scene | null>(
    (best, s) => (!best || sceneScore(s) > sceneScore(best) ? s : best),
    null,
  )

/** What a conversation is about: enough to put the dashboard back when reopening it. */
interface Mission {
  id: number
  title: string
  query: SearchQuery
  appId: string | null
  recommendedId: string | null
  demo: Demo | null
  booked: boolean
}

type RailTab = 'book' | 'imagery' | 'missions'

export default function App() {
  const [apps, setApps] = useState<SatApp[]>([])
  const [demos, setDemos] = useState<Demo[]>([])
  const [terms, setTerms] = useState<PricingTerms | null>(null)

  // --- Conversation -------------------------------------------------------------------------
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const nextId = useRef(1)
  const push = useCallback((m: ChatBody) => {
    setMessages((ms) => [...ms, { ...m, id: nextId.current++ } as ChatMsg])
  }, [])
  const [mission, setMission] = useState<Mission | null>(null)
  const [history, setHistory] = useState<
    (PastMission & { messages: ChatMsg[]; mission: Mission })[]
  >([])
  const announced = useRef<number | null>(null) // mission whose passes were told in the chat

  const query = mission?.query ?? null
  const setQuery = (q: SearchQuery) => setMission((m) => (m ? { ...m, query: q } : m))
  const demo = mission?.demo ?? null
  const demoRef = useRef<Demo | null>(null)
  demoRef.current = demo

  // --- Dashboard data -------------------------------------------------------------------------
  const [scenes, setScenes] = useState<Scene[]>([])
  const [matched, setMatched] = useState<number | null>(null)
  const [scenesLoading, setScenesLoading] = useState(false)
  const [scenesError, setScenesError] = useState<string | null>(null)
  const [passes, setPasses] = useState<Pass[]>([])
  const [passesFor, setPassesFor] = useState<string | null>(null)
  const [passesLoading, setPassesLoading] = useState(false)
  const [passesError, setPassesError] = useState<string | null>(null)
  const [passMeta, setPassMeta] = useState<{ fleet: number; reach: number } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [priority, setPriority] = useState<Priority>('standard')

  const [activeSceneId, setActiveSceneId] = useState<string | null>(null)
  const [focusSceneId, setFocusSceneId] = useState<string | null>(null)
  const [activePass, setActivePass] = useState<number | null>(null)
  const [railTab, setRailTab] = useState<RailTab>('missions')
  const [widened, setWidened] = useState(false)

  const [accounts, setAccounts] = useState<Account[]>([])
  const [accountId, setAccountId] = useState(initialAccount)
  const [orders, setOrders] = useState<Order[]>([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [ordersError, setOrdersError] = useState<string | null>(null)
  const [ordering, setOrdering] = useState(false)
  const [cancelling, setCancelling] = useState<string | null>(null)

  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewVisible, setPreviewVisible] = useState(true)
  const [compare, setCompare] = useState<Compare>('after')
  const [sampleOpen, setSampleOpen] = useState(false)
  const floating = useFloatingPanels()

  useEffect(() => {
    fetchApps()
      .then(setApps)
      .catch((e) => toast.error(`Couldn't load the app catalog: ${e.message}`))
    fetchAccounts()
      .then(setAccounts)
      .catch(() => setAccounts([]))
    fetchDemos()
      .then(setDemos)
      .catch(() => setDemos([]))
    fetchPricing()
      .then(setTerms)
      .catch(() => setTerms(null))
  }, [])

  const loadOrders = useCallback(() => {
    setOrdersLoading(true)
    setOrdersError(null)
    return listOrders()
      .then(setOrders)
      .catch((e) => setOrdersError(e.message))
      .finally(() => setOrdersLoading(false))
  }, [])

  useEffect(() => {
    loadOrders()
  }, [accountId, loadOrders])

  const account = accounts.find((a) => a.id === accountId) ?? null

  const switchAccount = (id: string) => {
    setCurrentAccount(id)
    setAccountId(id)
    try {
      localStorage.setItem(ACCOUNT_KEY, id)
    } catch {
      /* not persisted: fine */
    }
  }

  const appId = mission?.appId ?? null
  const app = apps.find((a) => a.id === appId) ?? null
  const usablePasses = useMemo(() => passes.map((p) => !!app && canRun(app, p)), [app, passes])
  const selectedPasses = useMemo(() => passes.map((p) => selected.has(p.time)), [passes, selected])
  const licensed = !!app && !!account?.licensed_apps.includes(app.id)
  const nSelected = passes.filter((p, i) => usablePasses[i] && selected.has(p.time)).length
  const total = app && terms ? quote(app, nSelected, priority, terms).total_eur : 0

  // Reference imagery depends on the whole query; passes only on the area.
  useEffect(() => {
    if (!query) return
    const ctrl = new AbortController()
    setScenesLoading(true)
    setScenesError(null)
    searchScenes(query, ctrl.signal)
      .then((r) => {
        // No clear image in the period (typical right after a storm): look further back, once.
        if (!r.features.length && !widened) {
          setWidened(true)
          setQuery({ ...query, date_from: daysBefore(query.date_to, LOOKBACK_DAYS) })
          return
        }
        setScenes(r.features)
        setMatched(r.matched)
        // A demo replay shows the image of the event day, not the clearest one.
        const pinned = demoRef.current?.scene_id
        setActiveSceneId(
          pinned && r.features.some((f) => f.id === pinned)
            ? pinned
            : isLargeArea(query.bbox)
              ? null
              : (bestScene(r.features)?.id ?? null),
        )
        setFocusSceneId(null)
      })
      .catch((e) => {
        if (isAbort(e)) return
        setScenes([])
        setActiveSceneId(null)
        setScenesError(e.message)
      })
      .finally(() => !ctrl.signal.aborted && setScenesLoading(false))
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `widened` is a one-shot guard
  }, [query])

  const bbox = query?.bbox ?? null
  useEffect(() => {
    if (!bbox) return
    const ctrl = new AbortController()
    setPassesLoading(true)
    setPassesError(null)
    setActivePass(null)
    predictPasses(bbox, PASS_DAYS, ctrl.signal)
      .then((r) => {
        setPasses(r.passes)
        setPassesFor(bboxKey(bbox))
        setPassMeta({ fleet: r.satellites, reach: r.reach_km })
      })
      .catch((e) => {
        if (isAbort(e)) return
        setPasses([])
        setPassesError(e.message)
      })
      .finally(() => !ctrl.signal.aborted && setPassesLoading(false))
    return () => ctrl.abort()
  }, [bbox])

  // Once the passes of a new mission are known: pre-select the soonest and say so in the chat.
  useEffect(() => {
    if (!mission || !app || !bbox || passesFor !== bboxKey(bbox)) return
    if (announced.current === mission.id) return
    announced.current = mission.id
    const usable = passes.filter((p) => canRun(app, p))
    const pick = usable.slice(0, DEFAULT_SELECTION)
    setSelected(new Set(pick.map((p) => p.time)))
    push({
      role: 'assistant',
      kind: 'passes',
      usable: usable.length,
      total: passes.length,
      next: usable[0] ? { satellite: usable[0].satellite, time: usable[0].time } : null,
      selected: pick.length,
    })
  }, [mission, app, bbox, passes, passesFor, push])

  const clearDashboard = () => {
    setPreview(null)
    setPreviewError(null)
    setCompare('after')
    setPreviewVisible(true)
    setSampleOpen(false)
    setSelected(new Set())
    setPriority('standard')
    setScenes([])
    setPasses([])
    setPassesFor(null)
    setActiveSceneId(null)
    setWidened(false)
  }

  const begin = (m: Omit<Mission, 'id' | 'booked'>, msg: ChatBody) => {
    clearDashboard()
    setMission({ ...m, id: nextId.current++, booked: false })
    setRailTab('book')
    push(msg)
  }

  const startDemo = (d: Demo) => {
    const today = todayIso()
    switchAccount(d.account_id)
    push({ role: 'user', text: d.prompt })
    begin(
      {
        title: d.title,
        query: {
          place: d.place,
          bbox: d.bbox,
          // Replays: reference imagery around the event; live: the last month.
          date_from: daysBefore(d.event_date ?? today, d.event_date ? 12 : 30),
          date_to: d.event_date ? minIso(daysBefore(d.event_date, -4), today) : today,
          max_cloud: 40,
        },
        appId: d.app_id,
        recommendedId: d.app_id,
        demo: d,
      },
      {
        role: 'assistant',
        kind: 'mission',
        intent: d.intent,
        place: d.place,
        app: apps.find((x) => x.id === d.app_id) ?? null,
        reason: d.app_reason,
        warnings: [],
        replay: d.event_date ? fmtDate(d.event_date) : null,
      },
    )
  }

  /** Files the current conversation under "past missions". */
  const archive = () => {
    if (!mission || !messages.length) return
    const entry = {
      id: mission.id,
      title: mission.title,
      appId: mission.appId,
      at: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      messages,
      mission,
    }
    setHistory((h) => [entry, ...h.filter((x) => x.id !== mission.id)])
  }

  const newMission = () => {
    archive()
    setMessages([])
    setMission(null)
    clearDashboard()
    setRailTab('missions')
  }

  const restore = (id: number) => {
    const past = history.find((h) => h.id === id)
    if (!past) return
    archive()
    clearDashboard()
    setMessages(past.messages)
    setMission(past.mission)
    announced.current = past.mission.id // its passes were already told
    setRailTab('book')
  }

  const setAppId = (id: string) => setMission((m) => (m ? { ...m, appId: id } : m))

  const handleSearchArea = (b: BBox) => {
    if (!query) return
    setQuery({ ...query, bbox: b, place: 'Custom area (map view)' })
  }

  const book = async () => {
    if (!query || !app) return
    const times = passes
      .filter((p, i) => usablePasses[i] && selected.has(p.time))
      .map((p) => p.time)
    if (!times.length) return
    setOrdering(true)
    try {
      const order = await createOrder({
        app_id: app.id,
        place: query.place,
        bbox: query.bbox,
        days: PASS_DAYS,
        pass_times: times,
        priority,
      })
      push({
        role: 'assistant',
        kind: 'booked',
        app: app.name,
        passes: order.usage.passes_booked,
        total: order.usage.committed_eur,
      })
      setMission((m) => (m ? { ...m, booked: true } : m))
      await loadOrders()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setOrdering(false)
    }
  }

  const handleCancel = async (id: string) => {
    setCancelling(id)
    try {
      await cancelOrder(id)
      await loadOrders()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setCancelling(null)
    }
  }

  const showOrder = (o: Order) => {
    const today = todayIso()
    const a = apps.find((x) => x.id === o.app_id) ?? null
    archive()
    setMessages([])
    begin(
      {
        title: `${a?.name ?? o.app_id} · ${o.place}`,
        query: {
          place: o.place,
          bbox: o.bbox,
          date_from: daysBefore(today, 30),
          date_to: today,
          max_cloud: 30,
        },
        appId: o.app_id,
        recommendedId: null,
        demo: null,
      },
      {
        role: 'assistant',
        kind: 'mission',
        intent: `Your ${a?.name ?? 'mission'} order over this area.`,
        place: o.place,
        app: a,
        reason: null,
        warnings: [],
        replay: null,
      },
    )
  }

  const runSample = useCallback(async () => {
    if (!app || !bbox) return
    const d = demoRef.current
    const images =
      d && d.app_id === app.id ? { scene_id: d.scene_id, reference_id: d.reference_id } : {}
    setPreviewLoading(true)
    setPreviewError(null)
    setSampleOpen(true)
    try {
      const p = await runPreview(app.id, bbox, images)
      setPreview(p)
      setPreviewVisible(true)
      setCompare('after')
      push({ role: 'assistant', kind: 'result', date: p.datetime, stats: stats(p) })
    } catch (e) {
      setPreview(null)
      setPreviewError((e as Error).message)
      push({ role: 'assistant', kind: 'error', text: (e as Error).message })
    } finally {
      setPreviewLoading(false)
    }
  }, [app, bbox, push])

  // A result belongs to one app and area: drop it when either changes.
  useEffect(() => {
    setPreview(null)
    setPreviewError(null)
  }, [appId, bbox])

  const selectScene = (id: string) => {
    setRailTab('imagery')
    setActiveSceneId(id)
    setFocusSceneId(id)
  }

  const toggleSelected = (t: string) => {
    const s = new Set(selected)
    if (s.has(t)) s.delete(t)
    else s.add(t)
    setSelected(s)
  }

  // What the user can do next, offered under the conversation.
  const replies: QuickReply[] = []
  if (mission && app && !mission.booked) {
    if (PREVIEWABLE.has(app.id) && !preview && !previewLoading) {
      replies.push({
        label: demo?.event_date ? `Run a sample on ${fmtDate(demo.event_date)}` : 'Run a sample',
        icon: <Play />,
        primary: true,
        onClick: runSample,
      })
    }
    if (nSelected > 0 && licensed && passesFor) {
      replies.push({
        label: `Book ${nSelected} pass${nSelected > 1 ? 'es' : ''} · €${total.toLocaleString('en')}`,
        icon: <Send />,
        primary: !!preview,
        onClick: book,
      })
    }
  }

  const samplePanel = query && sampleOpen && (
    <FloatingPanel
      id="preview"
      title="Sample output"
      icon={<Sparkles className="text-fuchsia-300" />}
      accent="border-fuchsia-300/30"
      defaultOffset={{ x: 12, y: 12 }}
      z={20}
      onFocus={() => undefined}
      onClose={() => setSampleOpen(false)}
      floating={floating}
    >
      <PreviewCard
        app={app}
        preview={preview}
        loading={previewLoading}
        error={previewError}
        visible={previewVisible}
        compare={compare}
        eventDate={demo && demo.app_id === app?.id ? demo.event_date : null}
        onRun={runSample}
        onToggle={() => setPreviewVisible(!previewVisible)}
        onCompare={setCompare}
      />
    </FloatingPanel>
  )

  const tabs: [RailTab, string, React.ReactNode, boolean][] = [
    ['book', 'Book', <Ticket key="b" />, !!query],
    ['imagery', 'Imagery', <Images key="i" />, !!query],
    ['missions', `Missions${orders.length ? ` (${orders.length})` : ''}`, <ClipboardList key="m" />, true],
  ]

  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground md:h-svh md:flex-row">
      <aside className="order-2 flex h-[80svh] flex-col border-border md:order-1 md:h-auto md:w-[360px] md:flex-none md:border-r">
        <ChatPanel
          messages={messages}
          replies={replies}
          demos={demos}
          history={history}
          onDemo={startDemo}
          onNew={newMission}
          onRestore={restore}
        />
      </aside>

      <div className="order-1 flex min-w-0 flex-1 flex-col md:order-2">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2">
          {query ? (
            <>
              <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                <MapPin className="size-4 shrink-0 text-sky-300" />
                <span className="max-w-64 truncate">{query.place}</span>
              </span>
              <select
                aria-label="Onboard app"
                value={app?.id ?? ''}
                onChange={(e) => setAppId(e.target.value)}
                className="h-7 rounded-md border border-border bg-background px-1.5 text-xs"
              >
                {!app && <option value="">Choose an app…</option>}
                {apps.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.category}
                  </option>
                ))}
              </select>
              <span
                className="flex items-center gap-1.5 text-xs text-muted-foreground"
                title="Period of the reference imagery"
              >
                <CalendarRange className="size-3.5" />
                {fmtDate(query.date_from)} – {fmtDate(query.date_to)}
              </span>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[11px] font-medium',
                  mission?.booked
                    ? 'bg-emerald-400/15 text-emerald-300'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {mission?.booked ? 'Booked' : 'Draft'}
              </span>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">No mission open</span>
          )}
          <select
            aria-label="Account"
            value={accountId}
            onChange={(e) => switchAccount(e.target.value)}
            className="ml-auto h-7 max-w-56 truncate rounded-md border border-border bg-background px-1.5 text-xs"
          >
            {(accounts.length ? accounts : [{ id: accountId, name: accountId }]).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </header>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <main className="relative h-[45svh] shrink-0 md:h-auto md:min-h-0 md:flex-1">
              <MapView
                bbox={bbox}
                scenes={scenes}
                passes={passes}
                usablePasses={usablePasses}
                selectedPasses={selectedPasses}
                activeSceneId={activeSceneId}
                focusSceneId={focusSceneId}
                activePassIndex={activePass}
                onSceneClick={selectScene}
                onSearchArea={handleSearchArea}
                preview={preview}
                previewVisible={previewVisible}
                compare={compare}
              />
              {floating && samplePanel}
              {floating && query && !sampleOpen && app && PREVIEWABLE.has(app.id) && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setSampleOpen(true)}
                  className="absolute top-3 right-3 shadow-lg"
                >
                  <Sparkles />
                  Sample output
                </Button>
              )}
            </main>
            {query && (
              <PassTimeline
                passes={passes}
                usable={usablePasses}
                selected={selected}
                activeIndex={activePass}
                onHover={setActivePass}
                onToggle={toggleSelected}
              />
            )}
            {!floating && samplePanel && <div className="p-3">{samplePanel}</div>}
          </div>

          <section className="flex min-h-0 flex-col border-border lg:w-[340px] lg:border-l">
            <nav className="flex border-b border-border">
              {tabs.map(([id, label, icon, enabled]) => (
                <button
                  key={id}
                  type="button"
                  disabled={!enabled}
                  onClick={() => setRailTab(id)}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2 text-xs transition-colors disabled:opacity-40 [&_svg]:size-3.5',
                    railTab === id
                      ? 'border-sky-400 text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </nav>
            <div className="min-h-0 flex-1">
              {railTab === 'book' && query ? (
                <BookingRail
                  app={app}
                  passes={passes}
                  usable={usablePasses}
                  loading={passesLoading}
                  error={passesError}
                  selected={selected}
                  onSelect={setSelected}
                  activeIndex={activePass}
                  onHover={setActivePass}
                  priority={priority}
                  onPriority={setPriority}
                  terms={terms}
                  licensed={licensed}
                  ordering={ordering}
                  onBook={book}
                  fleetSize={passMeta?.fleet ?? null}
                  reachKm={passMeta?.reach ?? null}
                />
              ) : railTab === 'imagery' && query ? (
                <div className="h-full overflow-y-auto p-3">
                  <SceneList
                    largeArea={isLargeArea(query.bbox)}
                    scenes={scenes}
                    matched={matched}
                    loading={scenesLoading}
                    error={scenesError}
                    activeId={activeSceneId}
                    maxCloud={query.max_cloud}
                    onMaxCloudChange={(v) => setQuery({ ...query, max_cloud: v })}
                    onSelect={selectScene}
                  />
                </div>
              ) : (
                <div className="h-full overflow-y-auto p-3">
                  <MissionsPanel
                    account={account}
                    apps={apps}
                    orders={orders}
                    loading={ordersLoading && !orders.length}
                    error={ordersError}
                    cancelling={cancelling}
                    onCancel={handleCancel}
                    onShow={showOrder}
                  />
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
      <Toaster position="bottom-center" />
    </div>
  )
}
