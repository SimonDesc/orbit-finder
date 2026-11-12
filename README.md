# Orbit Finder


Describe the satellite imagery you need in plain English — Orbit Finder turns it into a structured
search (area, time window, sensor), lists matching Sentinel-2 scenes and predicts the next
satellite passes over that area.

**Live demo: https://orbit-finder.92.113.26.165.sslip.io**

> 🚧 Work in progress. Product rationale, architecture and demo will be documented here.

## Demo missions

Three guided missions run end to end (ask → app → Loft passes → result on a real image → order),
each modelled on a use case Loft Orbital flies:

| Mission | App | Image | Method |
|---|---|---|---|
| Ships at anchor off Marseille-Fos | Vessel detection | Latest clear Sentinel-2 image | Bright objects on open sea (NIR), static ones dropped with a second date |
| Wildfire at Arganil, Portugal | Wildfire detection | 16 Aug 2025 vs 3 Aug | Active flames from SWIR (HOTMAP, Murphy et al. 2016) + burned area (dNBR) |
| Romagna floods, Italy | Flood mapping | 23 May 2023 vs 3 Apr | MNDWI water, clouds masked; only new water counts as flood |

Passes and orders use the public orbits of Loft's YAM satellites (CelesTrak); the live map also
shows Sentinel-2 and ~160 other Earth-observation satellites.

## Stack

- **Web**: React + TypeScript (Vite), shadcn/ui, MapLibre GL
- **API**: Python, FastAPI, pystac-client, skyfield (SGP4)
- **LLM**: any model via OpenRouter (Mistral by default), structured output validated with Pydantic
- **Data**: Earth Search STAC (Sentinel-2 L2A), CelesTrak TLEs, Nominatim geocoding
- **Deploy**: one Docker image (API + static frontend) — runs on Coolify, portable to Cloud Run

## Deploy

One Dockerfile at the repo root builds the frontend and serves it from the API container on
port 8000. Required env var: `OPENROUTER_API_KEY` (optional: `LLM_MODEL`). Mount a volume on
`/app/data` to keep the orbit cache across deploys. The demo runs on Coolify; the same image
runs unchanged on Google Cloud Run.

## Run locally

```bash
# API (http://localhost:8000)
cd api && cp .env.example .env   # add your OpenRouter key
uv run uvicorn app.main:app --reload

# Web (http://localhost:5173, proxies /api to :8000)
cd web && npm install && npm run dev
```
