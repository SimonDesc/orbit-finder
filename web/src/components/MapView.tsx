import 'maplibre-gl/dist/maplibre-gl.css'

import type { FeatureCollection } from 'geojson'
import { setWorkerUrl } from 'maplibre-gl'
// MapLibre v6 locates its worker relative to its own module URL, which breaks once Vite
// bundles it: point it to the worker file explicitly so it is emitted as an asset.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { ScanSearch } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import Map, {
  Layer,
  type MapLayerMouseEvent,
  type MapRef,
  NavigationControl,
  Source,
  type ViewStateChangeEvent,
} from 'react-map-gl/maplibre'

import { Button } from '@/components/ui/button'
import type { BBox, Pass, Scene } from '@/lib/api'

setWorkerUrl(workerUrl)

// Free vector basemap, no API key needed.
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/dark'

const COLORS = {
  area: '#38bdf8',
  scene: '#a78bfa',
  sceneActive: '#f0abfc',
  passDay: '#fbbf24',
  passNight: '#64748b',
}

interface Props {
  bbox: BBox | null
  scenes: Scene[]
  passes: Pass[]
  activeSceneId: string | null
  activePassIndex: number | null
  onSceneClick: (id: string) => void
  onSearchArea: (bbox: BBox) => void
}

const bboxPolygon = ([w, s, e, n]: BBox): FeatureCollection => ({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
      },
    },
  ],
})

export function MapView({
  bbox,
  scenes,
  passes,
  activeSceneId,
  activePassIndex,
  onSceneClick,
  onSearchArea,
}: Props) {
  const mapRef = useRef<MapRef>(null)
  const [movedByUser, setMovedByUser] = useState(false)
  const [hoverId, setHoverId] = useState<string | null>(null)

  // Frame the search area whenever it changes.
  useEffect(() => {
    if (!bbox) return
    mapRef.current?.fitBounds(
      [
        [bbox[0], bbox[1]],
        [bbox[2], bbox[3]],
      ],
      { padding: 80, duration: 900, maxZoom: 11 },
    )
    setMovedByUser(false)
  }, [bbox])

  // A selected pass is shown against the search area it crosses.
  useEffect(() => {
    if (activePassIndex == null || !bbox) return
    mapRef.current?.fitBounds(
      [
        [bbox[0], bbox[1]],
        [bbox[2], bbox[3]],
      ],
      { padding: 120, duration: 700, maxZoom: 9 },
    )
  }, [activePassIndex, bbox])

  // Bring the selected scene into view.
  useEffect(() => {
    const scene = scenes.find((s) => s.id === activeSceneId)
    if (!scene) return
    const g = scene.geometry
    const coords = g.type === 'Polygon' ? g.coordinates.flat() : g.coordinates.flat(2)
    const lons = coords.map((c) => c[0])
    const lats = coords.map((c) => c[1])
    mapRef.current?.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      { padding: 60, duration: 700 },
    )
  }, [activeSceneId, scenes])

  const sceneData = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: scenes.map((s) => ({ ...s, properties: { ...s.properties, sid: s.id } })),
    }),
    [scenes],
  )

  const passData = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: passes.map((p, i) => ({
        type: 'Feature',
        properties: { i, daylight: p.daylight },
        geometry: p.ground_track,
      })),
    }),
    [passes],
  )

  const highlighted = activeSceneId ?? hoverId ?? ''

  const handleMove = (e: MapLayerMouseEvent) => {
    const id = e.features?.[0]?.properties?.sid as string | undefined
    setHoverId(id ?? null)
  }

  const searchHere = () => {
    const b = mapRef.current?.getBounds()
    if (!b) return
    onSearchArea([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((v) => +v.toFixed(5)) as BBox)
    setMovedByUser(false)
  }

  return (
    <div className="relative h-full w-full">
      <Map
        ref={mapRef}
        mapStyle={MAP_STYLE}
        initialViewState={{ longitude: 1.44, latitude: 43.6, zoom: 5 }}
        interactiveLayerIds={['scenes-fill']}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverId(null)}
        onClick={(e) => {
          const id = e.features?.[0]?.properties?.sid as string | undefined
          if (id) onSceneClick(id)
        }}
        onMoveEnd={(e: ViewStateChangeEvent) => {
          if (e.originalEvent) setMovedByUser(true)
        }}
        cursor={hoverId ? 'pointer' : 'grab'}
        attributionControl={{ compact: true }}
      >
        <NavigationControl position="bottom-right" showCompass={false} />

        <Source id="passes" type="geojson" data={passData}>
          <Layer
            id="passes-line"
            type="line"
            layout={{ 'line-cap': 'round' }}
            paint={{
              'line-color': ['case', ['get', 'daylight'], COLORS.passDay, COLORS.passNight],
              'line-width': ['case', ['==', ['get', 'i'], activePassIndex ?? -1], 4, 1.5],
              'line-opacity': ['case', ['==', ['get', 'i'], activePassIndex ?? -1], 1, 0.55],
              'line-dasharray': [2, 1.5],
            }}
          />
        </Source>

        <Source id="scenes" type="geojson" data={sceneData}>
          <Layer
            id="scenes-fill"
            type="fill"
            paint={{
              'fill-color': [
                'case',
                ['==', ['get', 'sid'], highlighted],
                COLORS.sceneActive,
                COLORS.scene,
              ],
              'fill-opacity': ['case', ['==', ['get', 'sid'], highlighted], 0.3, 0],
            }}
          />
          <Layer
            id="scenes-line"
            type="line"
            paint={{
              'line-color': [
                'case',
                ['==', ['get', 'sid'], highlighted],
                COLORS.sceneActive,
                COLORS.scene,
              ],
              'line-width': ['case', ['==', ['get', 'sid'], highlighted], 2, 0.6],
              'line-opacity': 0.8,
            }}
          />
        </Source>

        {bbox && (
          <Source id="area" type="geojson" data={bboxPolygon(bbox)}>
            <Layer
              id="area-fill"
              type="fill"
              paint={{ 'fill-color': COLORS.area, 'fill-opacity': 0.08 }}
            />
            <Layer
              id="area-line"
              type="line"
              paint={{ 'line-color': COLORS.area, 'line-width': 2, 'line-dasharray': [3, 2] }}
            />
          </Source>
        )}
      </Map>

      {movedByUser && bbox && (
        <Button
          onClick={searchHere}
          variant="secondary"
          className="absolute top-3 left-1/2 -translate-x-1/2 shadow-lg"
        >
          <ScanSearch />
          Search this area
        </Button>
      )}

      <Legend />
    </div>
  )
}

function Legend() {
  const items = [
    { color: COLORS.area, label: 'Search area' },
    { color: COLORS.scene, label: 'Sentinel-2 scene' },
    { color: COLORS.passDay, label: 'Day pass' },
    { color: COLORS.passNight, label: 'Night pass' },
  ]
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 hidden gap-3 rounded-lg bg-background/80 px-2.5 py-1.5 text-xs text-muted-foreground backdrop-blur sm:flex">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  )
}
