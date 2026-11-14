export interface Pt {
  x: number;
  y: number;
  /** Landmark visibility, 0..1 (MediaPipe). */
  v: number;
}

/** Interior angle ABC in degrees (0..180), in pixel space. */
export function angleAt(a: Pt, b: Pt, c: Pt): number {
  const v1x = a.x - b.x, v1y = a.y - b.y;
  const v2x = c.x - b.x, v2y = c.y - b.y;
  return angleBetween(v1x, v1y, v2x, v2y);
}

/** Angle between two vectors, degrees (0..180). */
export function angleBetween(ax: number, ay: number, bx: number, by: number): number {
  const na = Math.hypot(ax, ay), nb = Math.hypot(bx, by);
  if (na === 0 || nb === 0) return 0;
  const cos = Math.min(1, Math.max(-1, (ax * bx + ay * by) / (na * nb)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Trunk lean: angle of the hip->shoulder line away from straight up, degrees. */
export function trunkLean(shoulder: Pt, hip: Pt): number {
  return angleBetween(shoulder.x - hip.x, shoulder.y - hip.y, 0, -1);
}

/** Rotate a vector by `rad` radians (screen coordinates, y down). */
export function rotate(x: number, y: number, rad: number): [number, number] {
  const c = Math.cos(rad), s = Math.sin(rad);
  return [x * c - y * s, x * s + y * c];
}

/** Exponential moving average that starts at the first sample. */
export class Ema {
  private value: number | null = null;
  constructor(private readonly alpha: number) {}
  next(x: number): number {
    this.value = this.value === null ? x : this.value + this.alpha * (x - this.value);
    return this.value;
  }
  reset(): void {
    this.value = null;
  }
}
