import maplibregl, { type GeoJSONSource, type Map as MLMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type * as GeoJSON from 'geojson';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AREAS, areaAt, geocode, loadArea, type Area } from '../places/data';
import { CATEGORY_LABEL, indexPlaces, NEAR_RADIUS, scoreHome, scoreTone, type Category, type HomeScore, type PlacesData } from '../places/score';
import { useApp } from '../state/app';
import { goalLabel } from '../state/profile';
import { IconCube, IconSearch } from '../ui/icons';

type Layer = 'gyms' | 'groceries' | 'parks' | 'outdoor' | 'physio' | 'cycleways' | 'trails';
const LAYERS: { id: Layer; label: string; color: string; line?: boolean }[] = [
  { id: 'gyms', label: 'Gyms', color: '#ff6b2c' },
  { id: 'groceries', label: 'Groceries', color: '#f5b524' },
  { id: 'parks', label: 'Parks', color: '#22c55e' },
  { id: 'outdoor', label: 'Courts & tracks', color: '#a855f7' },
  { id: 'physio', label: 'Physio', color: '#ec4899' },
  { id: 'cycleways', label: 'Bike lanes', color: '#3b82f6', line: true },
  { id: 'trails', label: 'Run trails', color: '#14b8a6', line: true },
];
const POINT_LAYERS = LAYERS.filter((l) => !l.line).map((l) => l.id) as Exclude<Layer, 'cycleways' | 'trails'>[];
const TONE_COLOR = { good: '#22c55e', ok: '#f5b524', low: '#94a0b4' };
const STYLE = { dark: 'https://tiles.openfreemap.org/styles/dark', light: 'https://tiles.openfreemap.org/styles/positron' };

type FC = GeoJSON.FeatureCollection;
const fc = (features: GeoJSON.Feature[]): FC => ({ type: 'FeatureCollection', features });

function circle(lon: number, lat: number, radiusM: number): GeoJSON.Feature {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * 2 * Math.PI;
    pts.push([lon + ((radiusM / 111_320) * Math.cos(a)) / Math.cos((lat * Math.PI) / 180), lat + (radiusM / 110_540) * Math.sin(a)]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [pts] } };
}

export function Places() {
  const { profile, theme } = useApp();
  const [area, setArea] = useState<Area>(AREAS[0]);
  const [data, setData] = useState<PlacesData | null>(null);
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [visible, setVisible] = useState<Record<Layer, boolean>>({ gyms: true, groceries: true, parks: true, outdoor: true, physio: true, cycleways: true, trails: true });
  const [limit, setLimit] = useState(() => (window.innerWidth < 960 ? 12 : 40));

  const mapRef = useRef<MLMap | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const styleReady = useRef(false);

  // ---- data ----
  useEffect(() => {
    let cancelled = false;
    setLoading(`Loading ${area.short}…`);
    setError('');
    setSelectedId(null);
    loadArea(area)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(`Couldn't load map data: ${(e as Error).message}`))
      .finally(() => !cancelled && setLoading(''));
    return () => {
      cancelled = true;
    };
  }, [area]);

  const input = useMemo(() => ({ goal: profile?.goal ?? 'general', injuries: profile?.injuries ?? [], diet: profile?.diet ?? [] }), [profile]);
  const scored = useMemo(() => {
    if (!data) return [];
    const idx = indexPlaces(data);
    return data.homes.map((h) => ({ home: h, score: scoreHome(h, idx, input) })).sort((a, b) => b.score.total - a.score.total);
  }, [data, input]);
  const byId = useMemo(() => new Map(scored.map((s) => [s.home.id, s])), [scored]);
  const focusId = hoverId ?? selectedId;
  const focus = focusId ? byId.get(focusId) ?? null : null;

  // ---- map setup ----
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE[theme],
      center: area.center,
      zoom: 12.6,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-left');
    mapRef.current = map;
    popupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Install sources + layers on every style load (theme switches replace the style).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const install = () => {
      const empty = fc([]);
      for (const id of ['cycleways', 'trails', ...POINT_LAYERS, 'homes', 'ring', 'focus-points', 'focus-lines'])
        if (!map.getSource(id)) map.addSource(id, id === 'homes' ? { type: 'geojson', data: empty, promoteId: 'id' } : { type: 'geojson', data: empty });
      const add = (spec: maplibregl.LayerSpecification) => !map.getLayer(spec.id) && map.addLayer(spec);
      add({ id: 'ring', type: 'fill', source: 'ring', paint: { 'fill-color': '#ff6b2c', 'fill-opacity': 0.07 } });
      add({ id: 'ring-line', type: 'line', source: 'ring', paint: { 'line-color': '#ff6b2c', 'line-width': 1.5, 'line-dasharray': [2, 2] } });
      add({ id: 'cycleways', type: 'line', source: 'cycleways', paint: { 'line-color': '#3b82f6', 'line-width': 2, 'line-opacity': 0.5 } });
      add({ id: 'trails', type: 'line', source: 'trails', paint: { 'line-color': '#14b8a6', 'line-width': 2, 'line-opacity': 0.5, 'line-dasharray': [1.5, 1.5] } });
      add({
        id: 'focus-lines',
        type: 'line',
        source: 'focus-lines',
        paint: { 'line-color': ['match', ['get', 'kind'], 'cycleways', '#3b82f6', '#14b8a6'], 'line-width': 4.5, 'line-opacity': 0.95 },
      });
      for (const l of LAYERS.filter((x) => !x.line))
        add({ id: l.id, type: 'circle', source: l.id, paint: { 'circle-color': l.color, 'circle-radius': 4, 'circle-opacity': 0.5, 'circle-stroke-width': 0 } });
      add({
        id: 'focus-points',
        type: 'circle',
        source: 'focus-points',
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': 7,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      });
      add({
        id: 'homes',
        type: 'circle',
        source: 'homes',
        paint: {
          'circle-color': ['match', ['get', 'tone'], 'good', TONE_COLOR.good, 'ok', TONE_COLOR.ok, TONE_COLOR.low],
          'circle-radius': ['case', ['boolean', ['feature-state', 'focus'], false], 11, 7],
          'circle-stroke-color': theme === 'dark' ? '#0b0f17' : '#ffffff',
          'circle-stroke-width': 2.5,
        },
      });
      add({
        id: 'home-labels',
        type: 'symbol',
        source: 'homes',
        minzoom: 14,
        layout: { 'text-field': ['to-string', ['get', 'score']], 'text-size': 10, 'text-font': ['Noto Sans Bold'], 'text-allow-overlap': true },
        paint: { 'text-color': '#0b0f17' },
      });
      styleReady.current = true;
      map.fire('fitmax:ready');
    };
    map.on('style.load', install);
    if (map.isStyleLoaded()) install();

    const enter = (e: maplibregl.MapLayerMouseEvent) => {
      map.getCanvas().style.cursor = 'pointer';
      const id = e.features?.[0]?.properties?.id as string | undefined;
      if (id) setHoverId(id);
    };
    const leave = () => {
      map.getCanvas().style.cursor = '';
      setHoverId(null);
    };
    const click = (e: maplibregl.MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id as string | undefined;
      if (id) setSelectedId(id);
    };
    map.on('mousemove', 'homes', enter);
    map.on('mouseleave', 'homes', leave);
    map.on('click', 'homes', click);
    return () => {
      map.off('style.load', install);
      map.off('mousemove', 'homes', enter);
      map.off('mouseleave', 'homes', leave);
      map.off('click', 'homes', click);
    };
  }, [theme]);

  // Theme switch: swap the basemap; layers are re-installed on style.load.
  const firstTheme = useRef(theme);
  useEffect(() => {
    if (theme === firstTheme.current) return;
    firstTheme.current = theme;
    styleReady.current = false;
    mapRef.current?.setStyle(STYLE[theme]);
  }, [theme]);

  // Push data into sources when data or style changes.
  const [styleTick, setStyleTick] = useState(0);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onReady = () => setStyleTick((t) => t + 1);
    map.on('fitmax:ready', onReady);
    return () => {
      map.off('fitmax:ready', onReady);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data || !styleReady.current) return;
    const set = (id: string, f: FC) => (map.getSource(id) as GeoJSONSource | undefined)?.setData(f);
    set('cycleways', fc(data.cycleways.map((c, i) => ({ type: 'Feature', properties: { idx: i }, geometry: { type: 'LineString', coordinates: c } }))));
    set('trails', fc(data.trails.map((c, i) => ({ type: 'Feature', properties: { idx: i }, geometry: { type: 'LineString', coordinates: c } }))));
    for (const k of POINT_LAYERS) set(k, fc(data[k].map((p) => ({ type: 'Feature', properties: { id: p.id, name: p.name }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } }))));
    set(
      'homes',
      fc(
        scored.map(({ home, score }) => ({
          type: 'Feature',
          properties: { id: home.id, name: home.name, score: score.total, tone: scoreTone(score.total) },
          geometry: { type: 'Point', coordinates: [home.lon, home.lat] },
        })),
      ),
    );
  }, [data, scored, styleTick]);

  // Fly to a new area.
  useEffect(() => {
    mapRef.current?.flyTo({ center: area.center, zoom: 12.6, duration: 1200, padding: mapPadding() });
  }, [area]);

  // Focus: ring + highlighted nearby features + dim the rest.
  const lastFocusFeature = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady.current || !data) return;
    const set = (id: string, f: FC) => (map.getSource(id) as GeoJSONSource | undefined)?.setData(f);
    if (lastFocusFeature.current) map.setFeatureState({ source: 'homes', id: lastFocusFeature.current }, { focus: false });
    const dim = focus ? 0.15 : 0.5;
    for (const l of POINT_LAYERS) map.getLayer(l) && map.setPaintProperty(l, 'circle-opacity', dim);
    for (const l of ['cycleways', 'trails']) map.getLayer(l) && map.setPaintProperty(l, 'line-opacity', focus ? 0.15 : 0.5);
    if (!focus) {
      set('ring', fc([]));
      set('focus-points', fc([]));
      set('focus-lines', fc([]));
      popupRef.current?.remove();
      lastFocusFeature.current = null;
      return;
    }
    const { home, score } = focus;
    const fid = home.id;
    map.setFeatureState({ source: 'homes', id: fid }, { focus: true });
    lastFocusFeature.current = fid;
    set('ring', fc([circle(home.lon, home.lat, NEAR_RADIUS)]));
    const pts: GeoJSON.Feature[] = [];
    for (const l of LAYERS.filter((x) => !x.line)) {
      if (!visible[l.id]) continue;
      for (const p of score.nearby[l.id as keyof HomeScore['nearby']] as { id: string; name: string | null; lon: number; lat: number }[])
        pts.push({ type: 'Feature', properties: { id: p.id, name: p.name, color: l.color }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } });
    }
    set('focus-points', fc(pts));
    const lines: GeoJSON.Feature[] = [];
    if (visible.cycleways) score.nearby.cycleways.forEach((i) => lines.push({ type: 'Feature', properties: { kind: 'cycleways' }, geometry: { type: 'LineString', coordinates: data.cycleways[i] } }));
    if (visible.trails) score.nearby.trails.forEach((i) => lines.push({ type: 'Feature', properties: { kind: 'trails' }, geometry: { type: 'LineString', coordinates: data.trails[i] } }));
    set('focus-lines', fc(lines));
    popupRef.current
      ?.setLngLat([home.lon, home.lat])
      .setHTML(`<strong>${escapeHtml(home.name ?? 'Home')}</strong><br/><span style="color:${TONE_COLOR[scoreTone(score.total)]};font-weight:800;font-size:18px">${score.total}</span> <span style="opacity:.7">FitMax Score</span>`)
      .addTo(map);
  }, [focus, data, visible, styleTick]);

  // Layer visibility toggles.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady.current) return;
    for (const l of LAYERS) map.getLayer(l.id) && map.setLayoutProperty(l.id, 'visibility', visible[l.id] ? 'visible' : 'none');
  }, [visible, styleTick]);

  // Selecting from the list flies to the home.
  useEffect(() => {
    const s = selectedId ? byId.get(selectedId) : null;
    if (s) mapRef.current?.flyTo({ center: [s.home.lon, s.home.lat], zoom: 14.6, duration: 900, padding: mapPadding() });
  }, [selectedId, byId]);

  const search = async () => {
    const q = query.trim();
    if (!q) return;
    const preset = AREAS.find((a) => a.short.toLowerCase().includes(q.toLowerCase()) || a.name.toLowerCase().includes(q.toLowerCase()));
    if (preset) return setArea(preset);
    setLoading(`Finding ${q}…`);
    try {
      const hit = await geocode(q);
      if (!hit) {
        setError(`No place found for "${q}".`);
        setLoading('');
        return;
      }
      setArea(areaAt(hit.center[0], hit.center[1]) ?? hit);
    } catch {
      setError('Search is unavailable right now.');
      setLoading('');
    }
  };

  const list = scored.filter((s) => !filter || (s.home.name ?? '').toLowerCase().includes(filter.toLowerCase()) || (s.home.addr ?? '').toLowerCase().includes(filter.toLowerCase()));
  const avg = scored.length ? Math.round(scored.reduce((n, s) => n + s.score.total, 0) / scored.length) : 0;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Places · find a home that trains with you</p>
          <h1>{area.short}</h1>
          <p className="muted">
            {scored.length ? `${scored.length} homes scored for ${goalLabel(input.goal)}${input.injuries.length ? ` with ${input.injuries.join(', ').toLowerCase()} in mind` : ''}. Area average ${avg}.` : 'Scoring homes…'}
          </p>
        </div>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <div style={{ position: 'relative' }}>
            <IconSearch size={16} style={{ position: 'absolute', left: 12, top: 15, color: 'var(--muted)' }} />
            <input className="input" style={{ paddingLeft: 34, width: 'min(320px, 70vw)' }} placeholder="Search a city or neighbourhood" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <button className="btn btn-primary">Go</button>
        </form>
      </div>

      <div className="places">
        <aside className="places-panel">
          <div className="segmented" style={{ alignSelf: 'flex-start' }}>
            {AREAS.map((a) => (
              <button key={a.id} className={a.id === area.id ? 'on' : ''} onClick={() => setArea(a)}>
                {a.short}
              </button>
            ))}
          </div>
          <div className="legend">
            {LAYERS.map((l) => (
              <button key={l.id} aria-pressed={visible[l.id]} onClick={() => setVisible({ ...visible, [l.id]: !visible[l.id] })}>
                <i className={l.line ? 'line' : ''} style={{ background: l.color }} /> {l.label}
                {data && <span className="muted">{(data[l.id] as unknown[]).length}</span>}
              </button>
            ))}
          </div>
          <input className="input" placeholder="Filter homes by name or street" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="card places-list" style={{ padding: 6 }}>
            {loading && <p className="small muted" style={{ padding: 10 }}>{loading}</p>}
            {error && <p className="small warn" style={{ padding: 10 }}>{error}</p>}
            {!loading && !list.length && !error && <p className="small muted" style={{ padding: 10 }}>No named homes in this area's map data.</p>}
            {list.slice(0, limit).map(({ home, score }) => (
              <button
                key={home.id}
                className={`home-item ${focusId === home.id ? 'on' : ''}`}
                onMouseEnter={() => setHoverId(home.id)}
                onMouseLeave={() => setHoverId(null)}
                onClick={() => setSelectedId(home.id)}
              >
                <span className={`score-badge ${scoreTone(score.total)}`}>{score.total}</span>
                <span style={{ minWidth: 0 }}>
                  <strong className="small" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {home.name}
                  </strong>
                  <span className="tiny muted">{home.addr ?? topReason(score)}</span>
                </span>
              </button>
            ))}
            {list.length > limit && (
              <button className="btn btn-ghost btn-block" onClick={() => setLimit(limit + 40)}>
                Show more ({list.length - limit})
              </button>
            )}
          </div>
        </aside>

        <div className="map-col">
          <div className="map-wrap">
            <div ref={containerRef} className="map" />
          </div>
          {focus ? (
            <ScoreCard name={focus.home.name ?? 'Home'} addr={focus.home.addr} score={focus.score} />
          ) : (
            <div className="map-card">
              <strong>Hover or tap a home</strong>
              <p className="small muted">See its FitMax Score and the gyms, groceries, parks, bike lanes and trails within a 15-minute walk.</p>
            </div>
          )}
          <p className="tiny muted" style={{ marginTop: 8 }}>
            Homes and amenities: {data?.source ?? 'OpenStreetMap contributors'}. Lease, sales and tenant data from CoStar, interiors from Matterport and
            aerial detections from Vexcel plug into the same score.
          </p>
        </div>
      </div>
    </>
  );
}

/** Keeps flown-to homes clear of the score card on wide screens. */
const mapPadding = () => (window.innerWidth >= 960 ? { top: 0, bottom: 0, left: 0, right: 380 } : { top: 0, bottom: 0, left: 0, right: 0 });

function topReason(s: HomeScore): string {
  const best = (Object.entries(s.categories) as [Category, HomeScore['categories'][Category]][]).filter(([, c]) => c.weight > 0).sort((a, b) => b[1].score - a[1].score)[0];
  return best ? best[1].reason : '';
}

function ScoreCard({ name, addr, score }: { name: string; addr?: string | null; score: HomeScore }) {
  const cats = (Object.entries(score.categories) as [Category, HomeScore['categories'][Category]][]).sort((a, b) => b[1].weight - a[1].weight);
  return (
    <div className="map-card">
      <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <span className={`score-badge ${scoreTone(score.total)}`} style={{ width: 56, height: 56, fontSize: 22 }}>
          {score.total}
        </span>
        <div style={{ minWidth: 0 }}>
          <strong>{name}</strong>
          <div className="tiny muted">{addr ?? 'FitMax Score'}</div>
          {score.weighting && <div className="tiny accent">Weighted: {score.weighting}</div>}
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        {cats.map(([k, c]) => (
          <div className="cat-row" key={k} style={{ opacity: c.weight === 0 ? 0.55 : 1 }}>
            <strong>{CATEGORY_LABEL[k]}</strong>
            <span className="num">
              {c.weight === 0 ? 'n/a' : c.score} <span className="tiny muted">· {Math.round(c.weight * 100)}%</span>
            </span>
            <div className={`bar ${c.score >= 75 ? '' : c.score >= 50 ? 'accent' : 'data'}`}>
              <div style={{ width: `${c.score}%` }} />
            </div>
            <span className="tiny muted" style={{ gridColumn: '1 / -1' }}>
              {c.reason}
            </span>
          </div>
        ))}
      </div>
      <button className="btn btn-block" style={{ marginTop: 10 }} disabled title="Next: 3D design with Matterport">
        <IconCube size={16} /> FitMax this home · 3D, coming next
      </button>
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
