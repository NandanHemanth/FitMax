/**
 * The ideal bicep-curl rep used for the demo animation and the live "ghost".
 * Tempo: brief pause at the bottom, ~2 s up, short squeeze at the top,
 * ~2.5 s controlled lowering. Angles are the elbow angle (shoulder-elbow-wrist).
 */
export const IDEAL = {
  bottomAngle: 165,
  topAngle: 40,
  bottomHoldSec: 0.5,
  upSec: 2.0,
  topHoldSec: 0.5,
  downSec: 2.5,
} as const;

export const IDEAL_CYCLE_SEC = IDEAL.bottomHoldSec + IDEAL.upSec + IDEAL.topHoldSec + IDEAL.downSec;

const easeInOut = (u: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));

export type IdealPhase = 'bottom' | 'up' | 'top' | 'down';

/** Elbow angle of the ideal rep at time `t` seconds (loops every cycle). */
export function idealAngle(t: number): { angle: number; phase: IdealPhase } {
  const { bottomAngle: lo, topAngle: hi, bottomHoldSec, upSec, topHoldSec, downSec } = IDEAL;
  let u = ((t % IDEAL_CYCLE_SEC) + IDEAL_CYCLE_SEC) % IDEAL_CYCLE_SEC;
  if (u < bottomHoldSec) return { angle: lo, phase: 'bottom' };
  u -= bottomHoldSec;
  if (u < upSec) return { angle: lo + (hi - lo) * easeInOut(u / upSec), phase: 'up' };
  u -= upSec;
  if (u < topHoldSec) return { angle: hi, phase: 'top' };
  u -= topHoldSec;
  return { angle: hi + (lo - hi) * easeInOut(u / downSec), phase: 'down' };
}
