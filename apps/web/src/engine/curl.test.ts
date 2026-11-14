import { describe, expect, it } from 'vitest';
import { CurlCoach, type ArmFrame } from './curl';
import { rotate } from './geometry';
import { idealAngle, IDEAL_CYCLE_SEC } from './ideal';

interface RepSpec {
  bottom?: number;
  top?: number;
  upSec?: number;
  downSec?: number;
  holdSec?: number;
  /** Peak extra upper-arm angle forward of the torso during the lift. */
  drift?: number;
  /** Peak trunk lean during the lift. */
  swing?: number;
}

const FPS = 30;
const UPPER = 120;
const FORE = 110;

/** Side-view arm (facing +x) for a given elbow angle, drift and trunk lean. */
function armAt(t: number, elbowAngle: number, drift: number, lean: number, vis = 0.95): ArmFrame {
  const rad = (d: number) => (d * Math.PI) / 180;
  // Trunk leans back (away from +x) by `lean` degrees: hip stays, shoulder moves.
  const hip = { x: 300, y: 400, v: vis };
  const [tx, ty] = rotate(0, -200, rad(-lean));
  const shoulder = { x: hip.x + tx, y: hip.y + ty, v: vis };
  // Upper arm points along the torso (down), rotated forward by `drift`.
  const down = { x: -tx / 200, y: -ty / 200 };
  const [ux, uy] = rotate(down.x, down.y, rad(-drift));
  const elbow = { x: shoulder.x + ux * UPPER, y: shoulder.y + uy * UPPER, v: vis };
  // Forearm: rotate the upper-arm direction forward by (180 - elbowAngle).
  const [fx, fy] = rotate(ux, uy, -rad(180 - elbowAngle));
  const wrist = { x: elbow.x + fx * FORE, y: elbow.y + fy * FORE, v: vis };
  return { t, shoulder, elbow, wrist, hip };
}

function simulate(specs: RepSpec[]): ArmFrame[] {
  const frames: ArmFrame[] = [];
  let t = 0;
  const push = (angle: number, drift: number, lean: number) => {
    frames.push(armAt(t, angle, drift, lean));
    t += 1000 / FPS;
  };
  for (const s of specs) {
    const bottom = s.bottom ?? 165, top = s.top ?? 40;
    const up = s.upSec ?? 2, down = s.downSec ?? 2.5, hold = s.holdSec ?? 0.5;
    const drift = s.drift ?? 0, swing = s.swing ?? 0;
    for (let i = 0; i < hold * FPS; i++) push(bottom, 0, 0);
    for (let i = 0; i <= up * FPS; i++) {
      const u = i / (up * FPS);
      push(bottom + (top - bottom) * u, drift * Math.sin(Math.PI * u), swing * Math.sin(Math.PI * u));
    }
    for (let i = 0; i <= down * FPS; i++) {
      const u = i / (down * FPS);
      push(top + (bottom - top) * u, 0, 0);
    }
  }
  for (let i = 0; i < FPS; i++) push(specs.at(-1)?.bottom ?? 165, 0, 0);
  return frames;
}

function run(specs: RepSpec[]) {
  const coach = new CurlCoach();
  const cues: string[] = [];
  for (const f of simulate(specs)) {
    const s = coach.update(f);
    if (s.cue) cues.push(s.cue);
  }
  return { coach, cues };
}

describe('CurlCoach', () => {
  it('counts clean reps and scores them 100', () => {
    const { coach } = run(Array(5).fill({}));
    expect(coach.reps).toHaveLength(5);
    for (const r of coach.reps) {
      expect(r.flags).toEqual([]);
      expect(r.score).toBe(100);
      expect(r.upSec).toBeGreaterThan(1.2);
      expect(r.downSec).toBeGreaterThan(1.5);
    }
  });

  it('praises every third clean rep', () => {
    const { cues } = run(Array(6).fill({}));
    expect(cues).toEqual(['Good. Full range, steady elbow.', 'Good. Full range, steady elbow.']);
  });

  it('does not count a half rep', () => {
    const { coach } = run([{ top: 110 }, {}]);
    expect(coach.reps).toHaveLength(1);
  });

  it('flags a short top', () => {
    const { coach, cues } = run([{ top: 75 }]);
    expect(coach.reps[0].flags).toContain('top');
    expect(cues[0]).toMatch(/top/);
  });

  it('flags a short bottom', () => {
    const { coach } = run([{ bottom: 148 }]);
    expect(coach.reps[0].flags).toContain('bottom');
  });

  it('flags elbow drift and body swing, swing cue wins', () => {
    const { coach, cues } = run([{ drift: 35, swing: 18 }]);
    expect(coach.reps[0].flags).toEqual(expect.arrayContaining(['swing', 'drift']));
    expect(cues[0]).toMatch(/swing/i);
    expect(coach.reps[0].score).toBe(50);
  });

  it('flags a fast lowering', () => {
    const { coach } = run([{ downSec: 0.5 }]);
    expect(coach.reps[0].flags).toContain('fastDown');
  });

  it('flags fatigue once when reps slow down', () => {
    const { coach, cues } = run([{}, {}, {}, { upSec: 3.2 }, { upSec: 3.4 }]);
    expect(coach.reps[3].flags).toContain('fatigue');
    expect(cues.filter((c) => /rack/.test(c))).toHaveLength(1);
  });

  it('pauses when the arm is not visible', () => {
    const coach = new CurlCoach();
    const s = coach.update(armAt(0, 160, 0, 0, 0.1));
    expect(s.visible).toBe(false);
    expect(coach.reps).toHaveLength(0);
  });

  it('summarises the set', () => {
    const { coach } = run([{}, { top: 75 }, { top: 75 }]);
    const sum = coach.summary();
    expect(sum.reps).toBe(3);
    expect(sum.topFix).toBe('top');
    expect(sum.avgScore).toBeCloseTo((100 + 80 + 80) / 3, 5);
  });
});

describe('idealAngle', () => {
  it('goes from bottom to top and back in one cycle', () => {
    expect(idealAngle(0).angle).toBe(165);
    expect(idealAngle(0.5 + 2 + 0.25).angle).toBe(40);
    expect(idealAngle(IDEAL_CYCLE_SEC - 0.001).angle).toBeCloseTo(165, 0);
  });
});
