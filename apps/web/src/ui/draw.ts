import type { Side } from '../engine/curl';
import { LM } from '../engine/curl';
import { rotate } from '../engine/geometry';
import { POSE_CONNECTIONS } from './pose';

interface L {
  x: number;
  y: number;
  visibility?: number;
}

export type ArmStatus = 'idle' | 'good' | 'fix';

const COLORS: Record<ArmStatus, string> = {
  idle: 'rgba(232,238,244,0.95)',
  good: '#22c55e',
  fix: '#f5b524',
};

/** Draws the faint full skeleton, the tracked arm in status colour, and the ideal-rep ghost. */
export function drawPose(
  ctx: CanvasRenderingContext2D,
  lm: L[] | undefined,
  side: Side | null,
  status: ArmStatus,
  ghostAngle: number | null,
): void {
  const { width: w, height: h } = ctx.canvas;
  ctx.clearRect(0, 0, w, h);
  if (!lm) return;
  const P = (i: number) => ({ x: lm[i].x * w, y: lm[i].y * h, v: lm[i].visibility ?? 0 });
  const unit = Math.max(2, Math.min(w, h) / 220);

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(232,238,244,0.35)';
  ctx.lineWidth = unit * 1.2;
  for (const c of POSE_CONNECTIONS) {
    const a = P(c.start), b = P(c.end);
    if (a.v < 0.5 || b.v < 0.5) continue;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  if (!side) return;

  const s = P(side === 'left' ? LM.leftShoulder : LM.rightShoulder);
  const e = P(side === 'left' ? LM.leftElbow : LM.rightElbow);
  const wr = P(side === 'left' ? LM.leftWrist : LM.rightWrist);
  const hip = P(side === 'left' ? LM.leftHip : LM.rightHip);
  const nose = P(LM.nose);

  // Ghost: the ideal arm at the target tempo, anchored to the user's shoulder.
  if (ghostAngle !== null && s.v > 0.5 && hip.v > 0.5 && e.v > 0.5 && wr.v > 0.5) {
    const upperLen = Math.hypot(e.x - s.x, e.y - s.y);
    const foreLen = Math.hypot(wr.x - e.x, wr.y - e.y);
    const tl = Math.hypot(hip.x - s.x, hip.y - s.y) || 1;
    const dx = (hip.x - s.x) / tl, dy = (hip.y - s.y) / tl;
    const facing = nose.v > 0.5 ? Math.sign(nose.x - s.x) || 1 : Math.sign(wr.x - e.x) || 1;
    const ge = { x: s.x + dx * upperLen, y: s.y + dy * upperLen };
    const [fx, fy] = rotate(dx, dy, (-facing * (180 - ghostAngle) * Math.PI) / 180);
    const gw = { x: ge.x + fx * foreLen, y: ge.y + fy * foreLen };
    ctx.setLineDash([unit * 3, unit * 3]);
    ctx.strokeStyle = 'rgba(120,200,255,0.85)';
    ctx.lineWidth = unit * 2.4;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(ge.x, ge.y);
    ctx.lineTo(gw.x, gw.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(120,200,255,0.85)';
    ctx.beginPath();
    ctx.arc(gw.x, gw.y, unit * 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Tracked arm + torso line.
  ctx.strokeStyle = COLORS[status];
  ctx.lineWidth = unit * 3.2;
  ctx.beginPath();
  ctx.moveTo(hip.x, hip.y);
  ctx.lineTo(s.x, s.y);
  ctx.lineTo(e.x, e.y);
  ctx.lineTo(wr.x, wr.y);
  ctx.stroke();
  ctx.fillStyle = COLORS[status];
  for (const p of [s, e, wr, hip]) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, unit * 3.4, 0, Math.PI * 2);
    ctx.fill();
  }
}
