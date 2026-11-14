import { describe, expect, it } from 'vitest';
import { DEFAULT_WATCH, emptyWatch, step } from './engine';
import { demoFrame, GRID, LOOP } from './demo';

describe('demo scenario', () => {
  it('drives the real alert engine: one fall and one sedentary alert per loop', () => {
    const start = new Date(2026, 10, 14, 7, 0).getTime();
    let st = emptyWatch(start);
    const kinds: string[] = [];
    for (let s = 0; s <= LOOP; s += 0.1) {
      const o = step(st, demoFrame(s, start).reading, { ...DEFAULT_WATCH, inactivityMin: 15 });
      st = o.state;
      kinds.push(...o.raised.map((a) => a.kind));
    }
    expect(kinds.sort()).toEqual(['fall', 'inactivity']);
    // workout + walking ≈ 26 "minutes" of movement per loop
    expect(st.activeMs / 60_000).toBeGreaterThan(20);
    expect(st.alerts.every((a) => a.demo)).toBe(true);
  });
  it('counts squat reps and produces a full heatmap', () => {
    const f = demoFrame(7 + 2 + 3 + 9, 0).live; // 9 s into the workout
    expect(f.phase).toBe('workout');
    expect(f.reps).toBe(4);
    expect(f.field).toHaveLength(GRID * GRID);
    expect(f.zone).toBe('Workout mat');
  });
});
