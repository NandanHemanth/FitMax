import { describe, expect, it } from 'vitest';
import { normalize } from './engine';
import { fromHub, kcalPerSecond, metFor, MET } from './view';

describe('hub v2 → widgets', () => {
  const s = {
    source: 'rssi',
    classification: { motion_level: 'active', presence: true, confidence: 0.9 },
    estimated_persons: 1,
    activity: 'exercising',
    zone: 'near uno↔ap',
    still_for_s: 0,
    persons: [{ position: [0.5, 0, -0.5] }],
    signal_field: { w: 2, h: 2, values: [0, 0.5, 1, 0.2] },
    links: [{ id: 'uno-ap', a: 'uno', b: 'ap', kind: 'wifi', rssi: -50, z: 4.2, live: true }],
    layout: { room: [4, 3] as [number, number], nodes: { uno: [0.3, 1.5] as [number, number], ap: [3.7, 1.5] as [number, number] } },
    exercise: { periodic: true, cadence_per_min: 24, reps: 12, sets: [{ reps: 10, cadence: 25, ended: 1 }] },
    breathing: { bpm: null, confidence: 0, why: 'lie still' },
    totals: { active_s: 600, intense_s: 120, present_s: 900, lying_s: 0, restless: 1 },
  };
  it('maps position, links, reps and totals', () => {
    const r = normalize(1, { status: 'ok', source: 'rssi', processing: { state: 'live' } }, s, null, null);
    const v = fromHub(s, r);
    expect(v.position).toEqual({ x: 0.625, y: 1 / 3 });
    expect(v.nodes).toHaveLength(2);
    expect(v.reps).toBe(12);
    expect(v.periodic).toBe(true);
    expect(v.sets[0].reps).toBe(10);
    expect(v.totals?.activeS).toBe(600);
    expect(v.activity).toBe('Exercising');
    expect(metFor(v, r.motion)).toBe(MET.exercise);
  });
  it('energy maths: 5 MET for 30 min at 75 kg ≈ 188 kcal', () => {
    expect(kcalPerSecond(5, 75) * 1800).toBeCloseTo(187.5, 1);
  });
});
