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
import { type BBox, type Pass, type Preview, type Scene, sceneTilesUrl } from '@/lib/api'
import { useLiveSatellites } from '@/lib/live'

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
  live: '#a5f3fc',
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
  preview: Preview | null
  previewVisible: boolean
}

interface VesselPick {
  lon: number
  lat: number
  length_m: number
  area_m2: number
}

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
  activeSceneId,
  focusSceneId,
  activePassIndex,
  onSceneClick,
  onSearchArea,
  preview,
  previewVisible,
}: Props) {
  const mapRef = useRef<MapRef>(null)
  const [showLive, setShowLive] = useState(true)
  const live = useLiveSatellites(showLive)
  const [vessel, setVessel] = useState<VesselPick | null>(null)
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

  // Frame the analysed window when a preview result arrives.
  useEffect(() => {
    setVessel(null)
    if (preview) fitBox(preview.window, 40, 13)
  }, [preview])

  const vesselData = useMemo<FeatureCollection>(
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
        interactiveLayerIds={['scenes-fill', 'vessels']}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverId(null)}
        onClick={(e) => {
          const f = e.features?.[0]
          if (f?.layer.id === 'vessels' && f.geometry.type === 'Point') {
            const [lon, lat] = f.geometry.coordinates
            setVessel({
              lon,
              lat,
              length_m: f.properties.length_m,
              area_m2: f.properties.area_m2,
            })
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

        {preview && previewVisible && preview.scene_id !== activeSceneId && (
          // The image the preview ran on, under its result.
          <Source
            key={`preview-${preview.scene_id}`}
            id="preview-scene"
            type="raster"
            tiles={[sceneTilesUrl(preview.scene_id)]}
            tileSize={256}
            minzoom={8}
            maxzoom={14}
          >
            <Layer id="preview-scene" type="raster" beforeId="labels" />
          </Source>
        )}

        {preview?.image && previewVisible && (
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

        {preview?.features && previewVisible && (
          <Source id="vessels" type="geojson" data={vesselData}>
            <Layer
              id="vessels"
              type="circle"
              paint={{
                'circle-color': COLORS.vessel,
                'circle-radius': [
                  'interpolate',
                  ['linear'],
                  ['get', 'length_m'],
                  20,
                  4,
                  150,
                  7,
                  300,
                  10,
                ],
                'circle-opacity': 0.35,
                'circle-stroke-color': COLORS.vessel,
                'circle-stroke-width': 2,
              }}
            />
          </Source>
        )}

        {vessel && (
          <Popup
            longitude={vessel.lon}
            latitude={vessel.lat}
            onClose={() => setVessel(null)}
            closeButton={false}
            className="text-slate-900"
          >
            <p className="text-xs font-semibold">Vessel candidate</p>
            <p className="text-xs">
              ~{vessel.length_m} m long · {vessel.area_m2.toLocaleString('en')} m²
            </p>
            <p className="text-[11px] text-slate-500">
              {vessel.lat.toFixed(4)}°, {vessel.lon.toFixed(4)}°
            </p>
          </Popup>
        )}

        {showLive && (
          <Source id="live-tracks" type="geojson" data={live.tracks}>
            <Layer
              id="live-tracks"
              type="line"
              paint={{
                'line-color': COLORS.live,
                'line-width': 1.2,
                'line-opacity': 0.55,
                'line-dasharray': [1, 2],
              }}
            />
          </Source>
        )}

        {showLive &&
          live.sats.map((s) => (
            <Marker key={s.norad_id} longitude={s.lon} latitude={s.lat} anchor="center">
              <button
                type="button"
                title={`${s.name} · ${Math.round(s.alt_km)} km · ${s.speed_kms.toFixed(1)} km/s`}
                onClick={() =>
                  mapRef.current?.flyTo({
                    center: [s.lon, s.lat],
                    zoom: 5,
                    duration: 1200,
                  })
                }
                className="group flex items-center gap-1"
              >
                <span className="relative flex size-3.5 items-center justify-center">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-cyan-200/60" />
                  <span className="relative size-2.5 rounded-full border border-white bg-cyan-300" />
                </span>
                <span className="rounded bg-black/60 px-1 text-[10px] font-medium text-cyan-100 backdrop-blur">
                  {s.name.replace('SENTINEL-', 'S')}
                </span>
              </button>
            </Marker>
          ))}

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

      <Button
        size="sm"
        variant={showLive ? 'secondary' : 'outline'}
        onClick={() => setShowLive(!showLive)}
        className="absolute top-3 right-3 shadow-lg"
        title="Positions propagated live from the satellites' TLEs (SGP4)"
      >
        <Satellite />
        {showLive ? `Live: ${live.sats.length} satellites` : 'Show live satellites'}
      </Button>

      <Legend vessels={!!preview?.features && previewVisible} />
    </div>
  )
}

function Legend({ vessels }: { vessels: boolean }) {
  const items = [
    { color: COLORS.live, label: 'Sentinel-2, live, next 50 min' },
    { color: COLORS.area, label: 'Area of interest' },
    { color: COLORS.sceneActive, label: 'Reference image' },
    { color: COLORS.passOk, label: 'Pass that can run the app' },
    { color: COLORS.passNo, label: 'Pass that can’t' },
    ...(vessels ? [{ color: COLORS.vessel, label: 'Vessel detected (preview)' }] : []),
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
