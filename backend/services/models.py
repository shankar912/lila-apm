from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class MapConfig(BaseModel):
    map_id: Literal["AmbroseValley", "GrandRift", "Lockdown"]
    scale: float
    origin_x: float
    origin_z: float
    minimap_path: str
    minimap_width: int = 1024
    minimap_height: int = 1024


class MetaResponse(BaseModel):
    dates: list[str]
    maps: list[MapConfig]


class MatchListItem(BaseModel):
    match_id: str
    date: str
    map_id: str
    players: int = Field(description="Number of journey files (humans+bots) observed for this match")
    humans: int
    bots: int
    min_t_ms: int
    max_t_ms: int


class MatchEvent(BaseModel):
    user_id: str
    is_bot: bool
    event: str
    x: float
    z: float
    px: float = Field(description="Minimap pixel X (0-1024)")
    py: float = Field(description="Minimap pixel Y (0-1024)")
    t_ms: int = Field(description="Milliseconds since match start")


class PlayerTrack(BaseModel):
    user_id: str
    is_bot: bool
    points: list[tuple[float, float, int]] = Field(
        description="List of (px, py, t_ms) sampled points for this player's movement"
    )


class MatchDetailResponse(BaseModel):
    match_id: str
    map_id: str
    date: str
    duration_ms: int
    tracks: list[PlayerTrack]
    events: list[MatchEvent]


class HeatmapCell(BaseModel):
    x: int
    y: int
    value: float


class HeatmapResponse(BaseModel):
    map_id: str
    date: str | None
    kind: str
    cell_size: int
    width: int = 1024
    height: int = 1024
    cells: list[HeatmapCell]

