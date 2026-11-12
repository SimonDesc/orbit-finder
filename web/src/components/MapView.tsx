import 'maplibre-gl/dist/maplibre-gl.css'

import type { FeatureCollection } from 'geojson'
import { type ExpressionSpecification, setWorkerUrl, type StyleSpecification } from 'maplibre-gl'
// MapLibre v6 locates its worker relative to its own module URL, which breaks once Vite
// bundles it: point it to the worker file explicitly so it is emitted as an asset.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { Satellite, ScanSearch } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import Map, {
  Layer,
  type MapLayerMouseEvent,
  type MapRef,
  Marker,
  NavigationControl,
  Popup,
  Source,
  type ViewStateChangeEvent,
} from 'react-map-gl/maplibre'

import { Button } from '@/components/ui/button'
import {
  type BBox,
  type FleetId,
  type Pass,
  type PointProps,
  type Preview,
  type Scene,
  sceneTilesUrl,
} from '@/lib/api'
import { type LiveSat, useLiveSatellites } from '@/lib/live'
import { cn } from '@/lib/utils'

import { Hint } from './Hint'
import type { Compare } from './PreviewCard'

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
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [
    { id: 'mosaic', type: 'raster', source: 'mosaic' },
    {
      id: 'labels',
      type: 'raster',
      source: 'labels',
      paint: { 'raster-opacity': 0.85 },
    },
  ],
}

const COLORS = {
  area: '#38bdf8',
  scene: '#ffffff',
  sceneActive: '#f0abfc',
  passOk: '#fbbf24',
  passNo: '#94a3b8',
  vessel: '#f472b6',
  fire: '#fb923c',
  loft: '#fdba74',
  sentinel: '#a5f3fc',
  eo: '#e2e8f0',
}

const FLEETS: { id: FleetId; short: string; label: string; color: string }[] = [
  { id: 'loft', short: 'Loft', label: 'Loft Orbital YAM: the apps run onboard', color: COLORS.loft },
  { id: 'sentinel-2', short: 'S2', label: 'Sentinel-2: reference images', color: COLORS.sentinel },
  { id: 'eo', short: 'EO', label: 'Other Earth-observation satellites', color: COLORS.eo },
]

interface Props {
  bbox: BBox | null
  scenes: Scene[]
  passes: Pass[]
  usablePasses: boolean[]
  selectedPasses: boolean[]
  activeSceneId: string | null
  focusSceneId: string | null
  activePassIndex: number | null
  onSceneClick: (id: string) => void
  onSearchArea: (bbox: BBox) => void
  preview: Preview | null
  previewVisible: boolean
  compare: Compare
}

type PointPick = { lon: number; lat: number } & PointProps

const bboxPolygon = ([w, s, e, n]: BBox): FeatureCollection => ({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [w, s],
            [e, s],
            [e, n],
            [w, n],
            [w, s],
          ],
        ],
      },
    },
  ],
})

export function MapView({
  bbox,
  scenes,
  passes,
  usablePasses,
  selectedPasses,
  activeSceneId,
  focusSceneId,
  activePassIndex,
  onSceneClick,
  onSearchArea,
  preview,
  previewVisible,
  compare,
}: Props) {
  const mapRef = useRef<MapRef>(null)
  const [showLive, setShowLive] = useState(true)
  const live = useLiveSatellites(showLive)
  const [fleets, setFleets] = useState<Record<FleetId, boolean>>({
    loft: true,
    'sentinel-2': true,
    eo: true,
  })
  const [pick, setPick] = useState<PointPick | null>(null)
  const [satPick, setSatPick] = useState<LiveSat | null>(null)
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

  // Frame the analysed window when a preview result arrives.
  useEffect(() => {
    setPick(null)
    if (preview) fitBox(preview.window, 40, 13)
  }, [preview])

  const labelled = live.sats.filter((s) => s.fleet !== 'eo' && fleets[s.fleet])
  const eoData = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: fleets.eo
        ? live.sats
            .filter((s) => s.fleet === 'eo')
            .map((s) => ({
              type: 'Feature' as const,
              properties: { norad_id: s.norad_id },
              geometry: { type: 'Point' as const, coordinates: [s.lon, s.lat] },
            }))
        : [],
    }),
    [live.sats, fleets.eo],
  )
  const counts = useMemo(() => {
    const c: Record<FleetId, number> = { loft: 0, 'sentinel-2': 0, eo: 0 }
    for (const s of live.sats) c[s.fleet] += 1
    return c
  }, [live.sats])

  // Before/after: the reference date replaces the result and the image it ran on.
  const showResult = previewVisible && compare === 'after'
  const shownScene =
    preview && previewVisible
      ? compare === 'before' && preview.reference_id
        ? preview.reference_id
        : preview.scene_id
      : null

  const pointData = useMemo<FeatureCollection>(
    () => ({ type: 'FeatureCollection', features: preview?.features ?? [] }),
    [preview],
  )

  const sceneData = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: scenes.map((s) => ({
        ...s,
        properties: { ...s.properties, sid: s.id },
      })),
    }),
    [scenes],
  )

  const passData = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: passes.map((p, i) => ({
        type: 'Feature',
        properties: { i, ok: usablePasses[i] ?? false, sel: selectedPasses[i] ?? false },
        geometry: p.ground_track,
      })),
    }),
    [passes, usablePasses, selectedPasses],
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
        initialViewState={{ longitude: 2.4, latitude: 44, zoom: 3.2 }}
        interactiveLayerIds={['scenes-fill', 'points', 'eo-sats']}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverId(null)}
        onClick={(e) => {
          const f = e.features?.[0]
          if (f?.layer.id === 'points' && f.geometry.type === 'Point') {
            const [lon, lat] = f.geometry.coordinates
            setPick({ lon, lat, ...(f.properties as PointProps) })
            return
          }
          if (f?.layer.id === 'eo-sats') {
            setSatPick(live.sats.find((s) => s.norad_id === f.properties.norad_id) ?? null)
            return
          }
          const id = f?.properties?.sid as string | undefined
          if (id) onSceneClick(id)
        }}
        onMoveEnd={(e: ViewStateChangeEvent) => {
          if (e.originalEvent) setMovedByUser(true)
        }}
        cursor={hoverId ? 'pointer' : 'grab'}
        attributionControl={{ compact: true }}
        // The compact credits start expanded on wide maps and hide the legend: fold them.
        onLoad={(e) =>
          e.target
            .getContainer()
            .querySelector('.maplibregl-ctrl-attrib')
            ?.classList.remove('maplibregl-compact-show')
        }
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
              'line-width': [
                'case',
                ['==', ['get', 'i'], activePassIndex ?? -1],
                5,
                ['get', 'sel'],
                2.5,
                1.2,
              ],
              'line-opacity': [
                'case',
                ['==', ['get', 'i'], activePassIndex ?? -1],
                1,
                ['get', 'sel'],
                0.9,
                0.3,
              ],
              'line-dasharray': [2, 1.5],
            }}
          />
        </Source>

        {shownScene && shownScene !== activeSceneId && (
          // The image the preview ran on (or its reference date), under the result.
          <Source
            key={`preview-${shownScene}`}
            id="preview-scene"
            type="raster"
            tiles={[sceneTilesUrl(shownScene)]}
            tileSize={256}
            minzoom={8}
            maxzoom={14}
          >
            <Layer id="preview-scene" type="raster" beforeId="labels" />
          </Source>
        )}

        {preview?.image && showResult && (
          <Source
            key={`${preview.scene_id}-${preview.app_id}-${preview.window.join()}`}
            id="preview-image"
            type="image"
            url={preview.image}
            coordinates={[
              [preview.window[0], preview.window[3]],
              [preview.window[2], preview.window[3]],
              [preview.window[2], preview.window[1]],
              [preview.window[0], preview.window[1]],
            ]}
          >
            <Layer id="preview-image" type="raster" beforeId="labels" />
          </Source>
        )}

        {preview?.features && showResult && (
          <Source id="points" type="geojson" data={pointData}>
            <Layer
              id="points"
              type="circle"
              paint={{
                'circle-color': ['match', ['get', 'kind'], 'fire', COLORS.fire, COLORS.vessel],
                'circle-radius': [
                  'case',
                  ['==', ['get', 'kind'], 'fire'],
                  ['interpolate', ['linear'], ['get', 'pixels'], 1, 3, 50, 7, 500, 14],
                  ['interpolate', ['linear'], ['get', 'length_m'], 20, 4, 150, 7, 300, 10],
                ],
                'circle-opacity': 0.35,
                'circle-stroke-color': [
                  'match',
                  ['get', 'kind'],
                  'fire',
                  '#fef08a',
                  COLORS.vessel,
                ],
                'circle-stroke-width': ['match', ['get', 'kind'], 'fire', 1, 2],
              }}
            />
          </Source>
        )}

        {pick && (
          <Popup
            longitude={pick.lon}
            latitude={pick.lat}
            onClose={() => setPick(null)}
            closeButton={false}
            className="text-slate-900"
          >
            {pick.kind === 'fire' ? (
              <>
                <p className="text-xs font-semibold">Active fire hotspot</p>
                <p className="text-xs">
                  {pick.pixels} burning pixel{pick.pixels > 1 ? 's' : ''} · ~{pick.area_ha} ha
                </p>
              </>
            ) : (
              <>
                <p className="text-xs font-semibold">Vessel candidate</p>
                <p className="text-xs">
                  ~{pick.length_m} m long · {pick.area_m2.toLocaleString('en')} m²
                </p>
              </>
            )}
            <p className="text-[11px] text-slate-500">
              {pick.lat.toFixed(4)}°, {pick.lon.toFixed(4)}°
            </p>
          </Popup>
        )}

        {showLive && fleets.loft && (
          <Source id="live-tracks" type="geojson" data={live.tracks}>
            <Layer
              id="live-tracks"
              type="line"
              paint={{
                'line-color': COLORS.loft,
                'line-width': 1.1,
                'line-opacity': 0.45,
                'line-dasharray': [1, 2],
              }}
            />
          </Source>
        )}

        {showLive && (
          <Source id="eo-sats" type="geojson" data={eoData}>
            <Layer
              id="eo-sats"
              type="circle"
              paint={{
                'circle-color': COLORS.eo,
                'circle-radius': 2.5,
                'circle-opacity': 0.75,
                'circle-stroke-color': '#0f172a',
                'circle-stroke-width': 0.5,
              }}
            />
          </Source>
        )}

        {satPick && (
          <Popup
            longitude={satPick.lon}
            latitude={satPick.lat}
            onClose={() => setSatPick(null)}
            closeButton={false}
            className="text-slate-900"
          >
            <p className="text-xs font-semibold">{satPick.name}</p>
            <p className="text-xs">
              {Math.round(satPick.alt_km)} km · {satPick.speed_kms.toFixed(1)} km/s
            </p>
          </Popup>
        )}

        {showLive &&
          labelled.map((s) => {
            const loft = s.fleet === 'loft'
            return (
              <Marker key={s.norad_id} longitude={s.lon} latitude={s.lat} anchor="center">
                <button
                  type="button"
                  title={`${s.name} · ${Math.round(s.alt_km)} km · ${s.speed_kms.toFixed(1)} km/s`}
                  onClick={() =>
                    mapRef.current?.flyTo({ center: [s.lon, s.lat], zoom: 5, duration: 1200 })
                  }
                  className="flex items-center gap-1"
                >
                  <span className="relative flex size-3.5 items-center justify-center">
                    {loft && (
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-orange-300/60" />
                    )}
                    <span
                      className={
                        loft
                          ? 'relative size-2.5 rounded-full border border-white bg-orange-300'
                          : 'relative size-2 rounded-full border border-white bg-cyan-300'
                      }
                    />
                  </span>
                  <span
                    className={
                      loft
                        ? 'rounded bg-black/65 px-1 text-[10px] font-semibold text-orange-100 backdrop-blur'
                        : 'rounded bg-black/55 px-1 text-[10px] text-cyan-100 backdrop-blur'
                    }
                  >
                    {s.name.replace('SENTINEL-', 'S')}
                  </span>
                </button>
              </Marker>
            )
          })}

        {bbox && (
          <Source id="area" type="geojson" data={bboxPolygon(bbox)}>
            <Layer
              id="area-line"
              type="line"
              paint={{
                'line-color': COLORS.area,
                'line-width': 2.5,
                'line-dasharray': [3, 2],
              }}
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

      <div className="absolute bottom-3 left-3 hidden items-center gap-1 rounded-full border border-border bg-background/80 p-1 text-xs text-white/90 backdrop-blur md:flex">
        <button
          type="button"
          onClick={() => setShowLive(!showLive)}
          aria-pressed={showLive}
          title={showLive ? 'Hide live satellites' : 'Show live satellites'}
          className={cn(
            'flex size-6 items-center justify-center rounded-full transition-colors',
            showLive ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white',
          )}
        >
          <Satellite className="size-3.5" />
        </button>
        {showLive &&
          FLEETS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={fleets[f.id]}
              title={f.label}
              onClick={() => setFleets({ ...fleets, [f.id]: !fleets[f.id] })}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-2 py-1 transition-opacity',
                !fleets[f.id] && 'opacity-40',
              )}
            >
              <span className="size-2 rounded-full" style={{ background: f.color }} />
              {f.short}
              <span className="text-white/55 tabular-nums">{counts[f.id]}</span>
            </button>
          ))}
        <span className="px-1">
          <Hint label="Map legend" className="text-white/60 hover:text-white">
            <Legend points={showResult ? (preview?.app_id ?? null) : null} />
          </Hint>
        </span>
      </div>
    </div>
  )
}

function Legend({ points }: { points: string | null }) {
  const items = [
    { color: COLORS.area, label: 'Area of interest' },
    { color: COLORS.sceneActive, label: 'Reference image' },
    { color: COLORS.passOk, label: 'Selected pass (faint: not selected)' },
    { color: COLORS.passNo, label: 'Pass that can’t run the app' },
    ...(points === 'vessel-detection' ? [{ color: COLORS.vessel, label: 'Vessel detected' }] : []),
    ...(points === 'wildfire-detection' ? [{ color: COLORS.fire, label: 'Fire hotspot' }] : []),
  ]
  return (
    <div className="flex flex-col gap-1">
      <p>Satellites move live, from public orbits (SGP4). Loft’s dashed lines: the next 50 min.</p>
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  )
}
