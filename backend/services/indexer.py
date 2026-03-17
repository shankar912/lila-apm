from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import numpy as np
import pandas as pd
import pyarrow.parquet as pq

from backend.services.models import (
    HeatmapCell,
    HeatmapResponse,
    MapConfig as MapConfigModel,
    MatchDetailResponse,
    MatchEvent,
    MatchListItem,
    MetaResponse,
    PlayerTrack,
)
from backend.services.world_to_minimap import MAP_CONFIGS, world_to_pixel


def _is_bot_user_id(user_id: str) -> bool:
    # Bots are short numeric IDs per dataset README.
    return user_id.isdigit()


def _decode_event_col(series: pd.Series) -> pd.Series:
    # Parquet event column is binary/bytes; decode safely.
    def _decode(v):
        if isinstance(v, (bytes, bytearray, memoryview)):
            return bytes(v).decode("utf-8", errors="replace")
        return str(v)

    return series.apply(_decode)


@dataclass(frozen=True)
class JourneyFile:
    path: Path
    date: str
    match_id: str
    user_id: str
    is_bot: bool


@dataclass
class MatchMeta:
    match_id: str
    date: str
    map_id: str
    files: list[JourneyFile]
    humans: int = 0
    bots: int = 0
    min_ts: int | None = None  # epoch ms as int
    max_ts: int | None = None


class DataIndex:
    def __init__(self, data_root: Path):
        self.data_root = data_root
        self.file_count: int = 0
        self._dates: list[str] = []
        self._match_by_id: dict[str, MatchMeta] = {}

    def build(self) -> None:
        if not self.data_root.exists():
            raise RuntimeError(f"PLAYER_DATA_ROOT not found: {self.data_root}")

        dates = [p.name for p in sorted(self.data_root.iterdir()) if p.is_dir() and p.name.startswith("February_")]
        self._dates = dates

        match_files: dict[str, list[JourneyFile]] = defaultdict(list)

        for date in dates:
            day_dir = self.data_root / date
            for f in day_dir.iterdir():
                if not f.is_file():
                    continue
                name = f.name
                # {user_id}_{match_id}.nakama-0
                if "_" not in name:
                    continue
                user_id, rest = name.split("_", 1)
                match_id = rest  # includes .nakama-0
                jf = JourneyFile(path=f, date=date, match_id=match_id, user_id=user_id, is_bot=_is_bot_user_id(user_id))
                match_files[match_id].append(jf)

        self.file_count = sum(len(v) for v in match_files.values())

        match_by_id: dict[str, MatchMeta] = {}
        # First pass: create match metas and count humans/bots.
        for match_id, files in match_files.items():
            humans = sum(1 for jf in files if not jf.is_bot)
            bots = len(files) - humans
            match_by_id[match_id] = MatchMeta(match_id=match_id, date=files[0].date, map_id="", files=files, humans=humans, bots=bots)

        # Second pass: infer map_id and ts range by reading a tiny slice per match.
        for mm in match_by_id.values():
            # Map id is constant within match; timestamps may span across many files.
            map_id_val: str | None = None
            min_ts: int | None = None
            max_ts: int | None = None
            for jf in mm.files:
                sample = self._read_parquet(jf.path, columns=["map_id", "ts"])
                if sample.empty:
                    continue
                if map_id_val is None:
                    map_id_val = str(sample["map_id"].iloc[0])
                ts_ms = self._ts_to_ms(sample["ts"])
                if ts_ms.empty:
                    continue
                lo = int(ts_ms.min())
                hi = int(ts_ms.max())
                min_ts = lo if min_ts is None else min(min_ts, lo)
                max_ts = hi if max_ts is None else max(max_ts, hi)

            if map_id_val is None or min_ts is None or max_ts is None:
                continue
            mm.map_id = map_id_val
            mm.min_ts = min_ts
            mm.max_ts = max_ts

        self._match_by_id = match_by_id

    def meta(self) -> MetaResponse:
        maps = []
        minimaps_dir = self.data_root / "minimaps"
        # Frontend will load these from a static copy; backend exposes paths for completeness.
        map_to_img = {
            "AmbroseValley": str(minimaps_dir / "AmbroseValley_Minimap.png"),
            "GrandRift": str(minimaps_dir / "GrandRift_Minimap.png"),
            "Lockdown": str(minimaps_dir / "Lockdown_Minimap.jpg"),
        }
        for map_id, cfg in MAP_CONFIGS.items():
            maps.append(
                MapConfigModel(
                    map_id=map_id, scale=cfg.scale, origin_x=cfg.origin_x, origin_z=cfg.origin_z, minimap_path=map_to_img[map_id]
                )
            )
        return MetaResponse(dates=self._dates, maps=maps)

    def list_matches(self, date: str | None, map_id: str | None, limit: int, offset: int) -> list[MatchListItem]:
        items: list[MatchListItem] = []
        for mm in self._match_by_id.values():
            if date and mm.date != date:
                continue
            if map_id and mm.map_id != map_id:
                continue
            if mm.min_ts is None or mm.max_ts is None:
                continue
            items.append(
                MatchListItem(
                    match_id=mm.match_id,
                    date=mm.date,
                    map_id=mm.map_id,
                    players=len(mm.files),
                    humans=mm.humans,
                    bots=mm.bots,
                    min_t_ms=0,
                    max_t_ms=int(mm.max_ts - mm.min_ts),
                )
            )
        items.sort(key=lambda x: (x.date, x.map_id, x.match_id))
        return items[offset : offset + limit]

    def match_detail(self, match_id: str, include_positions: bool, sample_ms: int) -> MatchDetailResponse:
        mm = self._match_by_id[match_id]
        if mm.min_ts is None or mm.max_ts is None:
            raise KeyError(match_id)
        t0 = mm.min_ts
        duration = int(mm.max_ts - t0)

        tracks: list[PlayerTrack] = []
        events: list[MatchEvent] = []

        for jf in mm.files:
            cols = ["user_id", "map_id", "x", "z", "ts", "event"]
            df = self._read_parquet(jf.path, columns=cols)
            if df.empty:
                continue
            df["event"] = _decode_event_col(df["event"])
            ts_ms = self._ts_to_ms(df["ts"]).astype("int64")
            df["t_ms"] = (ts_ms - t0).astype("int64")

            # Tracks: movement-only
            if include_positions:
                move_mask = df["event"].isin(["Position", "BotPosition"])
                move = df.loc[move_mask, ["x", "z", "t_ms"]].copy()
                if not move.empty:
                    if sample_ms > 0:
                        move = self._downsample_by_time(move, sample_ms=sample_ms)
                    pts = []
                    for x, z, t_ms in move.itertuples(index=False, name=None):
                        px, py = world_to_pixel(mm.map_id, float(x), float(z))
                        pts.append((float(px), float(py), int(t_ms)))
                    tracks.append(PlayerTrack(user_id=jf.user_id, is_bot=jf.is_bot, points=pts))

            # Events: non-movement
            ev_mask = ~df["event"].isin(["Position", "BotPosition"])
            ev = df.loc[ev_mask, ["x", "z", "t_ms", "event"]]
            for x, z, t_ms, ev_name in ev.itertuples(index=False, name=None):
                px, py = world_to_pixel(mm.map_id, float(x), float(z))
                events.append(
                    MatchEvent(
                        user_id=jf.user_id,
                        is_bot=jf.is_bot,
                        event=str(ev_name),
                        x=float(x),
                        z=float(z),
                        px=float(px),
                        py=float(py),
                        t_ms=int(t_ms),
                    )
                )

        events.sort(key=lambda e: e.t_ms)
        return MatchDetailResponse(
            match_id=mm.match_id,
            map_id=mm.map_id,
            date=mm.date,
            duration_ms=duration,
            tracks=tracks,
            events=events,
        )

    def heatmap(
        self,
        date: str | None,
        map_id: str | None,
        kind: Literal["traffic", "kills", "deaths", "storm_deaths", "loot"],
        cell_size: int,
        max_points: int,
    ) -> HeatmapResponse:
        # Heatmap is aggregated grid of 1024x1024 pixels.
        # We compute counts per cell (or weighted counts) and return sparse cells.
        if map_id is None:
            # default to most common / first known
            map_id = "AmbroseValley"

        grid_w = 1024 // cell_size
        grid_h = 1024 // cell_size
        grid = np.zeros((grid_h, grid_w), dtype=np.float32)

        points_seen = 0
        for mm in self._match_by_id.values():
            if date and mm.date != date:
                continue
            if map_id and mm.map_id != map_id:
                continue
            for jf in mm.files:
                df = self._read_parquet(jf.path, columns=["x", "z", "event"])
                if df.empty:
                    continue
                df["event"] = _decode_event_col(df["event"])

                if kind == "traffic":
                    mask = df["event"].isin(["Position", "BotPosition"])
                elif kind == "kills":
                    mask = df["event"].isin(["Kill", "BotKill"])
                elif kind == "deaths":
                    mask = df["event"].isin(["Killed", "BotKilled"])
                elif kind == "storm_deaths":
                    mask = df["event"].isin(["KilledByStorm"])
                elif kind == "loot":
                    mask = df["event"].isin(["Loot"])
                else:
                    mask = np.zeros(len(df), dtype=bool)

                pts = df.loc[mask, ["x", "z"]]
                if pts.empty:
                    continue

                # Cap total points to keep API responsive.
                remaining = max_points - points_seen
                if remaining <= 0:
                    break
                if len(pts) > remaining:
                    pts = pts.sample(n=remaining, random_state=1)

                points_seen += len(pts)
                for x, z in pts.itertuples(index=False, name=None):
                    px, py = world_to_pixel(map_id, float(x), float(z))
                    if px < 0 or py < 0 or px >= 1024 or py >= 1024:
                        continue
                    gx = int(px // cell_size)
                    gy = int(py // cell_size)
                    if 0 <= gx < grid_w and 0 <= gy < grid_h:
                        grid[gy, gx] += 1.0

            if points_seen >= max_points:
                break

        # Normalize to 0..1 for UI.
        max_val = float(grid.max()) if grid.size else 0.0
        if max_val > 0:
            grid = grid / max_val

        cells: list[HeatmapCell] = []
        for gy in range(grid_h):
            row = grid[gy]
            for gx in range(grid_w):
                v = float(row[gx])
                if v <= 0:
                    continue
                cells.append(HeatmapCell(x=gx, y=gy, value=v))

        return HeatmapResponse(map_id=map_id, date=date, kind=kind, cell_size=cell_size, cells=cells)

    def _read_parquet(self, path: Path, columns: list[str] | None = None) -> pd.DataFrame:
        try:
            table = pq.read_table(path, columns=columns)
            return table.to_pandas()
        except Exception:
            return pd.DataFrame()

    def _ts_to_ms(self, ts: pd.Series) -> pd.Series:
        # Pandas will read pyarrow timestamp as datetime64[ns] or object.
        s = pd.to_datetime(ts, errors="coerce")
        dtype = str(s.dtype)
        vals = s.astype("int64")

        # Convert to epoch milliseconds, respecting datetime unit.
        # Note: casting datetime64[ms] -> datetime64[ns] can *reinterpret* the integer
        # in some stacks instead of rescaling; we avoid that by converting based on unit.
        if dtype.endswith("[ns]"):
            vals = vals // 1_000_000
        elif dtype.endswith("[us]"):
            vals = vals // 1_000
        elif dtype.endswith("[ms]"):
            vals = vals
        elif dtype.endswith("[s]"):
            vals = vals * 1_000
        else:
            # Fallback: assume nanoseconds
            vals = vals // 1_000_000

        return vals.astype("int64")

    def _downsample_by_time(self, df: pd.DataFrame, sample_ms: int) -> pd.DataFrame:
        # df has columns x,z,t_ms. Keep first point per bucket.
        if df.empty:
            return df
        bucket = (df["t_ms"] // sample_ms).astype("int64")
        df2 = df.copy()
        df2["_b"] = bucket
        return df2.drop_duplicates(subset=["_b"]).drop(columns=["_b"])

