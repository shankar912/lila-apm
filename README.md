# Player Journey Visualization Tool (LILA APM Test)

Web-based tool to visualize player paths + combat/loot/storm events on LILA BLACK minimaps, with filters, timeline playback, and heatmaps.

## Repo structure

- `backend/`: FastAPI API that reads parquet journey files from `player_data/`
- `frontend/`: React + Leaflet UI (minimap overlay + filters + playback + heatmaps)
- `player_data/`: provided dataset (parquet files without extension + minimaps)
- `ARCHITECTURE.md`: 1-page architecture / mapping explanation
- `INSIGHTS.md`: 3 insights backed by evidence (generated via script)

## Prereqs

- Python 3.11+ (works with 3.13)
- Node.js 18+

## Run locally

### 1) Backend (FastAPI)

From repo root:

```bash
python -m pip install -r backend/requirements.txt
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

If your dataset path is different:

```bash
set PLAYER_DATA_ROOT=C:\path\to\player_data
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

Endpoints:

- `GET /api/meta`
- `GET /api/matches?date=February_10&map_id=AmbroseValley`
- `GET /api/match/{match_id}?sample_ms=250`
- `GET /api/heatmap?kind=traffic&date=February_10&map_id=AmbroseValley`

### 2) Frontend (React + Leaflet)

From repo root:

```bash
cd frontend
npm install
npm run dev
```

By default the UI calls the backend at `http://127.0.0.1:8000`.

To change API base URL:

```bash
set VITE_API_BASE=http://127.0.0.1:8000
npm run dev
```

## Generate insights

```bash
python scripts/generate_insights.py
```

This overwrites `INSIGHTS.md`.

## Deployment notes (shareable URL)

- **Backend**: deploy `backend/` to Railway / Render / Fly.io (set `PLAYER_DATA_ROOT` and include the dataset, or host the dataset in object storage and mount/download on boot).
- **Frontend**: deploy `frontend/` to Vercel/Netlify as a static site. Set `VITE_API_BASE` to the deployed backend URL.

