# Orbit Finder

**The customer side of an AI app store for satellites.** A port authority, a fire service or a
civil-protection agency describes what it needs to know; Orbit Finder picks the onboard AI app
that answers it, shows when one of Loft Orbital's YAM satellites can run it over the area, shows
what the app delivers on a real Sentinel-2 image, then books, prices and meters the mission.

**Live demo: https://orbit-finder.92.113.26.165.sslip.io** · API docs: [`/docs`](https://orbit-finder.92.113.26.165.sslip.io/docs)

Built in three days as a take-home for the *Full Stack Engineer – AI Marketplace* role at Loft
Orbital (Toulouse).

---

## The idea

Loft Orbital flies shared satellites and lets third parties run software on them. Once AI apps run
onboard, the satellite no longer sends images down: it sends *answers* (a ship count, a fire
alert, a flood map) minutes after the pass. That changes who the buyer is. A port authority doesn't
want imagery, tasking windows or ground-station slots; it wants "how many ships are waiting at
anchor, every day".

So the hard product question is the customer's: **"I have a question about a place. Which app
answers it, when, what exactly do I get, and what will it cost?"** Orbit Finder is an answer to
that question, end to end:

1. **Ask.** A request in plain language, in English or French.
2. **Match.** The app from the catalog that answers it, and why.
3. **Plan.** The next passes of Loft's YAM satellites able to reach the area, on a 48 h timeline,
   with the satellites moving live on the map.
4. **Try.** A sample of the app's output, computed on a real Sentinel-2 image of that place.
5. **Book.** Pick passes, see the price (volume tiers, priority option), order.
6. **Track.** Each mission shows passes flown, passes left, amount billed and amount committed.

## Try it: three guided missions

The public demo is guided: pick a mission, then follow the quick replies. Each one is modelled on
a use case Loft Orbital has announced, and the two disasters are real events replayed on the
Sentinel-2 images of that day, so they give the same result every time.

| Mission | App | Image | What the sample computes |
|---|---|---|---|
| Ships at anchor off Marseille-Fos | HarborEye (vessel detection) | Latest clear image, **live** | Bright objects on open sea in near-infrared; rocks and platforms dropped by checking a second date a week apart |
| Wildfire at Arganil, Portugal | FireSentry (wildfire detection) | Replay of 16 Aug 2025, vs 3 Aug | Active flames from the SWIR bands (HOTMAP test, Murphy et al. 2016) and burned area (dNBR, clouds masked) |
| Romagna floods, Italy | FloodWatch (flood mapping) | Replay of 23 May 2023, vs 3 Apr | Water from MNDWI, clouds masked; only water absent on the reference counts as flood |

Things worth trying: switch the demo account (the port authority can't order a fire app: no
licence), book a few passes and watch the price change, toggle *before / after* on the map, and
open *Past missions* to see usage.

## What is real, what is simulated

| Real | Simulated |
|---|---|
| Orbits: public TLEs of Loft's YAM satellites, Sentinel-2 and ~160 Earth-observation satellites (CelesTrak), propagated with SGP4 | The apps, their partners and their prices are fictional |
| Pass prediction over the area (closest approach, ~25° off-nadir reach, sun elevation) | Real onboard models: the samples are classical remote-sensing baselines, not the partners' AI |
| Sentinel-2 L2A images (Earth Search STAC), read at full resolution from the public archive | Sentinel-2 stands in for the imagery a YAM payload would capture |
| Request understanding by an LLM (Mistral via OpenRouter), validated against a schema | Accounts: hard-coded tenants selected with a header instead of a login |
| Orders, entitlements, pricing and metering, persisted in SQLite | No tasking is sent anywhere: a booked pass is a reservation in this app |

The UI says the same thing where it matters: a sample output is labelled as a baseline, a demo
replay is labelled with its date.

## Product choices

- **Sell answers, not imagery.** The catalog lists outcomes (vessels with length, flood extent,
  fire fronts) with their latency and price per pass. The image is only there to make the answer
  credible.
- **Show the output before the order.** "What will I actually get?" is the first objection of a
  buyer who has never used satellite data. A sample on a real image of *their* place answers it
  better than a brochure.
- **Honest constraints in the flow.** Optical apps need daylight, so night passes are left out
  of the booking, and the UI says how many and why. Onboard apps analyse new acquisitions and can't look back in time, so a request
  about the past ("fires this summer") gets an explanation and a pointer to archive services
  (EFFIS, Copernicus EMS) instead of a fake result.
- **Guided demo, real engine underneath.** Three curated missions make a two-minute demo
  reproducible and keep LLM costs at zero for visitors. Free-text interpretation is still a public
  endpoint: `POST /api/interpret` (try it from [`/docs`](https://orbit-finder.92.113.26.165.sslip.io/docs)).
- **Pay per pass, metered from the schedule.** A pass is billed once flown, unless the mission was
  cancelled before it. This is simple to explain to a customer and needs no billing job: usage is
  derived from pass times on every read.

## Engineering choices

- **The server decides what is billed.** When ordering, the client sends the passes it selected;
  the API recomputes passes itself, keeps only those that exist and can run the app (daylight for
  optical apps), and prices them from its own tables. The quote shown in the UI comes from the same
  `GET /api/pricing` terms.
- **Tenancy and entitlements.** Every order query is scoped by account; another account's order
  answers 404, as if it didn't exist. Ordering an app without a licence answers 403 with the reason.
- **The LLM's output is a value to validate, not to trust.** Structured output against a Pydantic
  schema; the app id must be one of the catalog's; one corrective retry; dates are clamped; a
  place unknown to the geocoder falls back to the nearest town named by the model, with a warning.
- **No URL ever comes from the client.** Map tiles and samples take a scene id matching the
  Sentinel-2 naming pattern; the image location is looked up in STAC and must be in the public
  Sentinel-2 bucket. This closes the classic tile-proxy SSRF.
- **Be a good citizen of free data sources.** CelesTrak blocks clients that download too often, so
  TLEs are cached on disk for 6 h, with a snapshot bundled in the image and an hour of back-off
  after a failure. Geocoding results are cached. Costly endpoints (LLM, samples, orders) have per-IP limits.
- **Read only what is needed.** Imagery is read as Cloud-Optimized GeoTIFF windows (HTTP range
  requests), bands of both dates in parallel; results are cached in memory.
- **One image, one process.** The Vite build is served by FastAPI from the same container: one
  Dockerfile, one port, no CORS, a health check, a volume for SQLite and the TLE cache.

Known shortcuts, kept on purpose for a three-day scope: demo accounts instead of authentication,
SQLite instead of a managed database, an in-memory rate limiter and cache (single instance), and
a first sample that can take ~20 s on the one-CPU demo server (then ~1 s, cached).

## Architecture

```
Browser (React + TypeScript, MapLibre, satellite.js)
  │  chat + quick replies · map · pass timeline · booking rail · missions
  │  live positions: SGP4 in the browser from the TLEs served by the API
  ▼
FastAPI (Python 3.12)
  ├─ /interpret   LLM (OpenRouter → Mistral) → validated query → Nominatim geocoding
  ├─ /passes      skyfield SGP4 over Loft's YAM fleet ─────────────► CelesTrak TLEs (cached)
  ├─ /scenes      Sentinel-2 L2A search ───────────────────────────► Earth Search STAC
  ├─ /scenes/…/tiles, /preview   rio-tiler COG reads + numpy/scipy ─► public S3 bucket
  ├─ /orders, /pricing, /accounts   entitlements, pricing, metering ─► SQLite
  └─ static files of the web build
```

| Area | Files |
|---|---|
| App catalog, demo missions | `api/app/catalog.py`, `api/app/demos.py` |
| Request understanding | `api/app/interpret.py`, `api/app/llm.py` |
| Orbits and passes | `api/app/orbits.py`, `api/app/geo.py` |
| Imagery: search, tiles, samples | `api/app/stac.py`, `api/app/tiles.py`, `api/app/analysis.py` |
| Marketplace: orders, pricing | `api/app/orders.py`, `api/app/pricing.py` |
| UI | `web/src/App.tsx`, `web/src/components/`, `web/src/lib/` |

## Taking it to production on GCP

The app is one stateless container listening on one port, the shape **Cloud Run** expects,
once state leaves the local volume. The path:

- **Identity:** Identity Platform (or the company's OIDC provider); the tenant comes from a token
  claim instead of the `X-Demo-Account` header, and licences live in the database.
- **Data:** Cloud SQL (PostgreSQL) for accounts, licences, orders and a real usage ledger;
  the pass and pricing logic stays as is.
- **Caches and limits:** Memorystore (Redis) for TLEs, geocoding and rate limits once there is
  more than one instance; previews computed by a Cloud Run job and stored in Cloud Storage.
- **Secrets and delivery:** Secret Manager for the LLM key, Artifact Registry and a deploy step in
  the existing CI workflow.
- **Integration with Loft:** replace the simulated booking with the real tasking API, and the
  sample baselines with the partners' own results once delivered.

## What I would do next at Loft

- **Partner side of the marketplace.** A portal where an app developer publishes an app (sensor,
  output schema, latency, price), sees its usage and its revenue share.
- **Deliveries.** Push each result to the customer (webhook, email, GeoJSON feed) as soon as it is
  downlinked, with the order's history of deliveries.
- **Recurring missions and alerts.** "Every pass over this port" with a budget cap, and an alert
  rule ("more than 20 ships", "any fire front").
- **Feasibility with real constraints.** Payload modes, onboard compute and downlink windows, and
  competing requests, rather than geometry and daylight only.

## Run it locally

Requirements: Python 3.12 with [uv](https://docs.astral.sh/uv/), Node 22+. An
[OpenRouter](https://openrouter.ai) key is only needed for `/api/interpret`.

```bash
# API on http://localhost:8000 (docs at /docs)
cd api && cp .env.example .env   # add OPENROUTER_API_KEY to use /api/interpret
uv run uvicorn app.main:app --reload
```

```bash
# Web on http://localhost:5173, proxies /api to the API
cd web && npm install && npm run dev
```

```bash
# Tests and lint
cd api && uv run pytest && uv run ruff check . && uv run ruff format --check .
cd web && npx oxlint src && npm run build
```

## Deploy

One Dockerfile at the repository root builds the web app and serves it from the API container on
port 8000.

- Environment: `OPENROUTER_API_KEY` (optional `LLM_MODEL`, default `mistralai/mistral-small-2603`).
- Volume: mount `/app/data` to keep orders (SQLite) and the TLE cache across deploys.
- The demo runs on a small VPS with Coolify; the CI workflow (`.github/workflows/ci.yml`) lints,
  tests, builds the image and smoke-tests it.

## How it was built

I built this with an AI coding assistant (Claude Code) as a pair: I set the product direction, the
scope and the trade-offs, reviewed the code and tested every flow; the assistant wrote most of the
code under that direction. That is how I work day to day, and it is what made a deployed,
tested, end-to-end product possible in three days.

## Data and credits

- Copernicus Sentinel-2 data (ESA), via [Earth Search](https://earth-search.aws.element84.com/v1)
  by Element 84 and the Registry of Open Data on AWS.
- Orbital elements: [CelesTrak](https://celestrak.org). Geocoding: © OpenStreetMap contributors,
  [Nominatim](https://nominatim.org).
- Basemap: [Sentinel-2 cloudless 2024](https://s2maps.eu) by EOX IT Services GmbH (contains
  modified Copernicus Sentinel data 2024).
- Demo use cases are based on Loft Orbital's public announcements, linked in each mission.

Apps, partners, accounts and prices are fictional. This is a personal project, not affiliated
with Loft Orbital.
