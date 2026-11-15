/**
 * Layout geometry, safety checks, the FitMax Space score and the goal-based auto-layout.
 * Room coordinates: metres, origin at the room's top-left corner, x across the width (w), z down the length (l).
 * An item's "front" is its local +z; rot turns it clockwise in 90° steps.
 */
import type { Goal } from '../state/profile';
import { byKey, GOAL_PICKS, GOAL_ROLES, SWAPS, type ItemDef, type Role } from './catalog';

export interface Room {
  w: number;
  l: number;
  h: number;
}
export interface Placed {
  uid: string;
  key: string;
  x: number; // centre
  z: number;
  rot: 0 | 90 | 180 | 270;
}
export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}
export type Severity = 'error' | 'warn' | 'info';
export interface Issue {
  uid: string;
  severity: Severity;
  text: string;
}

const EPS = 1e-6;

/** Turns a local point (front = +z) by rot degrees clockwise (seen from above, z pointing down/south). */
function turn(lx: number, lz: number, rot: number): [number, number] {
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

function rectFromLocal(p: Placed, lx0: number, lz0: number, lx1: number, lz1: number): Rect {
  const a = turn(lx0, lz0, p.rot);
  const b = turn(lx1, lz1, p.rot);
  return { x0: p.x + Math.min(a[0], b[0]), z0: p.z + Math.min(a[1], b[1]), x1: p.x + Math.max(a[0], b[0]), z1: p.z + Math.max(a[1], b[1]) };
}

export const bodyRect = (p: Placed, d: ItemDef): Rect => rectFromLocal(p, -d.w / 2, -d.d / 2, d.w / 2, d.d / 2);
export const clearRect = (p: Placed, d: ItemDef): Rect =>
  rectFromLocal(p, -d.w / 2 - d.clear.side, -d.d / 2 - d.clear.back, d.w / 2 + d.clear.side, d.d / 2 + d.clear.front);

export const overlap = (a: Rect, b: Rect) => a.x0 < b.x1 - EPS && b.x0 < a.x1 - EPS && a.z0 < b.z1 - EPS && b.z0 < a.z1 - EPS;
export const inside = (r: Rect, room: Room) => r.x0 >= -EPS && r.z0 >= -EPS && r.x1 <= room.w + EPS && r.z1 <= room.l + EPS;
const area = (r: Rect) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.z1 - r.z0);

/** Safety and fit problems, per item. */
export function validate(room: Room, items: Placed[], defs: (k: string) => ItemDef | undefined, injuries: string[] = []): Issue[] {
  const out: Issue[] = [];
  for (const p of items) {
    const d = defs(p.key);
    if (!d) continue;
    const b = bodyRect(p, d);
    const c = clearRect(p, d);
    if (!inside(b, room)) out.push({ uid: p.uid, severity: 'error', text: `${d.name} sticks out of the room` });
    else if (!inside(c, room)) out.push({ uid: p.uid, severity: 'warn', text: `${d.name}: not enough free space around it (needs ${needText(d)})` });
    if (d.minCeiling && room.h < d.minCeiling) out.push({ uid: p.uid, severity: 'warn', text: `${d.name} needs a ${d.minCeiling.toFixed(2)} m ceiling; this room has ${room.h.toFixed(2)} m` });
    const hurt = d.avoidFor?.find((i) => injuries.includes(i));
    if (hurt) out.push({ uid: p.uid, severity: 'info', text: `${d.name} can aggravate a ${hurt.toLowerCase()} injury${SWAPS[d.key] ? `; consider a ${byKey(SWAPS[d.key])?.name.toLowerCase()}` : ''}` });
    for (const q of items) {
      if (q.uid === p.uid) continue;
      const e = defs(q.key);
      if (!e) continue;
      const qb = bodyRect(q, e);
      if (p.uid < q.uid && overlap(b, qb)) out.push({ uid: p.uid, severity: 'error', text: `${d.name} overlaps the ${e.name.toLowerCase()}` });
      else if (overlap(c, qb) && !overlap(b, qb)) out.push({ uid: p.uid, severity: 'warn', text: `${e.name} is inside the ${d.name.toLowerCase()}'s safety zone` });
    }
  }
  return out;
}

const needText = (d: ItemDef) => [d.clear.front && `${d.clear.front} m in front`, d.clear.back && `${d.clear.back} m behind`, d.clear.side && `${d.clear.side} m each side`].filter(Boolean).join(', ');

export interface SpaceScore {
  total: number;
  coverage: number; // 0..1 of the goal's training roles covered
  covered: Role[];
  missing: Role[];
  safety: number; // 0..1
  openFloor: number; // 0..1 of the floor left free of equipment bodies
  cost: number;
  budgetOk: boolean;
}

/** FitMax Space score: 50% goal coverage, 25% safety, 15% open floor, 10% budget. */
export function scoreSpace(room: Room, items: Placed[], defs: (k: string) => ItemDef | undefined, goal: Goal, budget: number, issues: Issue[]): SpaceScore {
  const weights = GOAL_ROLES[goal];
  const have = new Set<Role>();
  let cost = 0;
  let used = 0;
  for (const p of items) {
    const d = defs(p.key);
    if (!d) continue;
    d.roles.forEach((r) => have.add(r));
    cost += d.price;
    used += area(bodyRect(p, d));
  }
  const roles = Object.keys(weights) as Role[];
  const coverage = roles.reduce((s, r) => s + (have.has(r) ? weights[r] ?? 0 : 0), 0);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warns = issues.filter((i) => i.severity === 'warn').length;
  const safety = Math.max(0, 1 - errors * 0.35 - warns * 0.12);
  const openFloor = Math.max(0, 1 - used / (room.w * room.l));
  const openPts = Math.min(1, openFloor / 0.6); // ≥60% free floor = full marks
  const budgetOk = cost <= budget;
  const total = Math.round(50 * coverage + 25 * safety + 15 * openPts + 10 * (budgetOk ? 1 : Math.max(0, 1 - (cost - budget) / budget)));
  return { total, coverage, covered: roles.filter((r) => have.has(r)), missing: roles.filter((r) => !have.has(r)), safety, openFloor, cost, budgetOk };
}

let uidN = 0;
export const newUid = () => `i${Date.now().toString(36)}${(uidN++).toString(36)}`;

/** Where an item can go without errors or warnings, preferring its back to a wall. */
export function findSpot(room: Room, items: Placed[], key: string, defs: (k: string) => ItemDef | undefined, step = 0.1): Placed | null {
  const d = defs(key);
  if (!d) return null;
  let best: { p: Placed; cost: number } | null = null;
  const others = items.map((q) => ({ q, e: defs(q.key)! })).filter((o) => o.e);
  for (const rot of [0, 90, 180, 270] as const) {
    for (let x = 0; x <= room.w + EPS; x += step)
      for (let z = 0; z <= room.l + EPS; z += step) {
        const p: Placed = { uid: 'tmp', key, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, rot };
        const b = bodyRect(p, d);
        const c = clearRect(p, d);
        if (!inside(c, room)) continue;
        let ok = true;
        for (const { q, e } of others) {
          const qb = bodyRect(q, e);
          if (overlap(c, qb) || overlap(b, clearRect(q, e))) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        // Cost: hug walls (back to the wall for wall items), stay out of the middle of the floor
        const back = turn(0, -1, rot); // direction of the item's back
        const distBackWall = back[0] < 0 ? c.x0 : back[0] > 0 ? room.w - c.x1 : back[1] < 0 ? c.z0 : room.l - c.z1;
        const distAnyWall = Math.min(c.x0, c.z0, room.w - c.x1, room.l - c.z1);
        const cost = (d.wall ? distBackWall * 3 : 0) + distAnyWall + 0.01 * (x + z);
        if (!best || cost < best.cost) best = { p, cost };
      }
  }
  return best ? { ...best.p, uid: newUid() } : null;
}

export interface Recommendation {
  items: Placed[];
  skipped: { key: string; why: string }[];
  swapped: { from: string; to: string; injury: string }[];
}

/** Picks equipment for the goal, swaps around injuries, fits the budget and ceiling, then places it. */
export function recommend(room: Room, goal: Goal, budget: number, injuries: string[], defs: (k: string) => ItemDef | undefined = byKey): Recommendation {
  const items: Placed[] = [];
  const skipped: Recommendation['skipped'] = [];
  const swapped: Recommendation['swapped'] = [];
  let spent = 0;
  const seen = new Set<string>();
  for (let key of GOAL_PICKS[goal]) {
    let d = defs(key);
    const hurt = d?.avoidFor?.find((i) => injuries.includes(i));
    if (d && hurt && SWAPS[key]) {
      swapped.push({ from: key, to: SWAPS[key], injury: hurt });
      key = SWAPS[key];
      d = defs(key);
    } else if (hurt) {
      skipped.push({ key, why: `${hurt} injury` });
      continue;
    }
    if (!d || seen.has(key)) continue;
    seen.add(key);
    if (d.minCeiling && room.h < d.minCeiling) {
      skipped.push({ key, why: `needs a ${d.minCeiling} m ceiling` });
      continue;
    }
    if (spent + d.price > budget) {
      skipped.push({ key, why: 'over budget' });
      continue;
    }
    const spot = findSpot(room, items, key, defs);
    if (!spot) {
      skipped.push({ key, why: 'no room left with safe clearance' });
      continue;
    }
    items.push(spot);
    spent += d.price;
  }
  return { items, skipped, swapped };
}
