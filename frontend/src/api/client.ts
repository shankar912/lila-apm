import type { HeatmapResponse, MatchDetailResponse, MatchListItem, MetaResponse } from './types';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'https://lila-apm.onrender.com';

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export function fetchMeta(): Promise<MetaResponse> {
  return getJson(`/api/meta`);
}

export function fetchMatches(params: {
  date?: string;
  map_id?: string;
  limit?: number;
  offset?: number;
}): Promise<MatchListItem[]> {
  const qs = new URLSearchParams();
  if (params.date) qs.set('date', params.date);
  if (params.map_id) qs.set('map_id', params.map_id);
  qs.set('limit', String(params.limit ?? 200));
  qs.set('offset', String(params.offset ?? 0));
  return getJson(`/api/matches?${qs.toString()}`);
}

export function fetchMatchDetail(matchId: string, params?: { sample_ms?: number; include_positions?: boolean }): Promise<MatchDetailResponse> {
  const qs = new URLSearchParams();
  if (params?.sample_ms !== undefined) qs.set('sample_ms', String(params.sample_ms));
  if (params?.include_positions !== undefined) qs.set('include_positions', String(params.include_positions));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return getJson(`/api/match/${encodeURIComponent(matchId)}${suffix}`);
}

export function fetchHeatmap(params: {
  kind: 'traffic' | 'kills' | 'deaths' | 'storm_deaths' | 'loot';
  date?: string;
  map_id?: string;
  cell_size?: number;
}): Promise<HeatmapResponse> {
  const qs = new URLSearchParams();
  qs.set('kind', params.kind);
  if (params.date) qs.set('date', params.date);
  if (params.map_id) qs.set('map_id', params.map_id);
  if (params.cell_size) qs.set('cell_size', String(params.cell_size));
  return getJson(`/api/heatmap?${qs.toString()}`);
}

