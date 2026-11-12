import type { Feature, LineString, MultiPolygon, Polygon } from 'geojson'

export type BBox = [west: number, south: number, east: number, north: number]
export type Sensor = 'optical' | 'radar' | 'any'

export interface SearchQuery {
  place: string
  bbox: BBox
  date_from: string // YYYY-MM-DD
  date_to: string
  sensor: Sensor
  max_cloud: number
}

export interface InterpretResponse {
  intent: string
  query: SearchQuery
  warnings: string[]
}

export interface SceneProps {
  datetime: string
  platform: string | null
  cloud_cover: number | null
  tile: string | null
  thumbnail: string | null
  visual: string | null
  stac_url: string | null
}

export type Scene = Feature<Polygon | MultiPolygon, SceneProps> & { id: string }

export interface ScenesResponse {
  type: 'FeatureCollection'
  features: Scene[]
  matched: number | null
}

export interface Pass {
  satellite: string
  norad_id: number
  time: string
  offset_km: number
  direction: 'ascending' | 'descending'
  sun_elevation: number
  daylight: boolean
  ground_track: LineString
}

export interface PassesResponse {
  from: string
  days: number
  tle_age_hours: number
  passes: Pass[]
}

export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (typeof body.detail === 'string') message = body.detail
      else if (Array.isArray(body.detail)) message = body.detail[0]?.msg ?? message
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(message, res.status)
  }
  return res.json() as Promise<T>
}

export function interpret(text: string, signal?: AbortSignal) {
  return request<InterpretResponse>('/api/interpret', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal,
  })
}

const bboxParam = (b: BBox) => b.map((v) => v.toFixed(5)).join(',')

export function searchScenes(q: SearchQuery, signal?: AbortSignal) {
  const params = new URLSearchParams({
    bbox: bboxParam(q.bbox),
    date_from: q.date_from,
    date_to: q.date_to,
    max_cloud: String(q.max_cloud),
    limit: '50',
  })
  return request<ScenesResponse>(`/api/scenes?${params}`, { signal })
}

export function predictPasses(bbox: BBox, days = 5, signal?: AbortSignal) {
  const params = new URLSearchParams({ bbox: bboxParam(bbox), days: String(days) })
  return request<PassesResponse>(`/api/passes?${params}`, { signal })
}
