export type MapId = 'AmbroseValley' | 'GrandRift' | 'Lockdown';

export type MapConfig = {
  map_id: MapId;
  scale: number;
  origin_x: number;
  origin_z: number;
  minimap_path: string;
  minimap_width: number;
  minimap_height: number;
};

export type MetaResponse = {
  dates: string[];
  maps: MapConfig[];
};

export type MatchListItem = {
  match_id: string;
  date: string;
  map_id: MapId;
  players: number;
  humans: number;
  bots: number;
  min_t_ms: number;
  max_t_ms: number;
};

export type PlayerTrack = {
  user_id: string;
  is_bot: boolean;
  points: [number, number, number][]; // (px, py, t_ms)
};

export type MatchEvent = {
  user_id: string;
  is_bot: boolean;
  event: string;
  x: number;
  z: number;
  px: number;
  py: number;
  t_ms: number;
};

export type MatchDetailResponse = {
  match_id: string;
  map_id: MapId;
  date: string;
  duration_ms: number;
  tracks: PlayerTrack[];
  events: MatchEvent[];
};

export type HeatmapCell = {
  x: number;
  y: number;
  value: number;
};

export type HeatmapResponse = {
  map_id: MapId;
  date: string | null;
  kind: string;
  cell_size: number;
  width: number;
  height: number;
  cells: HeatmapCell[];
};

