import type { FeatureCollection, Position } from 'geojson'
import { useEffect, useMemo, useState } from 'react'
import {
  degreesLat,
  degreesLong,
  eciToGeodetic,
  gstime,
  propagate,
  type SatRec,
  twoline2satrec,
} from 'satellite.js'

import { fetchSatellites, type FleetId } from './api'

export interface LiveSat {
  name: string
  norad_id: number
  fleet: FleetId
  lon: number
  lat: number
  alt_km: number
  speed_kms: number
}

const TRACK_AHEAD_MIN = 50 // about half an orbit: where the satellite is heading
const TRACK_STEP_S = 30

function subpoint(rec: SatRec, at: Date) {
  const pv = propagate(rec, at)
  if (!pv || typeof pv.position === 'boolean' || typeof pv.velocity === 'boolean') return null
  const geo = eciToGeodetic(pv.position, gstime(at))
  const v = pv.velocity
  return {
    lon: degreesLong(geo.longitude),
    lat: degreesLat(geo.latitude),
    alt_km: geo.height,
    speed_kms: Math.hypot(v.x, v.y, v.z),
  }
}

/** Split a ground track where it crosses the antimeridian so it isn't drawn across the map. */
function splitAtAntimeridian(points: Position[]): Position[][] {
  const lines: Position[][] = [[]]
  for (const p of points) {
    const line = lines[lines.length - 1]
    const prev = line[line.length - 1]
    if (prev && Math.abs(p[0] - prev[0]) > 180) lines.push([p])
    else line.push(p)
  }
  return lines.filter((l) => l.length > 1)
}

/**
 * Live positions of the fleets (Loft's YAMs, Sentinel-2, other Earth observation), propagated in the browser with SGP4 from the TLEs the
 * API serves (same source as pass predictions). Updates every second; tracks every minute.
 */
export function useLiveSatellites(enabled: boolean) {
  const [recs, setRecs] = useState<
    { name: string; norad_id: number; fleet: FleetId; rec: SatRec }[]
  >([])
  const [now, setNow] = useState(() => new Date())
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled || recs.length) return
    fetchSatellites()
      .then((r) =>
        setRecs(
          r.satellites.map((s) => ({
            name: s.name,
            norad_id: s.norad_id,
            fleet: s.fleet,
            rec: twoline2satrec(s.line1, s.line2),
          })),
        ),
      )
      .catch((e) => setError(e.message))
  }, [enabled, recs.length])

  useEffect(() => {
    if (!enabled) return
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [enabled])

  const sats = useMemo<LiveSat[]>(
    () =>
      recs.flatMap(({ name, norad_id, fleet, rec }) => {
        const p = subpoint(rec, now)
        return p ? [{ name, norad_id, fleet, ...p }] : []
      }),
    [recs, now],
  )

  const minute = Math.floor(now.getTime() / 60_000)
  const tracks = useMemo<FeatureCollection>(() => {
    const start = minute * 60_000
    return {
      type: 'FeatureCollection',
      // Only Loft's fleet: 180 tracks would hide the map.
      features: recs.flatMap(({ name, fleet, rec }) => {
        if (fleet !== 'loft') return []
        const pts: Position[] = []
        for (let s = 0; s <= TRACK_AHEAD_MIN * 60; s += TRACK_STEP_S) {
          const p = subpoint(rec, new Date(start + s * 1000))
          if (p) pts.push([p.lon, p.lat])
        }
        return splitAtAntimeridian(pts).map((coordinates) => ({
          type: 'Feature' as const,
          properties: { name },
          geometry: { type: 'LineString' as const, coordinates },
        }))
      }),
    }
  }, [recs, minute])

  return { sats, tracks, error }
}
