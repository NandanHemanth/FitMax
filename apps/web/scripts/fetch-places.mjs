// Snapshots OpenStreetMap fitness data for the demo areas into public/data/places/<id>.json,
// so the Places map works instantly and offline during a demo. The app still queries
// Overpass live for any other area the user searches.
//
// Usage: node scripts/fetch-places.mjs [areaId ...]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'public/data/places');

export const AREAS = [
  { id: 'houston', name: 'Houston · Montrose, Midtown & the Heights', bbox: [29.725, -95.425, 29.805, -95.355], center: [-95.395, 29.757] },
  { id: 'la', name: 'Los Angeles · Santa Monica & Venice', bbox: [33.975, -118.505, 34.04, -118.43], center: [-118.475, 34.007] },
  { id: 'princeton', name: 'Princeton, NJ', bbox: [40.33, -74.69, 40.375, -74.62], center: [-74.659, 40.35] },
];

const ENDPOINTS = process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const r5 = (n) => Math.round(n * 1e5) / 1e5;

async function overpass(query) {
  let lastErr;
  for (const url of ENDPOINTS) {
    for (let attempt = 0; attempt < 15; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(query),
          signal: AbortSignal.timeout(90_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()).elements;
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }
  throw lastErr;
}

const point = (el) => {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  return lat == null ? null : { id: `${el.type[0]}${el.id}`, name: el.tags?.name ?? null, lon: r5(lon), lat: r5(lat) };
};

const line = (el) => (el.geometry?.length > 1 ? el.geometry.map((g) => [r5(g.lon), r5(g.lat)]) : null);

/** Category -> Overpass selector + how to keep it. */
const QUERIES = {
  gyms: { sel: ['nwr["leisure"="fitness_centre"]', 'nwr["leisure"="sports_centre"]', 'nwr["sport"="fitness"]', 'nwr["sport"="yoga"]'], out: 'center', as: 'point' },
  groceries: { sel: ['nwr["shop"~"^(supermarket|greengrocer|health_food|organic|farm)$"]', 'nwr["amenity"="marketplace"]'], out: 'center', as: 'point' },
  parks: { sel: ['way["leisure"="park"]', 'relation["leisure"="park"]', 'way["leisure"="nature_reserve"]'], out: 'center', as: 'point' },
  outdoor: { sel: ['nwr["leisure"="pitch"]', 'nwr["leisure"="track"]', 'nwr["leisure"="swimming_pool"]["access"!~"private"]', 'nwr["leisure"="fitness_station"]', 'nwr["natural"="beach"]'], out: 'center', as: 'point' },
  physio: { sel: ['nwr["healthcare"="physiotherapist"]', 'nwr["amenity"="physiotherapist"]', 'nwr["healthcare:speciality"~"physiotherapy|sports"]'], out: 'center', as: 'point' },
  cycleways: { sel: ['way["highway"="cycleway"]', 'way["cycleway"~"^(lane|track)$"]', 'way["cycleway:right"~"^(lane|track)$"]', 'way["cycleway:both"~"^(lane|track)$"]'], out: 'geom', as: 'line' },
  trails: { sel: ['way["highway"~"^(path|footway|track)$"]["name"]', 'way["leisure"="track"]'], out: 'geom', as: 'line' },
  homes: { sel: ['way["building"="apartments"]["name"]', 'way["building"="residential"]["name"]', 'nwr["building"="apartments"]["addr:housenumber"]["name"]'], out: 'center', as: 'home' },
};

async function fetchArea(area) {
  const [s, w, n, e] = area.bbox;
  const bbox = `(${s},${w},${n},${e})`;
  const data = { id: area.id, name: area.name, bbox: area.bbox, center: area.center, fetchedAt: new Date().toISOString(), source: 'OpenStreetMap contributors (ODbL), via Overpass API' };
  for (const [key, q] of Object.entries(QUERIES)) {
    // One selector per request: smaller queries survive busy Overpass servers.
    const els = [];
    for (const sel of q.sel) els.push(...(await overpass(`[out:json][timeout:80];${sel}${bbox};out ${q.out} qt;`)));
    if (q.as === 'line') {
      const seen = new Set();
      data[key] = els.filter((el) => !seen.has(el.id) && seen.add(el.id)).map(line).filter(Boolean);
    } else if (q.as === 'home') {
      const seen = new Set();
      data[key] = els
        .map((el) => {
          const p = point(el);
          if (!p || !p.name) return null;
          const k = p.name.toLowerCase();
          if (seen.has(k)) return null;
          seen.add(k);
          const t = el.tags ?? {};
          const addr = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ') || null;
          return { ...p, addr, levels: t['building:levels'] ? Number(t['building:levels']) : null };
        })
        .filter(Boolean);
    } else {
      const seen = new Set();
      data[key] = els
        .map(point)
        .filter((p) => p && !seen.has(p.id) && seen.add(p.id));
    }
    console.log(`  ${area.id}.${key}: ${data[key].length}`);
  }
  return data;
}

const wanted = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
for (const area of AREAS.filter((a) => !wanted.length || wanted.includes(a.id))) {
  console.log(`Fetching ${area.name}…`);
  const data = await fetchArea(area);
  writeFileSync(join(OUT, `${area.id}.json`), JSON.stringify(data));
}
console.log('done');
