from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from backend.services.indexer import DataIndex
from backend.services.models import HeatmapResponse, MatchDetailResponse, MatchListItem, MetaResponse


DATA_ROOT = Path(os.environ.get("PLAYER_DATA_ROOT", Path(__file__).resolve().parents[1] / "player_data"))


app = FastAPI(title="LILA Player Journey API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

index = DataIndex(DATA_ROOT)


@app.on_event("startup")
def _startup() -> None:
    index.build()


@app.get("/api/meta", response_model=MetaResponse)
def meta() -> MetaResponse:
    return index.meta()


@app.get("/api/matches", response_model=list[MatchListItem])
def list_matches(
    date: str | None = Query(default=None, description="Folder name like February_10"),
    map_id: str | None = Query(default=None, description="AmbroseValley | GrandRift | Lockdown"),
    limit: int = Query(default=200, ge=1, le=2000),
    offset: int = Query(default=0, ge=0),
) -> list[MatchListItem]:
    return index.list_matches(date=date, map_id=map_id, limit=limit, offset=offset)


@app.get("/api/match/{match_id}", response_model=MatchDetailResponse)
def match_detail(
    match_id: str,
    include_positions: bool = Query(default=True),
    sample_ms: int = Query(default=250, ge=0, le=2000, description="Downsample movement events to this interval (0 disables)"),
) -> MatchDetailResponse:
    try:
        return index.match_detail(match_id=match_id, include_positions=include_positions, sample_ms=sample_ms)
    except KeyError:
        raise HTTPException(status_code=404, detail="Match not found")


@app.get("/api/heatmap", response_model=HeatmapResponse)
def heatmap(
    date: str | None = Query(default=None),
    map_id: str | None = Query(default=None),
    kind: Literal["traffic", "kills", "deaths", "storm_deaths", "loot"] = Query(default="traffic"),
    cell_size: int = Query(default=16, ge=4, le=64, description="Heatmap grid cell size in pixels"),
    max_points: int = Query(default=200_000, ge=1000, le=500_000),
) -> HeatmapResponse:
    return index.heatmap(date=date, map_id=map_id, kind=kind, cell_size=cell_size, max_points=max_points)


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"ok": True, "data_root": str(DATA_ROOT), "indexed_files": index.file_count}

