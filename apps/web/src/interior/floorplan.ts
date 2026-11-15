/**
 * A plausible floor plan for a real CoStar listing, from what the listing says: bedrooms,
 * bathrooms, living area, stories, garage and special rooms (den, office, dining, family, gym).
 * The kit has no room dimensions, so plans are generated (deterministically per listing):
 * public rooms along the front, a corridor, private rooms at the back (a common US layout),
 * each zone packed with a squarified treemap so rooms stay close to square.
 * Coordinates: metres, x across the width, z front (0) to back (d).
 */

export interface Home {
  id: number;
  mp: string | null;
  /** Matterport still serves this scan (checked by scripts/check-tours.py) */
  mpOk?: boolean;
  addr: string;
  city: string;
  st: string;
  lat: number;
  lng: number;
  beds: number;
  baths: number;
  sqft: number;
  stories: number;
  year?: number | null;
  garage: boolean;
  price?: number | null;
  rent?: boolean;
  style?: string | null;
  gym: boolean;
  rooms: string[];
  hardwood: boolean;
  thumb?: string | null;
  tags: string[];
  type?: string | null;
}

export type RoomType = 'living' | 'kitchen' | 'dining' | 'family' | 'office' | 'gym' | 'primary' | 'bed' | 'bath' | 'laundry' | 'hall' | 'garage';

export interface PlanRoom {
  id: string;
  type: RoomType;
  name: string;
  level: number;
  x: number;
  z: number;
  w: number;
  d: number;
  /** Door: which wall and where along it (0..1). */
  door: { wall: 'n' | 's' | 'e' | 'w'; at: number };
  /** Exterior walls with windows (daylight). */
  windows: ('n' | 's' | 'e' | 'w')[];
}

export interface Plan {
  homeId: number;
  w: number;
  d: number;
  levels: number;
  rooms: PlanRoom[];
  areaM2: number;
}

const SQFT = 0.092903;
const NAMES: Record<RoomType, string> = {
  living: 'Living room', kitchen: 'Kitchen', dining: 'Dining', family: 'Family room', office: 'Office', gym: 'Home gym',
  primary: 'Primary bedroom', bed: 'Bedroom', bath: 'Bathroom', laundry: 'Laundry', hall: 'Hall', garage: 'Garage',
};
/** Typical room sizes (m²) used as weights; scaled to fit the listing's real area. */
const TARGET: Record<RoomType, number> = { living: 24, kitchen: 14, dining: 11, family: 19, office: 10, gym: 15, primary: 17, bed: 12, bath: 5.5, laundry: 4.5, hall: 0, garage: 21 };
export const PUBLIC: RoomType[] = ['living', 'kitchen', 'dining', 'family', 'office', 'gym', 'laundry'];

interface Want { type: RoomType; area: number; name: string }
interface Rect { x: number; z: number; w: number; d: number }

function program(h: Home): Want[][] {
  const beds = Math.max(0, Math.min(7, Math.round(h.beds || 0)));
  const baths = Math.max(1, Math.min(6, h.baths || 1));
  const full = Math.max(1, Math.floor(baths));
  const half = baths - Math.floor(baths) >= 0.5 ? 1 : 0;
  const pub: Want[] = [{ type: 'living', area: TARGET.living, name: NAMES.living }, { type: 'kitchen', area: TARGET.kitchen, name: NAMES.kitchen }];
  const big = h.sqft >= 1700 || beds >= 3;
  if ((h.rooms.includes('dining') && h.sqft >= 900) || big) pub.push({ type: 'dining', area: TARGET.dining, name: NAMES.dining });
  if (h.rooms.includes('family') || h.sqft >= 2600) pub.push({ type: 'family', area: TARGET.family, name: NAMES.family });
  if ((h.rooms.includes('office') || h.rooms.includes('den')) && h.sqft >= 1100) pub.push({ type: 'office', area: TARGET.office, name: h.rooms.includes('den') ? 'Den' : NAMES.office });
  if (h.gym) pub.push({ type: 'gym', area: TARGET.gym, name: NAMES.gym });
  const priv: Want[] = [];
  // service rooms sit together off the hall
  if (h.sqft >= 1200) priv.push({ type: 'laundry', area: TARGET.laundry, name: NAMES.laundry });
  if (half) priv.push({ type: 'bath', area: 3.4, name: 'Powder room' });
  if (beds >= 1) priv.push({ type: 'primary', area: TARGET.primary, name: NAMES.primary });
  for (let i = 2; i <= beds; i++) priv.push({ type: 'bed', area: TARGET.bed, name: `Bedroom ${i}` });
  if (beds === 0) priv.push({ type: 'bed', area: 10, name: 'Sleeping area' });
  for (let i = 1; i <= full; i++) priv.push({ type: 'bath', area: i === 1 ? 6.5 : TARGET.bath, name: i === 1 ? 'Primary bath' : `Bath ${i}` });
  return [pub, priv];
}

/** Squarified treemap (Bruls et al. 2000): lays areas into a rectangle with near-square cells. */
export function squarify(areas: number[], r: Rect): Rect[] {
  const total = areas.reduce((a, b) => a + b, 0) || 1;
  const scale = (r.w * r.d) / total;
  const items = areas.map((a, i) => ({ a: a * scale, i })).sort((p, q) => q.a - p.a);
  const out: Rect[] = new Array(areas.length);
  let rect = { ...r };
  let row: typeof items = [];
  const worst = (rw: typeof items, side: number) => {
    const s = rw.reduce((t, x) => t + x.a, 0);
    let m = 0;
    for (const x of rw) m = Math.max(m, (side * side * x.a) / (s * s), (s * s) / (side * side * x.a));
    return m;
  };
  const lay = (rw: typeof items) => {
    const s = rw.reduce((t, x) => t + x.a, 0);
    if (rect.w >= rect.d) {
      const colW = s / rect.d;
      let z = rect.z;
      for (const x of rw) {
        const h = x.a / colW;
        out[x.i] = { x: rect.x, z, w: colW, d: h };
        z += h;
      }
      rect = { x: rect.x + colW, z: rect.z, w: rect.w - colW, d: rect.d };
    } else {
      const rowD = s / rect.w;
      let x0 = rect.x;
      for (const x of rw) {
        const w = x.a / rowD;
        out[x.i] = { x: x0, z: rect.z, w, d: rowD };
        x0 += w;
      }
      rect = { x: rect.x, z: rect.z + rowD, w: rect.w, d: rect.d - rowD };
    }
  };
  for (const it of items) {
    const side = Math.min(rect.w, rect.d);
    if (!row.length || worst([...row, it], side) <= worst(row, side)) row.push(it);
    else {
      lay(row);
      row = [it];
    }
  }
  if (row.length) lay(row);
  return out;
}

/** Balanced binary split: halve the list by area, cut the rectangle along its longer side. */
export function bsp(areas: number[], r: Rect): Rect[] {
  const idx = areas.map((a, i) => ({ a, i })).sort((p, q) => q.a - p.a);
  const out: Rect[] = new Array(areas.length);
  const go = (items: typeof idx, rc: Rect) => {
    if (items.length === 1) {
      out[items[0].i] = rc;
      return;
    }
    const tot = items.reduce((t, x) => t + x.a, 0);
    // greedy partition into two near-equal halves
    const A: typeof idx = [];
    const B: typeof idx = [];
    let sa = 0;
    let sb = 0;
    for (const x of items) (sa <= sb ? (A.push(x), (sa += x.a)) : (B.push(x), (sb += x.a)));
    const f = sa / tot;
    // try both cut directions; keep the one whose two halves are squarer
    const q = (a: Rect) => Math.min(a.w, a.d) / Math.max(a.w, a.d);
    const v: [Rect, Rect] = [{ x: rc.x, z: rc.z, w: rc.w * f, d: rc.d }, { x: rc.x + rc.w * f, z: rc.z, w: rc.w * (1 - f), d: rc.d }];
    const h: [Rect, Rect] = [{ x: rc.x, z: rc.z, w: rc.w, d: rc.d * f }, { x: rc.x, z: rc.z + rc.d * f, w: rc.w, d: rc.d * (1 - f) }];
    const [ra, rb] = Math.min(q(v[0]), q(v[1])) >= Math.min(q(h[0]), q(h[1])) ? v : h;
    go(A, ra);
    go(B, rb);
  };
  if (idx.length) go(idx, r);
  return out;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function makePlan(h: Home): Plan {
  // `stories` can be the building's height for condos: a unit only gets a 2nd floor if it's big enough
  const condo = /condo|apartment|unit/i.test(h.type ?? '') || (h.stories ?? 1) > 3;
  const levels = condo ? 1 : Math.max(1, Math.min(3, Math.round(h.stories || 1), Math.floor((h.sqft || 0) / 900) || 1));
  const livable = (h.sqft || 1500) * SQFT * 0.9; // ~10% walls and stairs
  const perLevel = livable / levels;
  const aspect = 1.35;
  const W = Math.sqrt(perLevel * aspect);
  const D = perLevel / W;
  const [pub, priv] = program(h);
  const HALL = 1.1;
  const rooms: PlanRoom[] = [];
  const zones: { wants: Want[]; level: number }[] = [];
  if (levels === 1) zones.push({ wants: [...pub], level: 0 }, { wants: [...priv], level: 0 });
  else {
    // Upstairs gets the bedrooms; ground keeps the public rooms plus a powder room
    zones.push({ wants: [...pub], level: 0 }, { wants: [...priv], level: 1 });
  }
  const pubArea = pub.reduce((s, x) => s + x.area, 0);
  const privArea = priv.reduce((s, x) => s + x.area, 0);
  let n = 0;
  const place = (wants: Want[], rect: Rect, level: number, doorWall: 'n' | 's') => {
    // Small service rooms (baths, laundry) share one cell, tiled on their own, so none of
    // them ends up as a sliver at the end of a row of big rooms.
    const main = wants.filter((x) => x.area >= 7);
    const small = wants.filter((x) => x.area < 7);
    const groups: Want[][] = [...main.map((x) => [x]), ...(small.length ? [small] : [])];
    const cells0 = bsp(
      groups.map((g) => g.reduce((t, x) => t + x.area, 0)),
      rect,
    );
    const cells: Rect[] = [];
    const order: Want[] = [];
    groups.forEach((g, gi) => {
      const c = cells0[gi];
      if (g.length === 1) {
        cells.push(c);
        order.push(g[0]);
        return;
      }
      const sub = bsp(
        g.map((x) => x.area),
        c,
      );
      g.forEach((x, k) => {
        cells.push(sub[k]);
        order.push(x);
      });
    });
    order.forEach((x, i) => {
      const c = cells[i];
      const windows: PlanRoom['windows'] = [];
      if (c.z <= 0.01) windows.push('n');
      if (c.z + c.d >= D - 0.01) windows.push('s');
      if (c.x <= 0.01) windows.push('w');
      if (c.x + c.w >= W - 0.01) windows.push('e');
      rooms.push({ id: `r${n++}`, type: x.type, name: x.name, level, x: r2(c.x), z: r2(c.z), w: r2(c.w), d: r2(c.d), door: { wall: doorWall, at: 0.5 }, windows: x.type === 'bath' || x.type === 'laundry' ? windows.slice(0, 1) : windows });
    });
  };
  if (levels === 1) {
    const front = (D - HALL) * (pubArea / (pubArea + privArea));
    place(pub, { x: 0, z: 0, w: W, d: front }, 0, 's');
    rooms.push({ id: `r${n++}`, type: 'hall', name: 'Hall', level: 0, x: 0, z: r2(front), w: r2(W), d: HALL, door: { wall: 'w', at: 0.5 }, windows: [] });
    place(priv, { x: 0, z: front + HALL, w: W, d: D - front - HALL }, 0, 'n');
  } else {
    place(pub, { x: 0, z: 0, w: W, d: D - HALL }, 0, 's');
    rooms.push({ id: `r${n++}`, type: 'hall', name: 'Entry & stairs', level: 0, x: 0, z: r2(D - HALL), w: r2(W), d: HALL, door: { wall: 'w', at: 0.5 }, windows: [] });
    place(priv, { x: 0, z: HALL, w: W, d: D - HALL }, 1, 'n');
    rooms.push({ id: `r${n++}`, type: 'hall', name: 'Landing', level: 1, x: 0, z: 0, w: r2(W), d: HALL, door: { wall: 'w', at: 0.5 }, windows: [] });
  }
  if (h.garage) rooms.push({ id: `r${n++}`, type: 'garage', name: 'Garage', level: 0, x: r2(W + 0.2), z: 0, w: 6.0, d: r2(Math.min(D, 6.5)), door: { wall: 'w', at: 0.3 }, windows: ['n'] });
  return { homeId: h.id, w: r2(W), d: r2(D), levels, rooms, areaM2: Math.round(livable) };
}

/** Rooms worth turning into a training space, best first (garage, gym, spare bedroom, office, family…). */
export function trainingCandidates(plan: Plan): PlanRoom[] {
  const rank: Partial<Record<RoomType, number>> = { gym: 0, garage: 1, bed: 2, office: 3, family: 4, living: 5 };
  return plan.rooms.filter((r) => rank[r.type] != null && r.w * r.d >= 8).sort((a, b) => rank[a.type]! - rank[b.type]! || b.w * b.d - a.w * a.d);
}
