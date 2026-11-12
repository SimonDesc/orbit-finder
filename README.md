# Orbit Finder

Describe the satellite imagery you need in plain English — Orbit Finder turns it into a structured
search (area, time window, sensor), lists matching Sentinel-2 scenes and predicts the next
satellite passes over that area.

> 🚧 Work in progress. Product rationale, architecture and demo will be documented here.

## Stack

- **Web**: React + TypeScript (Vite), shadcn/ui, MapLibre GL
- **API**: Python, FastAPI, pystac-client, skyfield (SGP4)
- **LLM**: any model via OpenRouter (Mistral by default), structured output validated with Pydantic
- **Data**: Earth Search STAC (Sentinel-2 L2A), CelesTrak TLEs, Nominatim geocoding
- **Deploy**: one Docker image (API + static frontend) — runs on Coolify, portable to Cloud Run

## Run locally

```bash
# API (http://localhost:8000)
cd api && cp .env.example .env   # add your OpenRouter key
uv run uvicorn app.main:app --reload

# Web (http://localhost:5173, proxies /api to :8000)
cd web && npm install && npm run dev
```
