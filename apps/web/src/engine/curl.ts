import { angleAt, angleBetween, Ema, trunkLean, type Pt } from './geometry';

/**
 * Bicep-curl coach: turns per-frame arm landmarks into reps, per-rep metrics,
 * form flags, a form score and at most one spoken cue per rep.
 *
 * Thresholds are starting defaults to tune on real recordings, not published
 * cut-offs. Heuristics follow Pose Trainer (upper arm steady vs torso, full
 * range at the top) and the common faults in Wan et al. 2023 (trunk swing,
 * shoulder flexion / elbow drift).
 */
export const CURL_CONFIG = {
  /** Elbow angle above this = arm extended; a rep starts and ends here. */
  armAngle: 140,
  /** A rep only counts if the elbow closes below this. */
  repDepthAngle: 90,
  /** Top of the rep should reach this or lower ("squeeze to the top"). */
  goodTopAngle: 60,
  /** Bottom of the rep should open to this or higher ("straighten your arm"). */
  goodBottomAngle: 155,
  /** Upper arm moving forward vs the torso, degrees above its starting angle. */
  maxElbowDrift: 20,
  /** Trunk lean range within one rep, degrees. */
  maxSwing: 10,
  /** Lowering faster than this (seconds) is flagged. */
  minDownSec: 1.0,
  /** Lifting this much slower than the first two reps = fatigue. */
  fatigueRatio: 1.3,
  /** Landmarks below this visibility are treated as not seen. */
  minVisibility: 0.5,
  /** Smoothing for angles (0..1, higher = less smoothing). */
  emaAlpha: 0.45,
} as const;

export type CurlConfig = typeof CURL_CONFIG;
export type Side = 'left' | 'right';
export type Flag = 'swing' | 'drift' | 'top' | 'bottom' | 'fastDown' | 'fatigue';

export const FLAG_PENALTY: Record<Flag, number> = {
  swing: 25,
  drift: 25,
  top: 20,
  bottom: 10,
  fastDown: 10,
  fatigue: 0,
};

/** Spoken cue per flag, in priority order (first match wins). */
export const FLAG_CUE: Record<Flag, string> = {
  swing: 'No swinging. Lighten the weight.',
  drift: 'Pin your elbow to your side.',
  top: 'Squeeze all the way to the top.',
  bottom: 'Straighten your arm at the bottom.',
  fastDown: 'Slow the lowering.',
  fatigue: 'Two more, then rack it.',
};

export const FLAG_LABEL: Record<Flag, string> = {
  swing: 'Body swing',
  drift: 'Elbow drift',
  top: 'Short at the top',
  bottom: 'Short at the bottom',
  fastDown: 'Fast lowering',
  fatigue: 'Slowing down',
};

const CUE_PRIORITY: Flag[] = ['swing', 'drift', 'top', 'bottom', 'fastDown', 'fatigue'];

export interface ArmFrame {
  /** Timestamp in milliseconds. */
  t: number;
  shoulder: Pt;
  elbow: Pt;
  wrist: Pt;
  hip: Pt;
}

export interface Rep {
  index: number;
  startT: number;
  topT: number;
  endT: number;
  /** Most open elbow angle before the lift (bottom of the rep). */
  bottomAngle: number;
  /** Most closed elbow angle (top of the rep). */
  topAngle: number;
  rom: number;
  upSec: number;
  downSec: number;
  elbowDrift: number;
  swing: number;
  flags: Flag[];
  score: number;
}

export interface FrameState {
  visible: boolean;
  angle: number | null;
  drift: number | null;
  trunk: number | null;
  phase: Phase;
  rep?: Rep;
  cue?: string;
}

type Phase = 'waiting' | 'bottom' | 'lifting';

export interface SetSummary {
  reps: number;
  avgScore: number;
  timeUnderTensionSec: number;
  avgUpSec: number;
  avgDownSec: number;
  avgRom: number;
  flagCounts: Partial<Record<Flag, number>>;
  topFix: Flag | null;
}

/** MediaPipe Pose landmark indices. */
export const LM = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
} as const;

interface RawLandmark {
  x: number;
  y: number;
  visibility?: number;
}

/** Picks one arm out of a full MediaPipe landmark list, in pixel space. */
export function armFrom(lm: RawLandmark[], side: Side, t: number, w: number, h: number): ArmFrame {
  const p = (i: number): Pt => ({ x: lm[i].x * w, y: lm[i].y * h, v: lm[i].visibility ?? 0 });
  return side === 'left'
    ? { t, shoulder: p(LM.leftShoulder), elbow: p(LM.leftElbow), wrist: p(LM.leftWrist), hip: p(LM.leftHip) }
    : { t, shoulder: p(LM.rightShoulder), elbow: p(LM.rightElbow), wrist: p(LM.rightWrist), hip: p(LM.rightHip) };
}

/** The arm the camera sees best (mean visibility of shoulder, elbow, wrist, hip). */
export function betterSide(lm: RawLandmark[]): Side {
  const vis = (...ids: number[]) => ids.reduce((s, i) => s + (lm[i].visibility ?? 0), 0) / ids.length;
  const left = vis(LM.leftShoulder, LM.leftElbow, LM.leftWrist, LM.leftHip);
  const right = vis(LM.rightShoulder, LM.rightElbow, LM.rightWrist, LM.rightHip);
  return left >= right ? 'left' : 'right';
}

export class CurlCoach {
  readonly reps: Rep[] = [];
  private phase: Phase = 'waiting';
  private readonly angleEma: Ema;
  private readonly driftEma: Ema;
  private readonly trunkEma: Ema;
  private lastVisibleT = -Infinity;

  // per-rep accumulators
  private bottomMax = 0;
  private startDrift = 0;
  private startT = 0;
  private minAngle = 180;
  private minT = 0;
  private maxDrift = 0;
  private trunkMin = 180;
  private trunkMax = 0;
  private cleanStreak = 0;
  private fatigueCued = false;

  constructor(private readonly cfg: CurlConfig = CURL_CONFIG) {
    this.angleEma = new Ema(cfg.emaAlpha);
    this.driftEma = new Ema(cfg.emaAlpha);
    this.trunkEma = new Ema(cfg.emaAlpha);
  }

  isVisible(f: ArmFrame): boolean {
    const m = this.cfg.minVisibility;
    return f.shoulder.v >= m && f.elbow.v >= m && f.wrist.v >= m && f.hip.v >= m;
  }

  update(f: ArmFrame): FrameState {
    if (!this.isVisible(f)) {
      // After 1.5 s out of view, drop any half-finished rep.
      if (f.t - this.lastVisibleT > 1500 && this.phase !== 'waiting') {
        this.phase = 'waiting';
        this.angleEma.reset();
        this.driftEma.reset();
        this.trunkEma.reset();
      }
      return { visible: false, angle: null, drift: null, trunk: null, phase: this.phase };
    }
    this.lastVisibleT = f.t;

    const angle = this.angleEma.next(angleAt(f.shoulder, f.elbow, f.wrist));
    const drift = this.driftEma.next(
      angleBetween(f.elbow.x - f.shoulder.x, f.elbow.y - f.shoulder.y, f.hip.x - f.shoulder.x, f.hip.y - f.shoulder.y),
    );
    const trunk = this.trunkEma.next(trunkLean(f.shoulder, f.hip));
    const state: FrameState = { visible: true, angle, drift, trunk, phase: this.phase };
    const c = this.cfg;

    switch (this.phase) {
      case 'waiting':
        if (angle > c.armAngle) this.enterBottom(angle, drift, trunk);
        break;
      case 'bottom':
        if (angle > this.bottomMax) {
          this.bottomMax = angle;
          this.startDrift = drift;
        }
        this.trunkMin = Math.min(this.trunkMin, trunk);
        this.trunkMax = Math.max(this.trunkMax, trunk);
        if (angle < c.armAngle) {
          this.phase = 'lifting';
          this.startT = f.t;
          this.minAngle = angle;
          this.minT = f.t;
          this.maxDrift = drift;
          // Swing is measured from the moment the lift starts.
          this.trunkMin = trunk;
          this.trunkMax = trunk;
        }
        break;
      case 'lifting':
        if (angle < this.minAngle) {
          this.minAngle = angle;
          this.minT = f.t;
        }
        this.maxDrift = Math.max(this.maxDrift, drift);
        this.trunkMin = Math.min(this.trunkMin, trunk);
        this.trunkMax = Math.max(this.trunkMax, trunk);
        if (angle > c.armAngle) {
          if (this.minAngle < c.repDepthAngle) {
            const rep = this.finishRep(f.t);
            state.rep = rep;
            state.cue = this.cueFor(rep);
          }
          this.enterBottom(angle, drift, trunk);
        }
        break;
    }
    state.phase = this.phase;
    return state;
  }

  private enterBottom(angle: number, drift: number, trunk: number) {
    this.phase = 'bottom';
    this.bottomMax = angle;
    this.startDrift = drift;
    this.trunkMin = trunk;
    this.trunkMax = trunk;
  }

  private finishRep(endT: number): Rep {
    const c = this.cfg;
    const upSec = (this.minT - this.startT) / 1000;
    const downSec = (endT - this.minT) / 1000;
    const elbowDrift = Math.max(0, this.maxDrift - this.startDrift);
    const swing = this.trunkMax - this.trunkMin;
    const flags: Flag[] = [];
    if (swing > c.maxSwing) flags.push('swing');
    if (elbowDrift > c.maxElbowDrift) flags.push('drift');
    if (this.minAngle > c.goodTopAngle) flags.push('top');
    if (this.bottomMax < c.goodBottomAngle) flags.push('bottom');
    if (downSec < c.minDownSec) flags.push('fastDown');
    if (this.reps.length >= 3) {
      const base = (this.reps[0].upSec + this.reps[1].upSec) / 2;
      if (base > 0 && upSec > base * c.fatigueRatio) flags.push('fatigue');
    }
    const score = Math.max(0, 100 - flags.reduce((s, fl) => s + FLAG_PENALTY[fl], 0));
    const rep: Rep = {
      index: this.reps.length + 1,
      startT: this.startT,
      topT: this.minT,
      endT,
      bottomAngle: this.bottomMax,
      topAngle: this.minAngle,
      rom: this.bottomMax - this.minAngle,
      upSec,
      downSec,
      elbowDrift,
      swing,
      flags,
      score,
    };
    this.reps.push(rep);
    return rep;
  }

  /** At most one cue per rep; praise every third clean rep; fatigue said once. */
  private cueFor(rep: Rep): string | undefined {
    const flag = CUE_PRIORITY.find((fl) => rep.flags.includes(fl) && (fl !== 'fatigue' || !this.fatigueCued));
    if (flag) {
      this.cleanStreak = 0;
      if (flag === 'fatigue') this.fatigueCued = true;
      return FLAG_CUE[flag];
    }
    if (rep.flags.length === 0) {
      this.cleanStreak += 1;
      if (this.cleanStreak % 3 === 0) return 'Good. Full range, steady elbow.';
    }
    return undefined;
  }

  summary(): SetSummary {
    const n = this.reps.length;
    const avg = (fn: (r: Rep) => number) => (n ? this.reps.reduce((s, r) => s + fn(r), 0) / n : 0);
    const flagCounts: Partial<Record<Flag, number>> = {};
    for (const r of this.reps) for (const fl of r.flags) flagCounts[fl] = (flagCounts[fl] ?? 0) + 1;
    let topFix: Flag | null = null;
    for (const fl of CUE_PRIORITY) {
      if (fl === 'fatigue') continue;
      if ((flagCounts[fl] ?? 0) > (topFix ? flagCounts[topFix] ?? 0 : 0)) topFix = fl;
    }
    return {
      reps: n,
      avgScore: avg((r) => r.score),
      timeUnderTensionSec: this.reps.reduce((s, r) => s + (r.endT - r.startT) / 1000, 0),
      avgUpSec: avg((r) => r.upSec),
      avgDownSec: avg((r) => r.downSec),
      avgRom: avg((r) => r.rom),
      flagCounts,
      topFix,
    };
  }
}
