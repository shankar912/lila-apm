# Architecture (1 page)

## What I built

- **Frontend**: React + TypeScript (Vite) + **Leaflet** (`react-leaflet`) for an image-based minimap with overlays.
- **Backend**: **FastAPI** that reads the provided parquet journey files directly from `player_data/` and serves JSON to the UI.

Why this stack:

- Leaflet’s `CRS.Simple` makes **pixel-accurate image overlays** easy (perfect for 1024×1024 minimaps).
- FastAPI + PyArrow reads parquet reliably on Windows, and is fast enough for this dataset size without a heavy data warehouse.

## Data flow (end-to-end)

1. **Raw input**: `player_data/February_*/{user_id}_{match_id}.nakama-0` files (parquet without extension).
2. **Index build (backend startup)**:
   - Scan date folders (`February_10` … `February_14`)
   - Parse filenames to extract:
     - `match_id`
     - `user_id`
     - `is_bot` (numeric `user_id` => bot; UUID => human)
   - Read the `map_id` and timestamp range from each file to compute match metadata:
     - `min_ts`, `max_ts` per match
3. **API**:
   - `/api/matches`: list matches for selected `date` + `map_id`
   - `/api/match/{match_id}`: returns:
     - movement tracks (downsampled by `sample_ms`)
     - non-movement events (Kill/Killed/Loot/KilledByStorm, etc.)
     - each row includes precomputed minimap pixel coordinates
   - `/api/heatmap`: aggregates selected event types into a sparse grid for fast heatmap drawing
4. **Frontend rendering**:
   - Loads minimap image from `frontend/public/minimaps/*`
   - Draws:
     - **polylines** for tracks (humans vs bots color)
     - **markers** for events (kill/death/loot/storm-death colors)
     - **heat layer** overlay (traffic/kills/deaths/storm/loot)
   - Timeline slider + playback filters tracks/events by `t_ms` (“match elapsed milliseconds”)

## Coordinate mapping (world → minimap)

The dataset README defines the mapping per map:

- each minimap is **1024×1024**
- each map has `(scale, origin_x, origin_z)`
- convert `(x, z)` to UV:
  - \(u = (x - origin_x) / scale\)
  - \(v = (z - origin_z) / scale\)
- convert UV to pixels (image origin is top-left, so Y is flipped):
  - \(pixel_x = u \times 1024\)
  - \(pixel_y = (1 - v) \times 1024\)

Implementation:

- Backend implements `world_to_pixel(map_id, x, z)` in `backend/services/world_to_minimap.py`.
- Frontend uses Leaflet `CRS.Simple` and treats minimap pixels as map coordinates:
  - Leaflet position = `[pixel_y, pixel_x]`

## Timeline / timestamps

- Parquet `ts` is a timestamp representing **elapsed time within the match**, encoded as an epoch-like timestamp (often in 1970).
- Backend converts it to `t_ms = ts_ms - min_ts_ms(match)` so the UI can:
  - scrub a single slider from `0..duration_ms`
  - playback by increasing `t_ms` over time

## Trade-offs

| Decision | Benefit | Cost |
|---|---|---|
| Read parquet directly (PyArrow) | Simple, fewer moving parts | No persistent query engine; heavier API calls for large requests |
| Heatmap as coarse grid cells | Fast to compute + render | Not as smooth as kernel density; resolution depends on `cell_size` |
| Precompute pixel coords in backend | UI stays simple; mapping logic centralized | More bytes in response |

## If I had more time

- Pre-compute a compact match cache (or DuckDB) for faster repeated access and larger time spans.
- Better UX for match selection (search by match_id, show duration + player counts).
- Add “multi-match overlay” mode (aggregate traffic for a whole day by map with human/bot toggle).
- Add clustering for dense event marker views.

