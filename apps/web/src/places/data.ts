/**
 * Places data: bundled OpenStreetMap snapshots for the demo areas, plus live Overpass
 * queries for anywhere else. CoStar property records, Matterport interiors and Vexcel
 * aerial detections plug in here through `enrich()` once the hackathon toolkit keys are set.
 */
import type { LngLat, PlacesData, Poi } from './score';

export interface Area {
  id: string;
  name: string;
  short: string;
  center: LngLat;
  bbox: [number, number, number, number];
}

export const AREAS: Area[] = [
  { id: 'houston', short: 'Houston', name: 'Houston · Montrose, Midtown & the Heights', bbox: [29.725, -95.425, 29.805, -95.355], center: [-95.395, 29.757] },
  { id: 'la', short: 'Los Angeles', name: 'Los Angeles · Santa Monica & Venice', bbox: [33.975, -118.505, 34.04, -118.43], center: [-118.475, 34.007] },
  { id: 'princeton', short: 'Princeton', name: 'Princeton, NJ', bbox: [40.33, -74.69, 40.375, -74.62], center: [-74.659, 40.35] },
];

const cache = new Map<string, PlacesData>();

export async function loadArea(area: Area): Promise<PlacesData> {
  if (cache.has(area.id)) return cache.get(area.id)!;
  try {
    const res = await fetch(`/data/places/${area.id}.json`);
    if (res.ok) {
      const data = (await res.json()) as PlacesData;
      cache.set(area.id, data);
      return data;
    }
  } catch {
    /* fall through to live */
  }
  const data = await fetchLive(area);
  cache.set(area.id, data);
  return data;
}

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

interface El {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}

async function overpass(q: string): Promise<El[]> {
  let last: unknown;
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      return ((await res.json()) as { elements: El[] }).elements;
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error('Map data service unavailable');
}

const r5 = (n: number) => Math.round(n * 1e5) / 1e5;

/** Live query for a searched area: two Overpass calls (points, lines), classified by tags. */
export async function fetchLive(area: Area): Promise<PlacesData> {
  const [s, w, n, e] = area.bbox;
  const b = `(${s},${w},${n},${e})`;
  const points = await overpass(
    `[out:json][timeout:60];(nwr["leisure"~"^(fitness_centre|sports_centre|park|pitch|track|fitness_station|nature_reserve)$"]${b};nwr["shop"~"^(supermarket|greengrocer|health_food|organic|farm)$"]${b};nwr["amenity"="marketplace"]${b};nwr["healthcare"="physiotherapist"]${b};way["building"="apartments"]["name"]${b};);out center qt;`,
  );
  const lines = await overpass(`[out:json][timeout:60];(way["highway"="cycleway"]${b};way["cycleway"~"^(lane|track)$"]${b};way["highway"~"^(path|footway|track)$"]["name"]${b};);out geom qt;`);
  const data: PlacesData = { id: area.id, name: area.name, bbox: area.bbox, center: area.center, source: 'OpenStreetMap contributors (ODbL), live via Overpass', fetchedAt: new Date().toISOString(), gyms: [], groceries: [], parks: [], outdoor: [], physio: [], cycleways: [], trails: [], homes: [] };
  for (const el of points) {
    const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;
    const t = el.tags ?? {};
    const p: Poi = { id: `${el.type[0]}${el.id}`, name: t.name ?? null, lon: r5(lon), lat: r5(lat) };
    if (t.building === 'apartments' && t.name) data.homes.push({ ...p, addr: [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ') || null });
    else if (t.leisure === 'fitness_centre' || t.leisure === 'sports_centre') data.gyms.push(p);
    else if (t.leisure === 'park' || t.leisure === 'nature_reserve') data.parks.push(p);
    else if (t.leisure) data.outdoor.push(p);
    else if (t.shop || t.amenity === 'marketplace') data.groceries.push(p);
    else if (t.healthcare) data.physio.push(p);
  }
  for (const el of lines) {
    if (!el.geometry || el.geometry.length < 2) continue;
    const line = el.geometry.map((g) => [r5(g.lon), r5(g.lat)] as LngLat);
    const t = el.tags ?? {};
    if (t.highway === 'cycleway' || t.cycleway) data.cycleways.push(line);
    else data.trails.push(line);
  }
  return data;
}

/** Geocodes a place name with OpenStreetMap Nominatim and returns a ~3 km search area. */
export async function geocode(q: string): Promise<Area | null> {
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const [hit] = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  if (!hit) return null;
  const lat = Number(hit.lat), lon = Number(hit.lon);
  const dLat = 0.022, dLon = 0.022 / Math.cos((lat * Math.PI) / 180);
  const short = hit.display_name.split(',').slice(0, 2).join(',');
  return { id: `q:${lat.toFixed(3)},${lon.toFixed(3)}`, short, name: short, center: [lon, lat], bbox: [lat - dLat, lon - dLon, lat + dLat, lon + dLon] };
}

/** Returns the bundled area containing a point, if any. */
export const areaAt = (lon: number, lat: number) => AREAS.find((a) => lat >= a.bbox[0] && lat <= a.bbox[2] && lon >= a.bbox[1] && lon <= a.bbox[3]);
