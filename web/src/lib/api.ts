import type { Feature, LineString, MultiPolygon, Point, Polygon } from 'geojson'

export type BBox = [west: number, south: number, east: number, north: number]

export interface SatApp {
  id: string
  name: string
  partner: string
  category: string
  summary: string
  sensor: 'optical' | 'thermal'
  needs_daylight: boolean
  output: string
  latency_min: number
  price_eur_per_pass: number
}

export interface SearchQuery {
  place: string
  bbox: BBox
  date_from: string // YYYY-MM-DD, period of interest (reference imagery)
  date_to: string
  max_cloud: number
}

export interface InterpretResponse {
  intent: string
  app_id: string | null
  app_reason: string
  query: SearchQuery
  warnings: string[]
}

export interface SceneProps {
  datetime: string
  platform: string | null
  cloud_cover: number | null
  coverage: number // share of the area inside the footprint, 0..1
  tile: string | null
  thumbnail: string | null
  visual: string | null
  stac_url: string | null
}

export type Scene = Feature<Polygon | MultiPolygon, SceneProps> & {
  id: string
}

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
  fleet: string
  satellites: number // size of the fleet the passes were computed for
  reach_km: number
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

export const fetchApps = () => request<SatApp[]>('/api/apps')

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

/** Look-ahead for passes and orders: 14 YAM satellites give plenty of chances in 48 h. */
export const PASS_DAYS = 2

export function predictPasses(bbox: BBox, days = PASS_DAYS, signal?: AbortSignal) {
  const params = new URLSearchParams({
    bbox: bboxParam(bbox),
    days: String(days),
  })
  return request<PassesResponse>(`/api/passes?${params}`, { signal })
}

/** Absolute URL template: MapLibre loads tiles from a worker, which needs the origin. */
export const sceneTilesUrl = (sceneId: string) =>
  `${window.location.origin}/api/scenes/${sceneId}/tiles/{z}/{x}/{y}.webp`

/** A pass can run the app if the sensor works at that time (optical needs daylight). */
export const canRun = (app: SatApp, pass: Pass) => !app.needs_daylight || pass.daylight

// --- Marketplace: demo accounts, orders, usage ---------------------------------------------

export interface Account {
  id: string
  name: string
  licensed_apps: string[]
}

export interface OrderPass {
  satellite: string
  norad_id: number
  time: string
  state: 'scheduled' | 'consumed' | 'cancelled'
}

export interface Order {
  id: string
  app_id: string
  place: string
  bbox: BBox
  created_at: string
  cancelled_at: string | null
  status: 'active' | 'completed' | 'cancelled'
  passes: OrderPass[]
  usage: {
    passes_booked: number
    passes_consumed: number
    passes_remaining: number
    price_eur_per_pass: number
    billed_eur: number
    committed_eur: number
  }
}

// Demo stand-in for auth: the selected tenant travels in a header (an OIDC token in production).
let currentAccountId: string | null = null
export const setCurrentAccount = (id: string) => {
  currentAccountId = id
}
const accountHeaders = (): HeadersInit =>
  currentAccountId ? { 'X-Demo-Account': currentAccountId } : {}

export const fetchAccounts = () => request<Account[]>('/api/accounts')

export const listOrders = () => request<Order[]>('/api/orders', { headers: accountHeaders() })

export type Priority = 'standard' | 'priority'

export interface Quote {
  passes: number
  list_price_eur: number
  discount: number
  surcharge: number
  unit_price_eur: number
  total_eur: number
}

export function createOrder(body: {
  app_id: string
  place: string
  bbox: BBox
  days?: number
  pass_times?: string[] // only these passes; all usable ones if omitted
  priority?: Priority
}) {
  return request<Order & { quote: Quote }>('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...accountHeaders() },
    body: JSON.stringify(body),
  })
}

export const cancelOrder = (id: string) =>
  request<Order>(`/api/orders/${id}/cancel`, {
    method: 'POST',
    headers: accountHeaders(),
  })

// --- Previews of an app's output on a real image, and live satellites -----------------------

/** Apps whose output can be previewed with a ground-side baseline on public Sentinel-2 bands. */
export const PREVIEWABLE = new Set([
  'vessel-detection',
  'wildfire-detection',
  'flood-mapping',
  'crop-health',
])

export type PointProps =
  | { kind: 'vessel'; length_m: number; area_m2: number }
  | { kind: 'fire'; pixels: number; area_ha: number }

export interface Preview {
  scene_id: string
  datetime: string
  cloud_cover: number | null
  reference_id: string | null // the other date the result was compared with
  reference_datetime: string | null
  app_id: string
  window: BBox
  coverage: number
  pixel_m: number
  image?: string // data URL of a raster result, georeferenced on `window`
  features?: Feature<Point, PointProps>[]
  summary: Record<string, number | null>
}

/**
 * Runs the app's baseline on a real image: the given one (demo replays), or the clearest recent
 * image covering the area, picked by the API.
 */
export function runPreview(
  appId: string,
  bbox: BBox,
  images: { scene_id?: string | null; reference_id?: string | null } = {},
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ bbox: bboxParam(bbox) })
  if (images.scene_id) params.set('scene_id', images.scene_id)
  if (images.reference_id) params.set('reference_id', images.reference_id)
  return request<Preview>(`/api/preview/${appId}?${params}`, { signal })
}

export type FleetId = 'loft' | 'sentinel-2' | 'eo'

export interface SatelliteTle {
  name: string
  norad_id: number
  fleet: FleetId
  line1: string
  line2: string
}

export const fetchSatellites = () =>
  request<{ tle_age_hours: number; satellites: SatelliteTle[] }>('/api/satellites')

// --- Guided demos ------------------------------------------------------------------------------

export interface Demo {
  id: string
  title: string
  tagline: string
  account_id: string
  prompt: string
  intent: string
  app_id: string
  app_reason: string
  place: string
  bbox: BBox
  event_date: string | null // null: live, on the latest clear image
  scene_id: string | null
  reference_id: string | null
  story: string
  loft_case: string
  sources: { label: string; url: string }[]
  facts: string[]
}

export const fetchDemos = () => request<Demo[]>('/api/demos')

// --- Pricing: the server prices every order; the client shows the same quote -----------------

export interface PricingTerms {
  volume_tiers: { min_passes: number; discount: number }[]
  priority: Record<Priority, number>
}

export const fetchPricing = () => request<PricingTerms>('/api/pricing')

export function quote(app: SatApp, n: number, priority: Priority, terms: PricingTerms): Quote {
  const discount = Math.max(
    0,
    ...terms.volume_tiers.filter((t) => n >= t.min_passes).map((t) => t.discount),
  )
  const surcharge = terms.priority[priority] ?? 0
  const unit = Math.round(app.price_eur_per_pass * (1 - discount) * (1 + surcharge))
  return {
    passes: n,
    list_price_eur: app.price_eur_per_pass,
    discount,
    surcharge,
    unit_price_eur: unit,
    total_eur: unit * n,
  }
}

/** The next volume tier, to nudge: "2 more passes for -10%". */
export function nextTier(n: number, terms: PricingTerms) {
  return terms.volume_tiers.find((t) => t.min_passes > n) ?? null
}
