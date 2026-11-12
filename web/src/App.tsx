import { CalendarRange, ClipboardList, MapPin, Orbit, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { AppCard } from '@/components/AppCard'
import { MapView } from '@/components/MapView'
import { MissionsPanel } from '@/components/MissionsPanel'
import { OpportunityList } from '@/components/OpportunityList'
import { PreviewCard } from '@/components/PreviewCard'
import { SceneList } from '@/components/SceneList'
import { SearchBar } from '@/components/SearchBar'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Toaster } from '@/components/ui/sonner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  type Account,
  type BBox,
  canRun,
  cancelOrder,
  createOrder,
  fetchAccounts,
  fetchApps,
  interpret,
  listOrders,
  type Order,
  type Pass,
  predictPasses,
  PREVIEWABLE,
  type Preview,
  runPreview,
  type SatApp,
  type Scene,
  type SearchQuery,
  searchScenes,
  setCurrentAccount,
} from '@/lib/api'
import { todayIso } from '@/lib/format'

const LOOKBACK_DAYS = 60
const daysBefore = (iso: string, days: number) =>
  new Date(new Date(iso).getTime() - days * 86_400_000).toISOString().slice(0, 10)

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

export default function App() {
  const [apps, setApps] = useState<SatApp[]>([])
  const [interpreting, setInterpreting] = useState(false)
  const [intent, setIntent] = useState<string | null>(null)
  const [appId, setAppId] = useState<string | null>(null)
  const [recommendedId, setRecommendedId] = useState<string | null>(null)
  const [appReason, setAppReason] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [query, setQuery] = useState<SearchQuery | null>(null)

  const [scenes, setScenes] = useState<Scene[]>([])
  const [matched, setMatched] = useState<number | null>(null)
  const [scenesLoading, setScenesLoading] = useState(false)
  const [scenesError, setScenesError] = useState<string | null>(null)
  const [passes, setPasses] = useState<Pass[]>([])
  const [passesLoading, setPassesLoading] = useState(false)
  const [passesError, setPassesError] = useState<string | null>(null)
  const [tleAge, setTleAge] = useState<number | null>(null)

  const [activeSceneId, setActiveSceneId] = useState<string | null>(null)
  const [focusSceneId, setFocusSceneId] = useState<string | null>(null)
  const [activePass, setActivePass] = useState<number | null>(null)
  const [tab, setTab] = useState('mission')
  const [widened, setWidened] = useState(false)

  const [accounts, setAccounts] = useState<Account[]>([])
  const [accountId, setAccountId] = useState(initialAccount)
  const [view, setView] = useState<'explore' | 'missions'>('explore')
  const [orders, setOrders] = useState<Order[]>([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [ordersError, setOrdersError] = useState<string | null>(null)
  const [ordering, setOrdering] = useState(false)
  const [cancelling, setCancelling] = useState<string | null>(null)

  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewVisible, setPreviewVisible] = useState(true)
  const [autoPreview, setAutoPreview] = useState(false)

  useEffect(() => {
    fetchApps()
      .then(setApps)
      .catch((e) => toast.error(`Couldn't load the app catalog: ${e.message}`))
    fetchAccounts()
      .then(setAccounts)
      .catch(() => setAccounts([]))
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

  const app = apps.find((a) => a.id === appId) ?? null
  const usablePasses = useMemo(() => passes.map((p) => !!app && canRun(app, p)), [app, passes])

  // Reference imagery depends on the whole query; passes only on the area.
  useEffect(() => {
    if (!query) return
    const ctrl = new AbortController()
    setScenesLoading(true)
    setScenesError(null)
    searchScenes(query, ctrl.signal)
      .then((r) => {
        // No clear image in the period (typical right after a storm): look further back for a
        // clear "before" image, once, and tell the user.
        if (!r.features.length && !widened) {
          setWidened(true)
          setQuery({
            ...query,
            date_from: daysBefore(query.date_to, LOOKBACK_DAYS),
          })
          return
        }
        setScenes(r.features)
        setMatched(r.matched)
        setActiveSceneId(isLargeArea(query.bbox) ? null : (bestScene(r.features)?.id ?? null))
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
    predictPasses(bbox, 5, ctrl.signal)
      .then((r) => {
        setPasses(r.passes)
        setTleAge(r.tle_age_hours)
      })
      .catch((e) => {
        if (isAbort(e)) return
        setPasses([])
        setPassesError(e.message)
      })
      .finally(() => !ctrl.signal.aborted && setPassesLoading(false))
    return () => ctrl.abort()
  }, [bbox])

  const handleAsk = async (text: string) => {
    setInterpreting(true)
    try {
      const r = await interpret(text)
      setIntent(r.intent)
      setAppId(r.app_id)
      setRecommendedId(r.app_id)
      setAppReason(r.app_reason)
      setWarnings(r.warnings)
      setWidened(false)
      setQuery(r.query)
      setTab('mission')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setInterpreting(false)
    }
  }

  const handleSearchArea = (b: BBox) => {
    if (!query) return
    setWarnings([])
    setQuery({ ...query, bbox: b, place: 'Custom area (map view)' })
  }

  const handleRequest = async () => {
    if (!query || !app) return
    setOrdering(true)
    try {
      const order = await createOrder({
        app_id: app.id,
        place: query.place,
        bbox: query.bbox,
      })
      toast.success(`Mission booked: ${app.name}`, {
        description: `${order.usage.passes_booked} passes reserved · €${order.usage.committed_eur} committed`,
      })
      await loadOrders()
      setView('missions')
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
    setAppId(o.app_id)
    setRecommendedId(null)
    setIntent(null)
    setWarnings([])
    setWidened(false)
    setQuery({
      place: o.place,
      bbox: o.bbox,
      date_from: query?.date_from ?? daysBefore(today, 30),
      date_to: query?.date_to ?? today,
      max_cloud: query?.max_cloud ?? 30,
    })
    setTab('mission')
    setView('explore')
    setAutoPreview(true)
  }

  const handlePreview = useCallback(async () => {
    if (!app || !bbox) return
    setPreviewLoading(true)
    setPreviewError(null)
    try {
      setPreview(await runPreview(app.id, bbox))
      setPreviewVisible(true)
    } catch (e) {
      setPreview(null)
      setPreviewError((e as Error).message)
    } finally {
      setPreviewLoading(false)
    }
  }, [app, bbox])

  // A result belongs to one app and area: drop it when either changes.
  useEffect(() => {
    setPreview(null)
    setPreviewError(null)
  }, [appId, bbox])

  // Opening a mission from "My missions" shows a sample of its output straight away.
  useEffect(() => {
    if (autoPreview && app && bbox) {
      setAutoPreview(false)
      if (PREVIEWABLE.has(app.id)) handlePreview()
    }
  }, [autoPreview, app, bbox, handlePreview])

  const selectScene = (id: string) => {
    setTab('imagery')
    setActiveSceneId(id)
    setFocusSceneId(id)
  }

  return (
    <div className="flex h-svh flex-col bg-background text-foreground md:flex-row">
      <aside className="flex min-h-0 flex-1 flex-col border-border md:w-[440px] md:flex-none md:border-r">
        <header className="space-y-3 border-b border-border p-4">
          <div className="flex items-center gap-2">
            <Orbit className="size-5 text-sky-400" />
            <h1 className="font-semibold tracking-tight">Orbit Finder</h1>
            <span className="text-xs text-muted-foreground">AI mission store · demo</span>
          </div>
          <div className="flex items-center gap-2">
            <select
              aria-label="Demo account"
              value={accountId}
              onChange={(e) => switchAccount(e.target.value)}
              className="h-7 min-w-0 flex-1 truncate rounded-md border border-border bg-background px-1.5 text-xs"
            >
              {(accounts.length ? accounts : [{ id: accountId, name: accountId }]).map((a) => (
                <option key={a.id} value={a.id}>
                  Signed in as: {a.name}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant={view === 'missions' ? 'default' : 'outline'}
              onClick={() => setView(view === 'missions' ? 'explore' : 'missions')}
            >
              <ClipboardList />
              My missions{orders.length > 0 && ` (${orders.length})`}
            </Button>
          </div>
          <SearchBar loading={interpreting} onSubmit={handleAsk} />
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {view === 'missions' ? (
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
          ) : query ? (
            <>
              <section className="space-y-2">
                {intent && (
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">Understood: </span>
                    {intent}
                  </p>
                )}
                <p className="flex items-center gap-1.5 text-sm">
                  <MapPin className="size-3.5 shrink-0 text-sky-300" />
                  <span className="truncate">{query.place}</span>
                </p>
                <div className="flex items-center gap-1.5">
                  <CalendarRange className="size-3.5 shrink-0 text-sky-300" />
                  <Input
                    type="date"
                    aria-label="Period start"
                    value={query.date_from}
                    max={query.date_to}
                    onChange={(e) =>
                      e.target.value && setQuery({ ...query, date_from: e.target.value })
                    }
                    className="h-7 text-xs"
                  />
                  <span className="text-muted-foreground">→</span>
                  <Input
                    type="date"
                    aria-label="Period end"
                    value={query.date_to}
                    min={query.date_from}
                    max={todayIso()}
                    onChange={(e) =>
                      e.target.value && setQuery({ ...query, date_to: e.target.value })
                    }
                    className="h-7 text-xs"
                  />
                </div>
                {widened && (
                  <p className="text-xs text-muted-foreground">
                    No clear image in that period, so reference imagery now covers the previous{' '}
                    {LOOKBACK_DAYS} days.
                  </p>
                )}
                {warnings.map((w) => (
                  <Alert key={w}>
                    <TriangleAlert />
                    <AlertDescription>{w}</AlertDescription>
                  </Alert>
                ))}
              </section>

              <AppCard
                apps={apps}
                app={app}
                reason={appReason}
                recommendedId={recommendedId}
                onChange={setAppId}
              />

              <PreviewCard
                app={app}
                preview={preview}
                loading={previewLoading}
                error={previewError}
                visible={previewVisible}
                onRun={handlePreview}
                onToggle={() => setPreviewVisible(!previewVisible)}
              />

              <Tabs
                value={tab}
                onValueChange={(v) => {
                  setTab(String(v))
                  setActivePass(null)
                }}
              >
                <TabsList className="w-full">
                  <TabsTrigger value="mission">
                    Opportunities
                    {!passesLoading && app && ` (${usablePasses.filter(Boolean).length})`}
                  </TabsTrigger>
                  <TabsTrigger value="imagery">
                    Reference imagery{!scenesLoading && ` (${scenes.length})`}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="mission" className="pt-2">
                  <OpportunityList
                    app={app}
                    passes={passes}
                    loading={passesLoading}
                    error={passesError}
                    tleAgeHours={tleAge}
                    activeIndex={activePass}
                    onSelect={setActivePass}
                    licensed={!!app && !!account?.licensed_apps.includes(app.id)}
                    ordering={ordering}
                    onRequest={handleRequest}
                  />
                </TabsContent>
                <TabsContent value="imagery" className="pt-2">
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
                </TabsContent>
              </Tabs>
            </>
          ) : (
            <Intro />
          )}
        </div>

        <footer className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          Demo: apps, partners and prices are fictional. Imagery: Copernicus Sentinel-2.
        </footer>
      </aside>

      <main className="order-first h-[45svh] shrink-0 md:order-none md:h-auto md:flex-1">
        <MapView
          bbox={bbox}
          scenes={scenes}
          passes={passes}
          usablePasses={usablePasses}
          activeSceneId={activeSceneId}
          focusSceneId={focusSceneId}
          activePassIndex={activePass}
          onSceneClick={selectScene}
          onSearchArea={handleSearchArea}
          preview={preview}
          previewVisible={previewVisible}
        />
      </main>
      <Toaster position="bottom-center" />
    </div>
  )
}

function Intro() {
  const steps = [
    ['Ask', 'Describe what you need to know, and where, in English or French.'],
    [
      'Match',
      'The assistant picks the AI app that answers it, from apps that run onboard satellites.',
    ],
    ['Plan', 'See when a satellite able to run it passes over your area, what you get and when.'],
    ['Try', 'Run a preview of the app on the latest real Sentinel-2 image: ships, water, crops.'],
    ['Order', 'Book the mission: passes are reserved, metered and billed as they are flown.'],
  ]
  return (
    <ol className="space-y-3">
      {steps.map(([title, text], i) => (
        <li key={title} className="flex gap-3">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-sky-400/15 text-xs font-semibold text-sky-300">
            {i + 1}
          </span>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{title}. </span>
            {text}
          </p>
        </li>
      ))}
    </ol>
  )
}
