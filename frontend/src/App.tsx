import './App.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ImageOverlay, MapContainer, Marker, Polyline, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet.heat'

import { fetchHeatmap, fetchMatchDetail, fetchMatches, fetchMeta } from './api/client'
import type { HeatmapResponse, MapId, MatchDetailResponse, MatchListItem, MetaResponse } from './api/types'

const MAP_IMAGE: Record<MapId, string> = {
  AmbroseValley: '/minimaps/AmbroseValley_Minimap.png',
  GrandRift: '/minimaps/GrandRift_Minimap.png',
  Lockdown: '/minimaps/Lockdown_Minimap.jpg',
}

const MAP_SIZE = 1024

type HeatKind = 'traffic' | 'kills' | 'deaths' | 'storm_deaths' | 'loot'

function FitToBounds({ bounds }: { bounds: L.LatLngBoundsExpression }) {
  const map = useMap()
  useEffect(() => {
    map.fitBounds(bounds, { padding: [12, 12], maxZoom: 2 })
  }, [map, bounds])
  return null
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

function formatMs(ms: number) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const ss = s % 60
  const t = ms % 1000
  return `${m}:${String(ss).padStart(2, '0')}.${String(t).padStart(3, '0')}`
}

function App() {
  const [meta, setMeta] = useState<MetaResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [selectedDate, setSelectedDate] = useState<string | undefined>(undefined)
  const [selectedMap, setSelectedMap] = useState<MapId>('AmbroseValley')
  const [matches, setMatches] = useState<MatchListItem[]>([])
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null)

  const [match, setMatch] = useState<MatchDetailResponse | null>(null)
  const [sampleMs, setSampleMs] = useState<number>(250)

  const [tMs, setTMs] = useState<number>(0)
  const [playing, setPlaying] = useState<boolean>(false)

  const [showHumans, setShowHumans] = useState(true)
  const [showBots, setShowBots] = useState(true)
  const [showEvents, setShowEvents] = useState(true)

  const [heatKind, setHeatKind] = useState<HeatKind>('traffic')
  const [heat, setHeat] = useState<HeatmapResponse | null>(null)
  const heatLayerRef = useRef<L.Layer | null>(null)

  const bounds = useMemo(() => {
    // Leaflet CRS.Simple uses pixel-like coordinates. We'll use (y, x) == (lat, lng) in pixels.
    return L.latLngBounds([0, 0], [MAP_SIZE, MAP_SIZE])
  }, [])

  useEffect(() => {
    fetchMeta()
      .then((m) => {
        setMeta(m)
        setSelectedDate(m.dates[0])
      })
      .catch((e) => setError(String(e)))
  }, [])

  useEffect(() => {
    if (!selectedDate || !selectedMap) return
    setError(null)
    fetchMatches({ date: selectedDate, map_id: selectedMap, limit: 500 })
      .then((ms) => {
        setMatches(ms)
        setSelectedMatchId(ms[0]?.match_id ?? null)
      })
      .catch((e) => setError(String(e)))
  }, [selectedDate, selectedMap])

  useEffect(() => {
    if (!selectedMatchId) {
      setMatch(null)
      return
    }
    setError(null)
    fetchMatchDetail(selectedMatchId, { sample_ms: sampleMs })
      .then((d) => {
        setMatch(d)
        setTMs(0)
        setPlaying(false)
      })
      .catch((e) => setError(String(e)))
  }, [selectedMatchId, sampleMs])

  useEffect(() => {
    if (!selectedMap) return
    fetchHeatmap({ kind: heatKind, date: selectedDate, map_id: selectedMap, cell_size: 16 })
      .then(setHeat)
      .catch((e) => setError(String(e)))
  }, [heatKind, selectedDate, selectedMap])

  useEffect(() => {
    if (!playing || !match) return
    const start = performance.now()
    const startT = tMs
    const id = window.setInterval(() => {
      const dt = performance.now() - start
      const next = clamp(startT + dt, 0, match.duration_ms)
      setTMs(next)
      if (next >= match.duration_ms) setPlaying(false)
    }, 50)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, match])

  const filteredTracks = useMemo(() => {
    if (!match) return []
    return match.tracks.filter((t) => (t.is_bot ? showBots : showHumans))
  }, [match, showBots, showHumans])

  const filteredEvents = useMemo(() => {
    if (!match || !showEvents) return []
    return match.events
      .filter((e) => (e.is_bot ? showBots : showHumans))
      .filter((e) => e.t_ms <= tMs)
  }, [match, showEvents, showBots, showHumans, tMs])

  const trackPolylines = useMemo(() => {
    return filteredTracks.map((t) => {
      const pts = t.points.filter((p) => p[2] <= tMs)
      const latlngs: [number, number][] = pts.map((p) => [p[1], p[0]]) // (py, px)
      return { key: t.user_id, isBot: t.is_bot, latlngs, count: latlngs.length }
    })
  }, [filteredTracks, tMs])

  const humanColor = '#2dd4bf'
  const botColor = '#f97316'

  const eventColor = (ev: string) => {
    if (ev === 'Kill' || ev === 'BotKill') return '#ef4444'
    if (ev === 'Killed' || ev === 'BotKilled') return '#a855f7'
    if (ev === 'Loot') return '#f59e0b'
    if (ev === 'KilledByStorm') return '#3b82f6'
    return '#e5e7eb'
  }

  function HeatLayerController() {
    const map = useMap()
    useEffect(() => {
      if (!heat) return
      const cell = heat.cell_size
      const pts: [number, number, number][] = heat.cells.map((c) => {
        // center of the cell
        const px = c.x * cell + cell / 2
        const py = c.y * cell + cell / 2
        return [py, px, c.value]
      })

      if (heatLayerRef.current) {
        map.removeLayer(heatLayerRef.current)
        heatLayerRef.current = null
      }

      if (pts.length === 0) return

      // Wait until Leaflet has a non-zero canvas size (prevents leaflet.heat getImageData width=0 crash).
      let cancelled = false
      const add = () => {
        if (cancelled) return
        const s = map.getSize()
        if (s.x === 0 || s.y === 0) {
          requestAnimationFrame(add)
          return
        }
        // @ts-expect-error leaflet.heat adds L.heatLayer at runtime
        const layer = L.heatLayer(pts, { radius: 18, blur: 14, maxZoom: 2 }) as L.Layer
        heatLayerRef.current = layer
        layer.addTo(map)
      }

      map.whenReady(() => {
        map.invalidateSize()
        requestAnimationFrame(add)
      })
      return () => {
        cancelled = true
        if (heatLayerRef.current) {
          map.removeLayer(heatLayerRef.current)
          heatLayerRef.current = null
        }
      }
    }, [map, heat])
    return null
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebarGlow" aria-hidden="true" />

        <div className="sidebarInner">
          <header className="card card--hero">
            <div className="heroTop">
              <div>
                <div className="title">Player Journey Viz</div>
               
              </div>
              <div className="pills">
                <span className="pill">1024×1024</span>
                <span className="pill">{selectedMap}</span>
              </div>
            </div>

            {error ? <div className="alert">{error}</div> : null}
          </header>

          <section className="card">
            <div className="cardTitle">Filters</div>
            <div className="grid">
              <div className="field">
                <div className="label">Map</div>
                <select value={selectedMap} onChange={(e) => setSelectedMap(e.target.value as MapId)}>
                  <option value="AmbroseValley">AmbroseValley</option>
                  <option value="GrandRift">GrandRift</option>
                  <option value="Lockdown">Lockdown</option>
                </select>
              </div>

              <div className="field">
                <div className="label">Date</div>
                <select value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}>
                  {(meta?.dates ?? []).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <div className="labelRow">
                  <span className="label">Match</span>
                  <span className="hint">{matches.length} found</span>
                </div>
                <select value={selectedMatchId ?? ''} onChange={(e) => setSelectedMatchId(e.target.value)}>
                  {matches.map((m) => (
                    <option key={m.match_id} value={m.match_id}>
                      {m.match_id} ({m.humans}H/{m.bots}B)
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="cardTitleRow">
              <div className="cardTitle">Playback</div>
              <div className="pill">{match ? `${formatMs(tMs)} / ${formatMs(match.duration_ms)}` : '—'}</div>
            </div>
            <div className="btnRow">
              <button onClick={() => setPlaying((p) => !p)} disabled={!match}>
                {playing ? 'Pause' : 'Play'}
              </button>
              <button onClick={() => setTMs(0)} disabled={!match}>
                Reset
              </button>
            </div>
            <input
              type="range"
              min={0}
              max={match?.duration_ms ?? 0}
              step={1}
              value={tMs}
              onChange={(e) => setTMs(Number(e.target.value))}
              disabled={!match}
            />
          </section>

          <section className="card">
            <div className="cardTitle">Layers</div>

            <div className="toggles">
              <label className="toggle">
                <input type="checkbox" checked={showHumans} onChange={(e) => setShowHumans(e.target.checked)} />
                <span className="toggleText">Humans</span>
              </label>
              <label className="toggle">
                <input type="checkbox" checked={showBots} onChange={(e) => setShowBots(e.target.checked)} />
                <span className="toggleText">Bots</span>
              </label>
              <label className="toggle">
                <input type="checkbox" checked={showEvents} onChange={(e) => setShowEvents(e.target.checked)} />
                <span className="toggleText">Events</span>
              </label>
            </div>

            <div className="field">
              <div className="labelRow">
                <span className="label">Heatmap</span>
                <span className="hint">{heat ? `${heat.cells.length} cells` : 'Loading…'}</span>
              </div>
              <select value={heatKind} onChange={(e) => setHeatKind(e.target.value as HeatKind)}>
                <option value="traffic">Traffic</option>
                <option value="kills">Kills</option>
                <option value="deaths">Deaths</option>
                <option value="storm_deaths">Storm deaths</option>
                <option value="loot">Loot</option>
              </select>
            </div>

            <div className="field">
              <div className="label">Movement sampling</div>
              <input type="range" min={0} max={1000} step={50} value={sampleMs} onChange={(e) => setSampleMs(Number(e.target.value))} />
              <div className="hint">{sampleMs === 0 ? 'No downsampling (full fidelity)' : `Downsample: ${sampleMs}ms`}</div>
            </div>
          </section>

          <footer className="legend card">
            <div className="legendRow">
              <span className="chip">
                <i className="swatch swatch--human" /> Human path
              </span>
              <span className="chip">
                <i className="swatch swatch--bot" /> Bot path
              </span>
              <span className="chip">
                <i className="swatch swatch--kill" /> Kill
              </span>
              <span className="chip">
                <i className="swatch swatch--death" /> Death
              </span>
              <span className="chip">
                <i className="swatch swatch--loot" /> Loot
              </span>
              <span className="chip">
                <i className="swatch swatch--storm" /> Storm
              </span>
            </div>
          </footer>
        </div>
      </aside>

      <main className="mapPane">
        <div className="mapFrame">
          <div className="mapBadges" aria-hidden="true">
            <span className="pill">
              Match: <b>{selectedMatchId ? selectedMatchId.slice(0, 8) : '—'}</b>
            </span>
            <span className="pill">
              Heat: <b>{heatKind}</b>
            </span>
            <span className="pill">
              Tracks: <b>{match ? match.tracks.length : 0}</b>
            </span>
            <span className="pill">
              Events: <b>{match ? match.events.length : 0}</b>
            </span>
          </div>

          <MapContainer
            crs={L.CRS.Simple}
            bounds={bounds}
            style={{ height: '100%', width: '100%' }}
            zoom={0}
            minZoom={-2}
            maxZoom={2}
            zoomControl={true}
          >
            <FitToBounds bounds={bounds} />
            <ImageOverlay url={MAP_IMAGE[selectedMap]} bounds={bounds} />
            <HeatLayerController />

            {trackPolylines.map((t) =>
              t.count >= 2 ? (
                <Polyline
                  key={t.key}
                  positions={t.latlngs}
                  pathOptions={{
                    color: t.isBot ? botColor : humanColor,
                    weight: t.isBot ? 2 : 2.5,
                    opacity: t.isBot ? 0.7 : 0.85,
                  }}
                />
              ) : null,
            )}

            {filteredEvents.map((e, i) => (
              <Marker
                key={`${e.user_id}-${i}-${e.t_ms}-${e.event}`}
                position={[e.py, e.px]}
                icon={
                  new L.DivIcon({
                    className: 'event-dot',
                    html: `<div class="dot" style="background:${eventColor(e.event)}"></div>`,
                    iconSize: [10, 10],
                    iconAnchor: [5, 5],
                  })
                }
              >
                <Tooltip>
                  <div className="tt">
                    <div className="ttTitle">
                      <b>{e.event}</b> <span className="ttMuted">@ {formatMs(e.t_ms)}</span>
                    </div>
                    <div className="ttMuted">{e.is_bot ? 'Bot' : 'Human'}: {e.user_id}</div>
                  </div>
                </Tooltip>
              </Marker>
            ))}
          </MapContainer>
        </div>
      </main>
    </div>
  )
}

export default App
