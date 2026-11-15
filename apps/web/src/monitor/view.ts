/**
 * One view model for the Monitor widgets, from either the scripted demo or the live hub.
 * Kept pure (no React) so it can be unit-tested.
 */
import type { Live } from './demo';
import type { Reading, RvSensing } from './engine';

export interface LinkView { id: string; a: string; b: string; kind: string; z: number; rssi: number | null; live: boolean; calibrated?: boolean; sparse?: boolean }
export interface NodeView { id: string; x: number; y: number } // 0..1 in the room
export interface SetView { reps: number; cadence: number | null; ended?: number }
export interface Field { w: number; h: number; values: number[] }

export interface MonView {
  activity: string;
  zone: string | null;
  presence: boolean;
  energy: number; // 0..1
  position: { x: number; y: number } | null; // 0..1
  field: Field | null;
  nodes: NodeView[];
  links: LinkView[];
  room: [number, number]; // metres
  reps: number;
  periodic: boolean;
  cadence: number | null;
  sets: SetView[];
  breathing: { bpm: number | null; confidence: number; why: string | null; experimental: boolean };
  heart: number | null;
  stillForS: number;
  interference: boolean;
  totals: { activeS: number; intenseS: number; presentS: number; lyingS: number; restless: number } | null;
  capabilities: Record<string, string> | null;
}

/** Hub v2 sensing frame (FitMax RSSI hub). Older hubs / RuView just lack the extra fields. */
export interface HubSensing extends RvSensing {
  activity?: string;
  zone?: string | null;
  still_for_s?: number;
  persons?: { position?: number[] }[];
  signal_field?: Field | null;
  links?: { id: string; a: string; b: string; kind: string; rssi: number | null; z: number; live: boolean; calibrated?: boolean; sparse?: boolean }[];
  layout?: { room: [number, number]; nodes: Record<string, [number, number]> };
  breathing?: { bpm: number | null; confidence: number; why?: string | null };
  interference?: boolean;
  totals?: { active_s: number; intense_s: number; present_s: number; lying_s: number; restless: number };
  exercise?: RvSensing['exercise'] & { sets?: { reps: number; cadence: number | null; ended?: number }[]; current_set?: { reps: number } | null };
  capabilities?: Record<string, string>;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const CAP = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function fromHub(s: HubSensing | null, r: Reading): MonView {
  const room = s?.layout?.room ?? [4, 3];
  const [W, H] = room;
  const nodes = Object.entries(s?.layout?.nodes ?? {}).map(([id, [x, y]]) => ({ id, x: clamp01(x / W), y: clamp01(y / H) }));
  const p = s?.persons?.[0]?.position;
  const position = r.presence && Array.isArray(p) ? { x: clamp01((p[0] + W / 2) / W), y: clamp01((p[2] + H / 2) / H) } : null;
  const ex = s?.exercise;
  const exercising = Boolean(ex?.periodic);
  const activity = !r.reachable ? 'Hub offline' : !r.presence ? 'Nobody home' : exercising ? 'Exercising' : s?.activity ? CAP(s.activity) : r.motion === 'active' ? 'Very active' : r.motion === 'moving' ? 'Moving' : 'Still';
  const t = s?.totals;
  return {
    activity,
    zone: s?.zone ?? null,
    presence: r.presence,
    energy: clamp01((s?.features?.motion_band_power ?? 0) / 30),
    position,
    field: s?.signal_field && s.signal_field.values?.length === s.signal_field.w * s.signal_field.h ? s.signal_field : null,
    nodes,
    links: (s?.links ?? []).map((l) => ({ ...l, z: l.z ?? 0 })),
    room,
    reps: ex?.reps ?? 0,
    periodic: exercising,
    cadence: ex?.cadence_per_min ?? null,
    sets: (ex?.sets ?? []).map((x) => ({ reps: x.reps, cadence: x.cadence ?? null, ended: x.ended })),
    breathing: { bpm: r.breathing.bpm, confidence: r.breathing.confidence ?? 0, why: s?.breathing?.why ?? r.breathing.abstained, experimental: s?.source === 'rssi' },
    heart: r.heart.bpm,
    stillForS: s?.still_for_s ?? 0,
    interference: Boolean(s?.interference),
    totals: t ? { activeS: t.active_s, intenseS: t.intense_s, presentS: t.present_s, lyingS: t.lying_s, restless: t.restless } : null,
    capabilities: s?.capabilities ?? null,
  };
}

/** Demo: the scripted day, laid out on the same three-node triangle as a real setup. */
export const DEMO_NODES: NodeView[] = [
  { id: 'uno', x: 0.04, y: 0.5 },
  { id: 'ap', x: 0.96, y: 0.5 },
  { id: 'laptop', x: 0.5, y: 0.96 },
];
const segDist = (p: { x: number; y: number }, a: NodeView, b: NodeView) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const u = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy));
};

export function fromDemo(l: Live, r: Reading, repsTotal: number): MonView {
  const pos = l.persons[0] ?? null;
  const links: LinkView[] = [
    ['uno', 'ap', 'wifi'],
    ['laptop', 'ap', 'wifi'],
    ['laptop', 'uno', 'ble'],
  ].map(([a, b, kind]) => {
    const na = DEMO_NODES.find((n) => n.id === a)!;
    const nb = DEMO_NODES.find((n) => n.id === b)!;
    const near = pos ? Math.exp(-((segDist(pos, na, nb) / 0.18) ** 2)) : 0;
    return { id: `${a}-${b}`, a, b, kind, z: 0.8 + l.energy * 6 * (0.25 + near), rssi: null, live: true, calibrated: true };
  });
  return {
    activity: l.activity,
    zone: l.zone ?? null,
    presence: r.presence,
    energy: l.energy,
    position: pos,
    field: l.field ? { w: 20, h: 20, values: l.field } : null,
    nodes: DEMO_NODES,
    links,
    room: [6, 6],
    reps: repsTotal,
    periodic: l.phase === 'workout',
    cadence: l.phase === 'workout' ? 27 : null,
    sets: [],
    breathing: { bpm: r.breathing.bpm, confidence: r.breathing.confidence ?? 0, why: null, experimental: false },
    heart: r.heart.bpm,
    stillForS: 0,
    interference: false,
    totals: null,
    capabilities: null,
  };
}

/** Energy burned at home from activity level (Compendium of Physical Activities METs). */
export const MET = { absent: 0, lying: 1.0, still: 1.3, moving: 2.8, active: 4.5, exercise: 5.0 } as const;
export const kcalPerSecond = (met: number, kg: number) => (met * kg) / 3600;
export function metFor(v: Pick<MonView, 'presence' | 'periodic' | 'activity' | 'stillForS'>, motion: Reading['motion']): number {
  if (!v.presence) return MET.absent;
  if (v.periodic) return MET.exercise;
  if (motion === 'active') return MET.active;
  if (motion === 'moving') return MET.moving;
  return v.stillForS >= 300 ? MET.lying : MET.still;
}
