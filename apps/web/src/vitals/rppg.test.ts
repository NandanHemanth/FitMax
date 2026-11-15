import { describe, expect, it } from 'vitest';
import { estimate, type Sample } from './rppg';

/** Synthetic face video: skin colour + a 0.3% blood-volume pulse (strongest in green),
 *  camera noise, slow lighting drift, and optional head motion that scales all channels. */
function face(bpm: number, seconds: number, opts: { fps?: number; noise?: number; motion?: number; seed?: number } = {}): Sample[] {
  const fps = opts.fps ?? 30;
  let s = opts.seed ?? 7;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5) * 2;
  const out: Sample[] = [];
  for (let i = 0; i < seconds * fps; i++) {
    const t = i / fps + rnd() * 0.004; // timestamp jitter
    const pulse = Math.sin(2 * Math.PI * (bpm / 60) * t) + 0.3 * Math.sin(4 * Math.PI * (bpm / 60) * t);
    const light = 1 + 0.02 * Math.sin(2 * Math.PI * 0.1 * t);
    const move = 1 + (opts.motion ?? 0) * Math.sin(2 * Math.PI * 0.35 * t);
    const n = opts.noise ?? 0.15;
    out.push({
      t,
      r: (180 * (1 + 0.001 * pulse) * light * move) + rnd() * n,
      g: (130 * (1 + 0.003 * pulse) * light * move) + rnd() * n,
      b: (110 * (1 + 0.0015 * pulse) * light * move) + rnd() * n,
    });
  }
  return out;
}

describe('webcam heart rate (POS rPPG)', () => {
  for (const bpm of [55, 72, 95, 130]) {
    it(`finds ${bpm} bpm within 3`, () => {
      const r = estimate(face(bpm, 15));
      expect(r.bpm).not.toBeNull();
      expect(Math.abs((r.bpm ?? 0) - bpm)).toBeLessThanOrEqual(3);
    });
  }
  it('cancels lighting and head motion that scale every colour equally', () => {
    const r = estimate(face(78, 15, { motion: 0.03 }));
    expect(Math.abs((r.bpm ?? 0) - 78)).toBeLessThanOrEqual(3);
  });
  it('works at a laptop-webcam 15 fps', () => {
    const r = estimate(face(66, 15, { fps: 15 }));
    expect(Math.abs((r.bpm ?? 0) - 66)).toBeLessThanOrEqual(3);
  });
  it('says nothing from noise alone', () => {
    const r = estimate(face(70, 15, { noise: 6 }).map((x) => ({ ...x, r: 180 + (x.r - 180), g: 130 + (x.g - 130) * 0 + (x.r - 180), b: 110 })));
    expect(r.bpm).toBeNull();
  });
  it('waits for enough video', () => {
    expect(estimate(face(70, 4)).bpm).toBeNull();
  });
});

import { breathFromMotion } from './rppg';
describe('breathing from shoulder motion', () => {
  const shoulders = (bpm: number, seconds: number, amp = 0.004, noise = 0.0012, drift = 0.01) => {
    let s = 3;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5) * 2;
    const out = [];
    for (let t = 0; t < seconds; t += 0.1 + rnd() * 0.02) out.push({ t, y: 0.62 + amp * Math.sin((2 * Math.PI * bpm * t) / 60) + noise * rnd() + (drift * t) / seconds });
    return out;
  };
  for (const bpm of [10, 14, 20, 28]) {
    it(`finds ${bpm}/min within 2`, () => {
      const r = breathFromMotion(shoulders(bpm, 35));
      expect(r.bpm).not.toBeNull();
      expect(Math.abs((r.bpm ?? 0) - bpm)).toBeLessThanOrEqual(2);
    });
  }
  it('does not report slow drift as breathing', () => {
    expect(breathFromMotion(shoulders(14, 35, 0, 0.0012, 0.03)).bpm).toBeNull();
  });
});
