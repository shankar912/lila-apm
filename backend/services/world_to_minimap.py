from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class MapConfig:
    map_id: str
    scale: float
    origin_x: float
    origin_z: float
    width: int = 1024
    height: int = 1024


MAP_CONFIGS: dict[str, MapConfig] = {
    "AmbroseValley": MapConfig(map_id="AmbroseValley", scale=900, origin_x=-370, origin_z=-473),
    "GrandRift": MapConfig(map_id="GrandRift", scale=581, origin_x=-290, origin_z=-290),
    "Lockdown": MapConfig(map_id="Lockdown", scale=1000, origin_x=-500, origin_z=-500),
}


def world_to_pixel(map_id: str, x: float, z: float) -> tuple[float, float]:
    cfg = MAP_CONFIGS[map_id]
    u = (x - cfg.origin_x) / cfg.scale
    v = (z - cfg.origin_z) / cfg.scale
    px = u * cfg.width
    py = (1.0 - v) * cfg.height
    return px, py

