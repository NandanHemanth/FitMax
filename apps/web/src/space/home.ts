/**
 * The home shell for the 3D builder: real building footprint + height from OpenStreetMap,
 * and a ground image (Vexcel aerial orthophoto when configured, else OpenStreetMap map tiles).
 * Local coordinates are metres east (x) / south (z) of the home point, so they map straight onto three.js.
 */
export interface SpaceHome {
  id: string;
  name: string;
  addr?: string | null;
  lat: number;
  lng: number;
  score?: number | null;
}

export interface Footprint {
  points: [number, number][]; // [x east, z south] metres, closed ring without the repeat
  height: number; // metres
  levels: number;
  areaM2: number;
  source: 'osm' | 'estimate';
  osmId?: number;
}

const M_PER_DEG = 111_320;
export const toLocal = (lat0: number, lng0: number, lat: number, lng: number): [number, number] => [
  (lng - lng0) * M_PER_DEG * Math.cos((lat0 * Math.PI) / 180),
  -(lat - lat0) * M_PER_DEG,
];

export function polygonArea(p: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, z1] = p[i];
    const [x2, z2] = p[(i + 1) % p.length];
    a += x1 * z2 - x2 * z1;
  }
  return Math.abs(a) / 2;
}

export function pointInPolygon(x: number, z: number, p: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i];
    const [xj, zj] = p[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Height from OSM tags: explicit height, else levels × 3 m, else 2 levels. */
export function heightFromTags(tags: Record<string, string> = {}): { height: number; levels: number } {
  const levels = Math.max(1, Math.round(Number.parseFloat(tags['building:levels'] ?? '') || 0)) || 2;
  const h = Number.parseFloat((tags.height ?? '').replace(/[^\d.]/g, ''));
  return { height: Number.isFinite(h) && h > 2 ? h : levels * 3, levels };
}

/** A plausible single-family footprint when OSM has no outline here. */
export const estimateFootprint = (): Footprint => ({
  points: [
    [-6, -5],
    [6, -5],
    [6, 5],
    [-6, 5],
  ],
  height: 6,
  levels: 2,
  areaM2: 120,
  source: 'estimate',
});

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

interface Way {
  id: number;
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}

/** Pick the building that contains the point, else the nearest one by centroid. */
export function pickFootprint(lat: number, lng: number, ways: Way[]): Footprint | null {
  let best: { f: Footprint; d: number } | null = null;
  for (const w of ways) {
    if (!w.geometry || w.geometry.length < 4) continue;
    const pts = w.geometry.map((g) => toLocal(lat, lng, g.lat, g.lon));
    if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
    const { height, levels } = heightFromTags(w.tags);
    const f: Footprint = { points: pts, height, levels, areaM2: Math.round(polygonArea(pts)), source: 'osm', osmId: w.id };
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const d = pointInPolygon(0, 0, pts) ? -1 : Math.hypot(cx, cz);
    if (!best || d < best.d) best = { f, d };
  }
  return best && best.d < 60 ? best.f : null;
}

export async function loadFootprint(lat: number, lng: number): Promise<Footprint> {
  const q = `[out:json][timeout:20];way(around:40,${lat},${lng})["building"];out geom tags;`;
  for (const url of ENDPOINTS) {
    try {
      const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(15_000) });
      if (!r.ok) continue;
      const { elements } = (await r.json()) as { elements: Way[] };
      return pickFootprint(lat, lng, elements) ?? estimateFootprint();
    } catch {
      /* try the next mirror */
    }
  }
  return estimateFootprint();
}

export interface Ground {
  url: string; // image URL or data URL
  sizeM: number; // the image covers sizeM × sizeM metres centred on the home
  source: 'vexcel' | 'osm';
  attribution: string;
}

export async function vexcelConfigured(): Promise<boolean> {
  try {
    const r = await fetch('/api/vexcel/config', { cache: 'no-store' });
    return r.ok && Boolean(((await r.json()) as { configured?: boolean }).configured);
  } catch {
    return false;
  }
}

/** Vexcel orthophoto through the server proxy; null if not configured or no coverage. */
export async function vexcelGround(lat: number, lng: number, sizeM = 60): Promise<Ground | null> {
  if (!(await vexcelConfigured())) return null;
  try {
    const r = await fetch(`/api/vexcel/ortho?lat=${lat}&lng=${lng}&size=${sizeM}`);
    if (!r.ok || !(r.headers.get('content-type') ?? '').startsWith('image/')) return null;
    return { url: URL.createObjectURL(await r.blob()), sizeM, source: 'vexcel', attribution: 'Aerial imagery © Vexcel' };
  } catch {
    return null;
  }
}

const tileXY = (lat: number, lng: number, z: number) => {
  const n = 2 ** z;
  const x = ((lng + 180) / 360) * n;
  const r = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  return { x, y };
};

/** Fallback ground: OpenStreetMap tiles (z19) stitched into a square centred on the home. */
export async function osmGround(lat: number, lng: number, sizeM = 60): Promise<Ground | null> {
  const z = 19;
  const mPerPx = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
  const px = Math.round(sizeM / mPerPx);
  const { x, y } = tileXY(lat, lng, z);
  const cx = x * 256;
  const cy = y * 256;
  const x0 = cx - px / 2;
  const y0 = cy - px / 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const jobs: Promise<void>[] = [];
  for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x0 + px) / 256); tx++)
    for (let ty = Math.floor(y0 / 256); ty <= Math.floor((y0 + px) / 256); ty++)
      jobs.push(
        new Promise((done) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            ctx.drawImage(img, tx * 256 - x0, ty * 256 - y0);
            done();
          };
          img.onerror = () => done();
          img.src = `https://tile.openstreetmap.org/${z}/${tx}/${ty}.png`;
        }),
      );
  await Promise.all(jobs);
  try {
    return { url: canvas.toDataURL('image/png'), sizeM: px * mPerPx, source: 'osm', attribution: 'Map © OpenStreetMap contributors' };
  } catch {
    return null; // tainted canvas (tiles blocked)
  }
}
