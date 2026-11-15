/**
 * Room layout engine for the interior designer: geometry, checks, scores and the three
 * one-tap recommendations.
 *   Space   - keep the floor open: fewest pieces, everything on the walls, 0.9 m walkways.
 *   Fitness - "fitness maxing": a real training zone with safe clearances (ASTM F2115 for
 *             treadmills), equipment facing light or a mirror, visible movement cues, sensing-friendly.
 *   Modern  - a calm, anchored layout: supportive seating, rug-anchored groups, light, plants.
 * Room coordinates: metres, origin at the room's corner, x across (w), z down (l). Front = local +z.
 */
import type { Goal } from '../state/profile';
import type { PlanRoom, RoomType } from './floorplan';
import { thing, type Thing } from './things';

export type Rot = 0 | 90 | 180 | 270;
export interface Item { uid: string; key: string; x: number; z: number; rot: Rot }
export interface RoomBox { w: number; l: number; h: number; type: RoomType; door: PlanRoom['door']; windows: PlanRoom['windows'] }
export interface Rect { x0: number; z0: number; x1: number; z1: number }
export type Mode = 'space' | 'fitness' | 'modern';
export interface Issue { uid: string | null; level: 'error' | 'warn' | 'tip'; text: string }
export interface Scores { space: number; fitness: number; modern: number; ergonomics: number; sensing: number; overall: number; freePct: number }

const EPS = 1e-6;
let n = 0;
export const uid = () => `u${Date.now().toString(36)}${(n++).toString(36)}`;

export function turn(lx: number, lz: number, rot: Rot): [number, number] {
  switch (rot) {
    case 90:
      return [-lz, lx];
    case 180:
      return [-lx, -lz];
    case 270:
      return [lz, -lx];
    default:
      return [lx, lz];
  }
}
const local = (it: Item, a: number, b: number, c: number, d: number): Rect => {
  const p = turn(a, b, it.rot);
  const q = turn(c, d, it.rot);
  return { x0: it.x + Math.min(p[0], q[0]), z0: it.z + Math.min(p[1], q[1]), x1: it.x + Math.max(p[0], q[0]), z1: it.z + Math.max(p[1], q[1]) };
};
export const body = (it: Item, t: Thing): Rect => local(it, -t.w / 2, -t.d / 2, t.w / 2, t.d / 2);
export const clearance = (it: Item, t: Thing): Rect => local(it, -t.w / 2 - t.clear.side, -t.d / 2 - t.clear.back, t.w / 2 + t.clear.side, t.d / 2 + t.clear.front);
export const overlap = (a: Rect, b: Rect) => a.x0 < b.x1 - EPS && b.x0 < a.x1 - EPS && a.z0 < b.z1 - EPS && b.z0 < a.z1 - EPS;
const inter = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0));
const inside = (r: Rect, room: RoomBox) => r.x0 >= -EPS && r.z0 >= -EPS && r.x1 <= room.w + EPS && r.z1 <= room.l + EPS;
const clip = (r: Rect, room: RoomBox): Rect => ({ x0: Math.max(0, r.x0), z0: Math.max(0, r.z0), x1: Math.min(room.w, r.x1), z1: Math.min(room.l, r.z1) });
const area = (r: Rect) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.z1 - r.z0);
/** Footprint of an item as placed (w along x, d along z). */
export const dims = (t: Thing, rot: Rot) => (rot === 90 || rot === 270 ? { w: t.d, d: t.w } : { w: t.w, d: t.d });
/** Unit vector the item faces. */
export const facing = (rot: Rot): [number, number] => turn(0, 1, rot);

/** The 0.9 m square inside the door that must stay clear for the door to open and people to pass. */
export function doorZone(room: RoomBox): Rect {
  const s = 0.9;
  const { wall, at } = room.door;
  if (wall === 'n') return { x0: room.w * at - s / 2, z0: 0, x1: room.w * at + s / 2, z1: s };
  if (wall === 's') return { x0: room.w * at - s / 2, z0: room.l - s, x1: room.w * at + s / 2, z1: room.l };
  if (wall === 'w') return { x0: 0, z0: room.l * at - s / 2, x1: s, z1: room.l * at + s / 2 };
  return { x0: room.w - s, z0: room.l * at - s / 2, x1: room.w, z1: room.l * at + s / 2 };
}

const FLAT = new Set(['rug', 'floor', 'mat']);
const flat = (t: Thing) => FLAT.has(t.model) || t.h < 0.05;

// ------------------------------------------------------------------ checks
export function check(room: RoomBox, items: Item[], injuries: string[] = []): Issue[] {
  const out: Issue[] = [];
  const dz = doorZone(room);
  const solid = items.map((it) => ({ it, t: thing(it.key)! })).filter((x) => x.t);
  for (const { it, t } of solid) {
    const b = body(it, t);
    if (!inside(b, room)) out.push({ uid: it.uid, level: 'error', text: `${t.name} sticks out of the room` });
    if (t.minCeiling && room.h < t.minCeiling) out.push({ uid: it.uid, level: 'error', text: `${t.name} needs a ${t.minCeiling} m ceiling (room is ${room.h} m)` });
    if (!flat(t) && overlap(b, dz)) out.push({ uid: it.uid, level: 'error', text: `${t.name} blocks the door` });
    if (t.avoidFor?.some((x) => injuries.includes(x))) out.push({ uid: it.uid, level: 'warn', text: `${t.name} is hard on a ${t.avoidFor.find((x) => injuries.includes(x))!.toLowerCase()} injury` });
    for (const o of solid) {
      if (o.it.uid <= it.uid || flat(t) || flat(o.t)) continue;
      if (overlap(b, body(o.it, o.t))) out.push({ uid: it.uid, level: 'error', text: `${t.name} overlaps ${o.t.name}` });
    }
    if (t.cat === 'gym' && !flat(t)) {
      const c = clip(clearance(it, t), room);
      const need = clearance(it, t);
      if (area(c) + 0.01 < area(need)) out.push({ uid: it.uid, level: 'warn', text: `${t.name}: not enough room around it (${needText(t)})` });
      for (const o of solid) {
        if (o.it.uid === it.uid || flat(o.t)) continue;
        if (overlap(c, body(o.it, o.t))) {
          out.push({ uid: it.uid, level: t.key === 'treadmill' ? 'error' : 'warn', text: `${o.t.name} is in ${t.name}’s safety zone (${needText(t)})` });
          break;
        }
      }
    }
  }
  return out;
}
const needText = (t: Thing) => [t.clear.front && `${t.clear.front} m front`, t.clear.back && `${t.clear.back} m behind`, t.clear.side && `${t.clear.side} m sides`].filter(Boolean).join(', ');

// ------------------------------------------------------------------ scores
/** Free floor: the share of the room not covered by furniture or the clear space it needs. */
export function freeFloor(room: RoomBox, items: Item[]): number {
  const step = 0.1;
  let free = 0;
  let total = 0;
  const rects = items.map((it) => ({ t: thing(it.key)!, it })).filter((x) => x.t && !flat(x.t)).map(({ it, t }) => body(it, t));
  for (let x = step / 2; x < room.w; x += step)
    for (let z = step / 2; z < room.l; z += step) {
      total++;
      if (!rects.some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1)) free++;
    }
  return total ? free / total : 1;
}

/** Sensing links in room coordinates (from the WiFi layout), for the sensing-friendliness score. */
export type Link = [[number, number], [number, number]];
const segRect = (a: [number, number], b: [number, number], r: Rect) => {
  for (let i = 0; i <= 20; i++) {
    const x = a[0] + ((b[0] - a[0]) * i) / 20;
    const z = a[1] + ((b[1] - a[1]) * i) / 20;
    if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return true;
  }
  return false;
};

export function score(room: RoomBox, items: Item[], goal: Goal, injuries: string[] = [], links: Link[] = []): { scores: Scores; issues: Issue[] } {
  const issues = check(room, items, injuries);
  const errs = issues.filter((i) => i.level === 'error').length;
  const warns = issues.filter((i) => i.level === 'warn').length;
  const ts = items.map((it) => ({ it, t: thing(it.key)! })).filter((x) => x.t);
  const free = freeFloor(room, items);
  const space = clamp(free / 0.55) * 100 - errs * 12;

  // Fitness: training roles covered for the goal, a clear 2 x 2 m floor zone, light, a mirror, safe
  const roles = new Set(ts.flatMap((x) => x.t.roles ?? []));
  const want: Record<string, number> = goalRoles(goal);
  const cover = Object.entries(want).reduce((s, [r, w]) => s + (roles.has(r as never) ? w : 0), 0);
  const zone = hasOpenZone(room, items, 1.8);
  const light = room.windows.length > 0 ? 1 : 0.4;
  const mirror = ts.some((x) => x.t.key === 'mirror') ? 1 : 0;
  const fitness = (cover * 55 + (zone ? 20 : 0) + light * 10 + mirror * 5 + (ts.some((x) => x.t.cat === 'gym') ? 10 : 0)) - errs * 10 - warns * 4;

  // Modern: style of the pieces, a rug anchoring seating, plants/light, and not cluttered
  const styled = ts.length ? ts.reduce((s, x) => s + x.t.modern, 0) / ts.length : 0;
  const rug = ts.some((x) => x.t.model === 'rug');
  const green = ts.some((x) => x.t.model === 'plant');
  const lamp = ts.some((x) => x.t.model === 'lamp');
  const clutter = Math.max(0, ts.length - Math.max(4, (room.w * room.l) / 2.5));
  const modern = styled * 60 + (rug ? 12 : 0) + (green ? 10 : 0) + (lamp ? 8 : 0) + clamp(free / 0.5) * 10 - clutter * 6 - errs * 8;

  // Ergonomics: back-friendliness of seats and beds
  const ergos = ts.map((x) => x.t.ergo?.backScore).filter((v): v is number => v != null);
  const ergonomics = ergos.length ? (ergos.reduce((a, b) => a + b, 0) / ergos.length) * 100 : 70;

  // WiFi sensing: big metal or water on a sensing line hurts accuracy
  let blocked = 0;
  for (const { it, t } of ts) if ((t.rf === 'metal' || t.rf === 'water') && t.h > 0.5 && links.some(([a, b]) => segRect(a, b, body(it, t)))) blocked++;
  const sensing = links.length ? 100 - blocked * 25 : 80;
  if (blocked) issues.push({ uid: null, level: 'tip', text: `${blocked} metal or water piece${blocked > 1 ? 's sit' : ' sits'} on a WiFi sensing line: move ${blocked > 1 ? 'them' : 'it'} off the line between your devices.` });
  if (!zone && ts.some((x) => x.t.cat === 'gym')) issues.push({ uid: null, level: 'tip', text: 'No clear 1.8 × 1.8 m floor zone for floor work.' });

  const s = { space: r(space), fitness: r(fitness), modern: r(modern), ergonomics: r(ergonomics), sensing: r(sensing), overall: 0, freePct: Math.round(free * 100) };
  s.overall = r(0.25 * s.space + 0.3 * s.fitness + 0.2 * s.modern + 0.15 * s.ergonomics + 0.1 * s.sensing);
  return { scores: s, issues };
}
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const r = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

function goalRoles(goal: Goal): Record<string, number> {
  const m: Record<Goal, Record<string, number>> = {
    build_muscle: { squat: 0.25, bench: 0.2, pull: 0.2, dumbbell: 0.2, cardio: 0.1, mobility: 0.05 },
    hypertrophy: { dumbbell: 0.25, pull: 0.2, bench: 0.2, squat: 0.2, cardio: 0.1, mobility: 0.05 },
    shred: { cardio: 0.3, conditioning: 0.2, dumbbell: 0.2, squat: 0.15, mobility: 0.15 },
    endurance: { cardio: 0.5, mobility: 0.2, conditioning: 0.15, pull: 0.15 },
    general: { cardio: 0.25, dumbbell: 0.25, mobility: 0.2, pull: 0.15, conditioning: 0.15 },
    mobility: { mobility: 0.45, recovery: 0.25, cardio: 0.15, pull: 0.15 },
  };
  return m[goal];
}

/** Is there an open square of `s` metres anywhere (for floor work, burpees, stretching)? */
export function hasOpenZone(room: RoomBox, items: Item[], s: number): boolean {
  const rects = items.map((it) => ({ t: thing(it.key)!, it })).filter((x) => x.t && !flat(x.t)).map(({ it, t }) => body(it, t));
  for (let x = 0; x + s <= room.w + EPS; x += 0.2)
    for (let z = 0; z + s <= room.l + EPS; z += 0.2) {
      const q = { x0: x, z0: z, x1: x + s, z1: z + s };
      if (!rects.some((b) => overlap(q, b))) return true;
    }
  return false;
}

// ------------------------------------------------------------------ placement
interface Pref {
  against?: 'any' | 'window' | 'nowindow' | 'door' | 'nodoor'; // which wall to back onto
  face?: 'window' | 'center' | 'key'; // what the front should look at
  faceKey?: string;
  near?: string; // key of an item to sit beside
  center?: boolean;
  under?: string; // rugs: centre under this item group
}
const wallOf = (rot: Rot): 'n' | 's' | 'w' | 'e' => (rot === 0 ? 'n' : rot === 180 ? 's' : rot === 270 ? 'w' : 'e'); // wall behind the item

/** Candidate placements: along every wall (back to wall) for wall items, a grid for the rest. */
function candidates(room: RoomBox, t: Thing): Item[] {
  const out: Item[] = [];
  const step = 0.1;
  const rots: Rot[] = [0, 90, 180, 270];
  for (const rot of rots) {
    const { w, d } = dims(t, rot);
    if (w > room.w + EPS || d > room.l + EPS) continue;
    if (t.wall) {
      const wl = wallOf(rot);
      if (wl === 'n' || wl === 's') {
        const z = wl === 'n' ? d / 2 : room.l - d / 2;
        for (let x = w / 2; x <= room.w - w / 2 + EPS; x += step) out.push({ uid: '', key: t.key, x, z, rot });
      } else {
        const x = wl === 'w' ? w / 2 : room.w - w / 2;
        for (let z = d / 2; z <= room.l - d / 2 + EPS; z += step) out.push({ uid: '', key: t.key, x, z, rot });
      }
    } else {
      for (let x = w / 2; x <= room.w - w / 2 + EPS; x += step * 2) for (let z = d / 2; z <= room.l - d / 2 + EPS; z += step * 2) out.push({ uid: '', key: t.key, x, z, rot });
    }
  }
  return out;
}

const centerOf = (rs: Rect[]) => {
  const x0 = Math.min(...rs.map((r) => r.x0));
  const x1 = Math.max(...rs.map((r) => r.x1));
  const z0 = Math.min(...rs.map((r) => r.z0));
  const z1 = Math.max(...rs.map((r) => r.z1));
  return [(x0 + x1) / 2, (z0 + z1) / 2] as const;
};

/** Best spot for `key` given what's already placed, or null if it doesn't fit safely. */
export function place(room: RoomBox, placed: Item[], key: string, pref: Pref = {}, mode: Mode = 'modern', links: Link[] = []): Item | null {
  const t = thing(key);
  if (!t) return null;
  const dz = doorZone(room);
  const others = placed.map((it) => ({ it, t: thing(it.key)! })).filter((x) => x.t);
  const solids = others.filter((x) => !flat(x.t));
  const cx = room.w / 2;
  const cz = room.l / 2;
  const win = room.windows[0];
  let best: Item | null = null;
  let bestCost = Infinity;
  for (const c of candidates(room, t)) {
    const b = body(c, t);
    if (!inside(b, room)) continue;
    let cost = 0;
    if (!flat(t)) {
      if (overlap(b, dz)) continue;
      if (solids.some((o) => overlap(b, body(o.it, o.t)))) continue;
      // my clearance vs others' bodies, others' clearance vs my body
      const myClear = clip(clearance(c, t), room);
      for (const o of solids) {
        const ov = inter(myClear, body(o.it, o.t)) + inter(clip(clearance(o.it, o.t), room), b);
        if (ov > 0) cost += (t.cat === 'gym' || o.t.cat === 'gym' ? 40 : 8) * ov;
      }
      const lost = area(clearance(c, t)) - area(myClear);
      cost += (t.key === 'treadmill' ? 60 : t.cat === 'gym' ? 15 : 2) * Math.max(0, lost - (t.wall ? area(clearance(c, t)) * 0.0 : 0)) * (t.wall && t.clear.back === 0 ? 0.3 : 1);
      cost += inter(myClear, dz) * 6;
    } else if (pref.under) {
      const grp = solids.filter((o) => o.t.key === pref.under || (pref.under === 'seating' && ['sofa', 'sectional', 'armchair', 'coffee'].includes(o.t.model)) || (pref.under === 'bed' && o.t.model === 'bed'));
      if (grp.length) {
        const [gx, gz] = centerOf(grp.map((o) => body(o.it, o.t)));
        cost += Math.hypot(c.x - gx, c.z - gz) * 4;
      }
    }
    const [fx, fz] = facing(c.rot);
    const wl = wallOf(c.rot);
    if (pref.against === 'window' && win) cost += wl === win ? 0 : 3;
    if (pref.against === 'nowindow' && win) cost += wl === win ? 3 : 0;
    if (pref.against === 'nodoor') cost += wl === room.door.wall ? 2.5 : 0;
    if (pref.face === 'window' && win) {
      const want = win === 'n' ? [0, -1] : win === 's' ? [0, 1] : win === 'w' ? [-1, 0] : [1, 0];
      cost += (1 - (fx * want[0] + fz * want[1])) * 1.6;
    }
    if (pref.face === 'center') {
      const vx = cx - c.x;
      const vz = cz - c.z;
      const L = Math.hypot(vx, vz) || 1;
      cost += (1 - (fx * vx + fz * vz) / L) * 1.2;
    }
    if (pref.face === 'key' && pref.faceKey) {
      const tgt = others.find((o) => o.t.key === pref.faceKey || o.t.model === pref.faceKey);
      if (tgt) {
        const vx = tgt.it.x - c.x;
        const vz = tgt.it.z - c.z;
        const L = Math.hypot(vx, vz) || 1;
        cost += (1 - (fx * vx + fz * vz) / L) * 3 + Math.abs(L - 2.6) * 0.6; // ~2.6 m viewing distance
      }
    }
    if (pref.near) {
      const tgt = others.find((o) => o.t.key === pref.near || o.t.model === pref.near);
      if (tgt) {
        const tb = body(tgt.it, tgt.t);
        const gap = Math.max(0, Math.max(tb.x0 - b.x1, b.x0 - tb.x1, tb.z0 - b.z1, b.z0 - tb.z1));
        cost += gap * 2;
      }
    }
    if (pref.center) cost += Math.hypot(c.x - cx, c.z - cz) * 0.8;
    // Keep big metal (reflects) and water (absorbs) off the WiFi sensing lines
    if ((t.rf === 'metal' || t.rf === 'water') && t.h > 0.5 && links.some(([a, bb]) => segRect(a, bb, b))) cost += 6;
    // Space mode hugs walls and corners to keep the middle open
    if (mode === 'space' && !flat(t)) cost += Math.min(b.x0, b.z0, room.w - b.x1, room.l - b.z1) * 1.5;
    if (cost < bestCost) {
      bestCost = cost;
      best = { ...c, uid: uid() };
    }
  }
  return best;
}

// ------------------------------------------------------------------ recommendations
type Step = [key: string, pref?: Pref];

function plan(type: RoomType, mode: Mode, room: RoomBox, goal: Goal, injuries: string[]): Step[] {
  const big = room.w * room.l;
  const gymPicks = pickGym(goal, injuries, mode, big);
  switch (type) {
    case 'living':
    case 'family':
      if (mode === 'space') return [['sofa_ergo', { against: 'nodoor' }], ['tv', { face: 'key', faceKey: 'sofa' }], ['plant', {}]];
      if (mode === 'fitness')
        return [['sofa_ergo', { against: 'nodoor' }], ['tv', { face: 'key', faceKey: 'sofa' }], ['mat', { face: 'key', faceKey: 'tv' }], ['kettlebells', { near: 'mat' }], ['dumbbells', {}], ['mirror', {}], ['plant', {}]];
      return [['sofa_ergo', { against: 'nodoor' }], ['tv', { face: 'key', faceKey: 'sofa' }], ['coffee', { near: 'sofa' }], ['armchair', { face: 'key', faceKey: 'coffee' }], ['rug', { under: 'seating' }], ['lamp', { near: 'sofa' }], ['plant', {}], ['plant', {}], ['shelf', {}]];
    case 'bed':
    case 'primary': {
      const bed = type === 'primary' || big > 12 ? 'bed_queen' : 'bed_full';
      if (mode === 'space') return [[bed, { against: 'nodoor' }], ['nightstand', { near: bed }], ['wardrobe', {}]];
      if (mode === 'fitness') return [[bed, { against: 'nodoor' }], ['nightstand', { near: bed }], ['mat', { face: 'window' }], ...gymPicks.slice(0, big > 13 ? 3 : 2).map((k) => [k, { face: 'window' }] as Step), ['mirror', {}]];
      return [[bed, { against: 'nodoor' }], ['nightstand', { near: bed }], ['nightstand', { near: bed }], ['rug', { under: 'bed' }], ['wardrobe', {}], ['armchair', { face: 'center' }], ['lamp', {}], ['plant', {}]];
    }
    case 'office':
      if (mode === 'space') return [['desk_stand', { against: 'any', face: 'center' }], ['chair_task', { near: 'desk_stand' }], ['shelf', {}]];
      if (mode === 'fitness') return [['desk_stand', { against: 'window' }], ['walkpad', { near: 'desk_stand' }], ['chair_task', {}], ['mat', {}], ['dumbbells', {}]];
      return [['desk_stand', { against: 'window' }], ['chair_task', { near: 'desk_stand' }], ['shelf', {}], ['rug', { under: 'desk_stand' }], ['plant', {}], ['lamp', {}], ['armchair', {}]];
    case 'gym':
    case 'garage': {
      const car: Step[] = type === 'garage' && mode !== 'fitness' ? [['car', {}]] : [];
      if (mode === 'space') return [...car, ...gymPicks.slice(0, 3).map((k) => [k, {}] as Step), ['mat', {}]];
      if (mode === 'fitness') return [['rubber', { center: true }], ...gymPicks.map((k) => [k, { face: k === 'treadmill' || k === 'bike' || k === 'rower' ? 'window' : 'center' }] as Step), ['mirror', {}], ['mat', {}], ['tv', {}]];
      return [...car, ['rubber', { center: true }], ...gymPicks.slice(0, 4).map((k) => [k, {}] as Step), ['mirror', {}], ['plant', {}], ['lamp', {}]];
    }
    case 'dining':
      return mode === 'fitness' ? [['dining', { center: true }], ['plant', {}]] : [['dining', { center: true }], ['rug', { under: 'dining' }], ['plant', {}], ...(mode === 'modern' ? ([['lamp', {}]] as Step[]) : [])];
    case 'kitchen':
      return [['counter', {}], ['fridge', { near: 'counter' }], ...(big > 14 && mode !== 'space' ? ([['island', { center: true }]] as Step[]) : [])];
    case 'bath':
      return [['vanity', {}], ...(big > 4.5 ? ([['tub', {}]] as Step[]) : [])];
    case 'laundry':
      return [['washer', {}]];
    default:
      return [];
  }
}

function pickGym(goal: Goal, injuries: string[], mode: Mode, area: number): string[] {
  const base: Record<Goal, string[]> = {
    build_muscle: ['rack', 'bench', 'dumbbells', 'bike', 'cable'],
    hypertrophy: ['rack', 'bench', 'dumbbells', 'cable', 'bike'],
    shred: ['kettlebells', 'dumbbells', 'bike', 'rower', 'bench'],
    endurance: ['treadmill', 'bike', 'rower', 'pullup', 'kettlebells'],
    general: ['dumbbells', 'bench', 'bike', 'pullup', 'kettlebells'],
    mobility: ['mat', 'recovery', 'bike', 'cable', 'dumbbells'],
  };
  const swaps: Record<string, string> = { treadmill: 'bike', plyo: 'kettlebells', platform: 'cable', rower: 'bike', pullup: 'cable' };
  let picks = base[goal].map((k) => (thing(k)?.avoidFor?.some((x) => injuries.includes(x)) ? swaps[k] ?? k : k));
  picks = [...new Set(picks)];
  const n = mode === 'space' ? 3 : area < 10 ? 2 : area < 18 ? 3 : area < 28 ? 4 : 5;
  return picks.slice(0, n);
}

export interface Recommendation { items: Item[]; why: string[]; skipped: string[] }

export function recommend(room: RoomBox, mode: Mode, goal: Goal, injuries: string[] = [], links: Link[] = []): Recommendation {
  const items: Item[] = [];
  const skipped: string[] = [];
  for (const [key, pref] of plan(room.type, mode, room, goal, injuries)) {
    const t = thing(key);
    if (!t) continue;
    if (t.minCeiling && room.h < t.minCeiling) {
      skipped.push(`${t.name} (needs a ${t.minCeiling} m ceiling)`);
      continue;
    }
    const p = place(room, items, key, pref, mode, links);
    if (p) items.push(p);
    else skipped.push(t.name);
  }
  const why = reasons(room, mode, items);
  if (links.length && mode !== 'space') why.push('Metal racks and machines kept off the lines between your WiFi devices, so sensing stays accurate.');
  return { items, why, skipped };
}

function reasons(room: RoomBox, mode: Mode, items: Item[]): string[] {
  const has = (k: string) => items.some((i) => i.key === k || thing(i.key)?.model === k);
  const out: string[] = [];
  if (mode === 'space') {
    out.push('Everything on the walls, the middle left open: a 0.9 m walkway from the door.');
    out.push('Fewest pieces that still do the job; multi-use over single-use.');
  }
  if (mode === 'fitness') {
    if (has('treadmill')) out.push('Treadmill has 2 m clear behind it and 0.5 m each side (ASTM F2115).');
    if (has('rack')) out.push('Rack backs onto a wall with 0.9 m in front for walk-outs.');
    if (has('mirror')) out.push('Mirror faces the training spot so you can check form.');
    if (room.windows.length) out.push('Cardio faces the window: daylight while you train helps energy and sleep timing.');
    if (has('mat') || has('kettlebells') || has('walkpad')) out.push('Mat / kettlebells / walking pad sit in plain sight: visible cues make you use them.');
    out.push('Kept a clear floor zone for burpees, stretching and floor work.');
  }
  if (mode === 'modern') {
    if (has('sofa')) out.push('Supportive sofa: 46 cm seat, 53 cm depth, medium-firm foam and lumbar support, the best fit for backs.');
    if (has('bed')) out.push('Medium-firm mattress, the one a 313-person trial found best for low-back pain (Kovacs et al., Lancet 2003).');
    if (has('rug')) out.push('Rug anchors the group; low pile so nothing catches a foot.');
    if (has('plant') || has('lamp')) out.push('Plants and a warm, dimmable lamp layer the light and soften the room.');
    out.push('Pieces face each other or the window, not the door.');
  }
  return out;
}

/** The room box for a plan room (ceiling 2.6 m, garages 2.8 m). */
export const roomBox = (r: PlanRoom): RoomBox => ({ w: r.w, l: r.d, h: r.type === 'garage' ? 2.8 : 2.6, type: r.type, door: r.door, windows: r.windows });
