import { Orbit } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { MapView } from '@/components/MapView'
import { PassList } from '@/components/PassList'
import { QueryPanel } from '@/components/QueryPanel'
import { SceneList } from '@/components/SceneList'
import { SearchBar } from '@/components/SearchBar'
import { Toaster } from '@/components/ui/sonner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  type BBox,
  type Pass,
  type Scene,
  type SearchQuery,
  interpret,
  predictPasses,
  searchScenes,
} from '@/lib/api'

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'

export default function App() {
  const [interpreting, setInterpreting] = useState(false)
  const [intent, setIntent] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [query, setQuery] = useState<SearchQuery | null>(null)

  const [scenes, setScenes] = useState<Scene[]>([])
  const [matched, setMatched] = useState<number | null>(null)
  const [scenesLoading, setScenesLoading] = useState(false)
  const [passes, setPasses] = useState<Pass[]>([])
  const [passesLoading, setPassesLoading] = useState(false)
  const [tleAge, setTleAge] = useState<number | null>(null)
  const [scenesError, setScenesError] = useState<string | null>(null)
  const [passesError, setPassesError] = useState<string | null>(null)

  const [activeSceneId, setActiveSceneId] = useState<string | null>(null)
  const [activePass, setActivePass] = useState<number | null>(null)
  const [tab, setTab] = useState('scenes')

  // Scenes depend on the whole query; passes only on the area.
  useEffect(() => {
    if (!query) return
    const ctrl = new AbortController()
    setScenesLoading(true)
    setScenesError(null)
    setActiveSceneId(null)
    searchScenes(query, ctrl.signal)
      .then((r) => {
        setScenes(r.features)
        setMatched(r.matched)
      })
      .catch((e) => {
        if (isAbort(e)) return
        setScenes([])
        setScenesError(e.message)
      })
      .finally(() => !ctrl.signal.aborted && setScenesLoading(false))
    return () => ctrl.abort()
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

  const handleSearch = async (text: string) => {
    setInterpreting(true)
    try {
      const r = await interpret(text)
      setIntent(r.intent)
      setWarnings(r.warnings)
      setQuery(r.query)
      setTab('scenes')
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

  return (
    <div className="flex h-svh flex-col bg-background text-foreground md:flex-row">
      <aside className="flex min-h-0 flex-1 flex-col border-border md:w-[420px] md:flex-none md:border-r">
        <header className="space-y-3 border-b border-border p-4">
          <div className="flex items-center gap-2">
            <Orbit className="size-5 text-sky-400" />
            <h1 className="font-semibold tracking-tight">Orbit Finder</h1>
            <span className="text-xs text-muted-foreground">Sentinel-2 · demo</span>
          </div>
          <SearchBar loading={interpreting} onSubmit={handleSearch} />
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {query ? (
            <>
              <QueryPanel intent={intent} query={query} warnings={warnings} onChange={setQuery} />
              <Tabs
                value={tab}
                onValueChange={(v) => {
                  setTab(String(v))
                  setActiveSceneId(null)
                  setActivePass(null)
                }}
              >
                <TabsList className="w-full">
                  <TabsTrigger value="scenes">
                    Archive{!scenesLoading && ` (${scenes.length})`}
                  </TabsTrigger>
                  <TabsTrigger value="passes">
                    Next passes{!passesLoading && ` (${passes.filter((p) => p.daylight).length})`}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="scenes" className="pt-2">
                  <SceneList
                    scenes={scenes}
                    matched={matched}
                    loading={scenesLoading}
                    error={scenesError}
                    activeId={activeSceneId}
                    onSelect={(id) => setActiveSceneId((cur) => (cur === id ? null : id))}
                  />
                </TabsContent>
                <TabsContent value="passes" className="pt-2">
                  <PassList
                    passes={passes}
                    loading={passesLoading}
                    error={passesError}
                    tleAgeHours={tleAge}
                    activeIndex={activePass}
                    onSelect={setActivePass}
                  />
                </TabsContent>
              </Tabs>
            </>
          ) : (
            <Intro />
          )}
        </div>
      </aside>

      <main className="order-first h-[45svh] shrink-0 md:order-none md:h-auto md:flex-1">
        <MapView
          bbox={bbox}
          scenes={scenes}
          passes={passes}
          activeSceneId={activeSceneId}
          activePassIndex={activePass}
          onSceneClick={(id) => {
            setTab('scenes')
            setActiveSceneId(id)
          }}
          onSearchArea={handleSearchArea}
        />
      </main>
      <Toaster position="bottom-center" />
    </div>
  )
}

function Intro() {
  const steps = [
    ['Ask', 'Describe what you need in plain language, in English or French.'],
    ['Check', 'The AI turns it into a structured search you can edit: area, dates, clouds.'],
    ['Find', 'Browse matching Sentinel-2 images and see when satellites will pass next.'],
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
