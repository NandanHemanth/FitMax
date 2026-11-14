/**
 * Live view data for the Monitor tab.
 *  - demoFrame(): a scripted "day at home" so the full feature set can be shown with no hardware.
 *    It runs ~1 min per loop, with the sensing clock at 60x (1 real second = 1 minute at home).
 *  - hubLive(): the same live shape, built from a real RuView /sensing/latest response.
 */
import type { Motion, Reading, RvSensing } from './engine';

export interface LivePerson { x: number; y: number } // room coords, 0..1
export interface Live {
  energy: number; // motion energy 0..1
  breath: number | null; // breathing waveform sample -1..1 (null when unknown)
  hr: number | null;
  br: number | null;
  persons: LivePerson[];
  field: number[] | null; // 20x20 signal heatmap, 0..1
  activity: string;
  phase?: PhaseId;
  reps?: number;
  zone?: string;
}

export const GRID = 20;
export const DEMO_SPEED = 60; // sensing clock runs 60x real time in the demo

export type PhaseId = 'sleep' | 'wake' | 'walk' | 'workout' | 'cooldown' | 'sit' | 'walk2' | 'fall' | 'recover';
interface Phase { id: PhaseId; label: string; dur: number; motion: Motion; hr: [number, number]; br: number; path: [number, number][] }

/** Rooms/anchors in a one-room studio plan (0..1). */
export const ANCHORS: { name: string; x: number; y: number; w: number; h: number }[] = [
  { name: 'Bed', x: 0.06, y: 0.08, w: 0.3, h: 0.3 },
  { name: 'Workout mat', x: 0.62, y: 0.1, w: 0.3, h: 0.22 },
  { name: 'Sofa', x: 0.08, y: 0.62, w: 0.32, h: 0.16 },
  { name: 'Kitchen', x: 0.62, y: 0.66, w: 0.32, h: 0.26 },
];
const BED: [number, number] = [0.21, 0.23];
const MAT: [number, number] = [0.77, 0.21];
const SOFA: [number, number] = [0.24, 0.7];
const KITCHEN: [number, number] = [0.78, 0.79];
const FLOOR: [number, number] = [0.6, 0.62];

export const PHASES: Phase[] = [
  { id: 'sleep', label: 'Sleeping', dur: 7, motion: 'still', hr: [56, 56], br: 13, path: [BED] },
  { id: 'wake', label: 'Getting out of bed', dur: 2, motion: 'moving', hr: [62, 78], br: 16, path: [BED, [0.4, 0.3]] },
  { id: 'walk', label: 'Walking around', dur: 3, motion: 'moving', hr: [80, 88], br: 17, path: [[0.4, 0.3], [0.5, 0.5], MAT] },
  { id: 'workout', label: 'Home workout · squats', dur: 12, motion: 'active', hr: [100, 138], br: 27, path: [MAT] },
  { id: 'cooldown', label: 'Cooling down', dur: 3, motion: 'moving', hr: [130, 96], br: 21, path: [MAT, [0.5, 0.5], SOFA] },
  { id: 'sit', label: 'Sitting on the sofa', dur: 17, motion: 'still', hr: [72, 66], br: 14, path: [SOFA] },
  { id: 'walk2', label: 'Walking to the kitchen', dur: 3, motion: 'moving', hr: [74, 84], br: 16, path: [SOFA, [0.5, 0.6], FLOOR] },
  { id: 'fall', label: 'On the floor, not moving', dur: 6, motion: 'still', hr: [104, 92], br: 22, path: [FLOOR] },
  { id: 'recover', label: 'Back on their feet', dur: 3, motion: 'moving', hr: [90, 80], br: 18, path: [FLOOR, KITCHEN] },
];
export const LOOP = PHASES.reduce((s, p) => s + p.dur, 0); // seconds

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const along = (path: [number, number][], t: number): [number, number] => {
  if (path.length === 1) return path[0];
  const seg = Math.min(path.length - 2, Math.floor(t * (path.length - 1)));
  const u = t * (path.length - 1) - seg;
  return [lerp(path[seg][0], path[seg + 1][0], u), lerp(path[seg][1], path[seg + 1][1], u)];
};
// Cheap deterministic noise so the demo looks alive but repeats exactly
const noise = (t: number, k = 1) => Math.sin(t * 12.9898 * k + 78.233) * 0.5 + Math.sin(t * 4.1 * k) * 0.5;

export const zoneAt = (p: LivePerson) => ANCHORS.find((a) => p.x >= a.x - 0.05 && p.x <= a.x + a.w + 0.05 && p.y >= a.y - 0.05 && p.y <= a.y + a.h + 0.05)?.name ?? 'Open floor';

export function heatmap(persons: LivePerson[], energy: number, t: number): number[] {
  const out = new Array<number>(GRID * GRID);
  for (let j = 0; j < GRID; j++)
    for (let i = 0; i < GRID; i++) {
      const x = (i + 0.5) / GRID;
      const y = (j + 0.5) / GRID;
      let v = 0.06 + 0.04 * (noise(t + i * 0.37 + j * 0.91) * 0.5 + 0.5);
      for (const p of persons) {
        const d2 = (x - p.x) ** 2 + (y - p.y) ** 2;
        const spread = 0.012 + energy * 0.03;
        v += (0.35 + energy * 0.65) * Math.exp(-d2 / spread);
      }
      out[j * GRID + i] = Math.min(1, v);
    }
  return out;
}

/** Demo frame at `sec` seconds since the demo started; `startAt` anchors the sensing clock. */
export function demoFrame(sec: number, startAt: number): { reading: Reading; live: Live } {
  const loopT = ((sec % LOOP) + LOOP) % LOOP;
  let acc = 0;
  let phase = PHASES[0];
  for (const p of PHASES) {
    if (loopT < acc + p.dur) {
      phase = p;
      break;
    }
    acc += p.dur;
  }
  const u = (loopT - acc) / phase.dur; // 0..1 within phase
  const into = loopT - acc;

  let [x, y] = along(phase.path, u);
  let energy = 0;
  let reps: number | undefined;
  switch (phase.motion) {
    case 'still':
      energy = 0.03 + 0.02 * Math.abs(noise(sec, 0.3));
      break;
    case 'moving':
      energy = 0.4 + 0.12 * noise(sec, 0.8);
      break;
    case 'active': {
      const cyc = into / 2.2; // one squat every 2.2 s
      reps = Math.floor(cyc);
      energy = 0.55 + 0.4 * Math.abs(Math.sin(Math.PI * cyc));
      y += 0.03 * Math.sin(2 * Math.PI * cyc); // body moving down/up
      break;
    }
  }
  const fall = phase.id === 'fall' && into < 1.6;
  if (phase.id === 'fall' && into < 0.4) energy = 1; // impact spike

  const hr = Math.round(lerp(phase.hr[0], phase.hr[1], u) + 2 * noise(sec, 0.5));
  const br = Math.round(phase.br + noise(sec, 0.2));
  const breath = Math.sin(2 * Math.PI * (br / 60) * sec) * (phase.motion === 'still' ? 1 : 0.55) + 0.12 * noise(sec, 2);
  const persons = [{ x, y }];

  const reading: Reading = {
    at: startAt + sec * 1000 * DEMO_SPEED,
    reachable: true,
    source: 'demo',
    simulated: true,
    live: true,
    presence: true,
    persons: 1,
    motion: phase.motion,
    confidence: 0.86,
    breathing: { bpm: br, confidence: 0.82, abstained: null },
    heart: { bpm: hr, confidence: 0.78, abstained: null },
    fall,
    nodes: [
      { id: '1', rssi: Math.round(-41 + 3 * noise(sec, 0.4)) },
      { id: '2', rssi: Math.round(-48 + 3 * noise(sec, 0.6)) },
    ],
  };
  return {
    reading,
    live: { energy, breath, hr, br, persons, field: heatmap(persons, energy, sec), activity: phase.label, phase: phase.id, reps, zone: zoneAt(persons[0]) },
  };
}

/** Live view from a real RuView sensing frame (room assumed ~6 m across, hub at centre). */
export function hubLive(s: RvSensing | null, r: Reading): Live {
  const raw = s as (RvSensing & { persons?: { position?: number[] }[]; signal_field?: { values?: number[] } }) | null;
  const energy = Math.min(1, (s?.features?.motion_band_power ?? 0) / 30);
  const persons = r.presence
    ? (raw?.persons ?? [])
        .filter((p) => Array.isArray(p.position))
        .slice(0, Math.max(1, r.persons))
        .map((p) => ({ x: Math.min(0.95, Math.max(0.05, 0.5 + (p.position![0] ?? 0) / 6)), y: Math.min(0.95, Math.max(0.05, 0.5 + (p.position![2] ?? 0) / 6)) }))
    : [];
  let field: number[] | null = null;
  const vals = raw?.signal_field?.values;
  if (vals?.length === GRID * GRID) {
    const max = Math.max(...vals, 1e-6);
    field = vals.map((v) => v / max);
  }
  const label = !r.presence ? 'Nobody home' : r.motion === 'active' ? 'Very active' : r.motion === 'moving' ? 'Moving around' : 'Still';
  return { energy, breath: null, hr: r.heart.bpm, br: r.breathing.bpm, persons, field, activity: label };
}
