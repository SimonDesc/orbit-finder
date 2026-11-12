import 'maplibre-gl/dist/maplibre-gl.css'

import type { FeatureCollection } from 'geojson'
import { type ExpressionSpecification, setWorkerUrl, type StyleSpecification } from 'maplibre-gl'
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
import { type BBox, type Pass, type Scene, sceneTilesUrl } from '@/lib/api'

setWorkerUrl(workerUrl)

const EOX = 'https://tiles.maps.eox.at/wmts/1.0.0'

// Cloud-free Sentinel-2 mosaic of the whole planet (EOX), with OpenStreetMap labels on top.
const MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    mosaic: {
      type: 'raster',
      tiles: [`${EOX}/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg`],
      tileSize: 256,
      maxzoom: 15,
      attribution:
        '<a href="https://s2maps.eu" target="_blank">Sentinel-2 cloudless 2024</a> by EOX IT ' +
        'Services GmbH (contains modified Copernicus Sentinel data 2024)',
    },
    labels: {
      type: 'raster',
      tiles: [`${EOX}/overlay_bright_3857/default/g/{z}/{y}/{x}.png`],
      tileSize: 256,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [
    { id: 'mosaic', type: 'raster', source: 'mosaic' },
    { id: 'labels', type: 'raster', source: 'labels', paint: { 'raster-opacity': 0.85 } },
  ],
}

const COLORS = {
  area: '#38bdf8',
  scene: '#ffffff',
  sceneActive: '#f0abfc',
  passOk: '#fbbf24',
  passNo: '#94a3b8',
}

interface Props {
  bbox: BBox | null
  scenes: Scene[]
  passes: Pass[]
  usablePasses: boolean[]
  activeSceneId: string | null
  focusSceneId: string | null
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
  usablePasses,
  activeSceneId,
  focusSceneId,
  activePassIndex,
  onSceneClick,
  onSearchArea,
}: Props) {
  const mapRef = useRef<MapRef>(null)
  const [movedByUser, setMovedByUser] = useState(false)
  const [hoverId, setHoverId] = useState<string | null>(null)

  const fitBox = (b: BBox, padding: number, maxZoom: number) =>
    mapRef.current?.fitBounds(
      [
        [b[0], b[1]],
        [b[2], b[3]],
      ],
      { padding, duration: 900, maxZoom },
    )

  // Frame the search area whenever it changes, and when a pass is selected.
  useEffect(() => {
    if (!bbox) return
    fitBox(bbox, 60, 11)
    setMovedByUser(false)
  }, [bbox])

  useEffect(() => {
    if (activePassIndex != null && bbox) fitBox(bbox, 120, 9)
  }, [activePassIndex, bbox])

  // Only an explicit click on a scene moves the map to it.
  useEffect(() => {
    const scene = scenes.find((s) => s.id === focusSceneId)
    if (!scene) return
    const g = scene.geometry
    const coords = g.type === 'Polygon' ? g.coordinates.flat() : g.coordinates.flat(2)
    const lons = coords.map((c) => c[0])
    const lats = coords.map((c) => c[1])
    fitBox([Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)], 40, 12)
  }, [focusSceneId, scenes])

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
        properties: { i, ok: usablePasses[i] ?? false },
        geometry: p.ground_track,
      })),
    }),
    [passes, usablePasses],
  )

  const highlighted = hoverId ?? activeSceneId ?? ''
  const isActive: ExpressionSpecification = ['==', ['get', 'sid'], highlighted]

  const handleMove = (e: MapLayerMouseEvent) =>
    setHoverId((e.features?.[0]?.properties?.sid as string | undefined) ?? null)

  const searchHere = () => {
    const b = mapRef.current?.getBounds()
    if (!b) return
    onSearchArea(
      [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((v) => +v.toFixed(5)) as BBox,
    )
    setMovedByUser(false)
  }

  return (
    <div className="relative h-full w-full">
      <Map
        ref={mapRef}
        mapStyle={MAP_STYLE}
        initialViewState={{ longitude: 2.4, latitude: 46.4, zoom: 5 }}
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

        {activeSceneId && (
          // Selected archive image, rendered from its full-resolution COG by our API.
          <Source
            key={activeSceneId}
            id="scene-image"
            type="raster"
            tiles={[sceneTilesUrl(activeSceneId)]}
            tileSize={256}
            minzoom={8}
            maxzoom={14}
          >
            <Layer id="scene-image" type="raster" beforeId="labels" />
          </Source>
        )}

        <Source id="scenes" type="geojson" data={sceneData}>
          <Layer
            id="scenes-fill"
            type="fill"
            beforeId="labels"
            paint={{ 'fill-color': COLORS.sceneActive, 'fill-opacity': 0 }}
          />
          <Layer
            id="scenes-line"
            type="line"
            paint={{
              'line-color': ['case', isActive, COLORS.sceneActive, COLORS.scene],
              'line-width': ['case', isActive, 2.5, 0.8],
              'line-opacity': ['case', isActive, 1, 0.45],
            }}
          />
        </Source>

        <Source id="passes" type="geojson" data={passData}>
          <Layer
            id="passes-line"
            type="line"
            layout={{ 'line-cap': 'round' }}
            paint={{
              'line-color': ['case', ['get', 'ok'], COLORS.passOk, COLORS.passNo],
              'line-width': ['case', ['==', ['get', 'i'], activePassIndex ?? -1], 5, 2],
              'line-opacity': ['case', ['==', ['get', 'i'], activePassIndex ?? -1], 1, 0.7],
              'line-dasharray': [2, 1.5],
            }}
          />
        </Source>

        {bbox && (
          <Source id="area" type="geojson" data={bboxPolygon(bbox)}>
            <Layer
              id="area-line"
              type="line"
              paint={{ 'line-color': COLORS.area, 'line-width': 2.5, 'line-dasharray': [3, 2] }}
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
    { color: COLORS.area, label: 'Area of interest' },
    { color: COLORS.sceneActive, label: 'Reference image' },
    { color: COLORS.passOk, label: 'Pass that can run the app' },
    { color: COLORS.passNo, label: 'Pass that can’t' },
  ]
  return (
    <div className="pointer-events-none absolute top-3 left-3 hidden flex-col gap-1 rounded-lg bg-black/60 px-2.5 py-2 text-xs text-white/85 backdrop-blur lg:flex">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  )
}
