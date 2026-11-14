import { useEffect, useRef, useState } from 'react';
import { rotate } from '../engine/geometry';
import { idealAngle, type IdealPhase } from '../engine/ideal';

const PHASE_LABEL: Record<IdealPhase, string> = {
  bottom: 'Arm straight, elbow by your side',
  up: 'Lift: about 2 seconds',
  top: 'Squeeze at the top',
  down: 'Lower slowly: 2 to 3 seconds',
};

/** Side-view stick figure performing an ideal curl at the target tempo. */
export function DemoFigure({ playing = true }: { playing?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<IdealPhase>('bottom');

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = 320, H = 360;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    const css = getComputedStyle(document.documentElement);
    const ink = css.getPropertyValue('--text').trim() || '#e8eef4';
    const accent = css.getPropertyValue('--accent').trim() || '#c6f432';
    const quiet = css.getPropertyValue('--muted').trim() || '#8a96a3';
    const t0 = performance.now();
    let raf = 0;
    let last: IdealPhase | null = null;

    const frame = (now: number) => {
      const { angle, phase: p } = idealAngle((now - t0) / 1000);
      if (p !== last) {
        last = p;
        setPhase(p);
      }
      ctx.clearRect(0, 0, W, H);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const shoulder = { x: 150, y: 110 }, hip = { x: 150, y: 220 };
      // Body: head, torso, legs.
      ctx.strokeStyle = quiet;
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(shoulder.x, shoulder.y);
      ctx.lineTo(hip.x, hip.y);
      ctx.lineTo(hip.x + 6, 285);
      ctx.lineTo(hip.x + 2, 345);
      ctx.moveTo(hip.x, hip.y);
      ctx.lineTo(hip.x - 6, 285);
      ctx.lineTo(hip.x - 10, 345);
      ctx.stroke();
      ctx.fillStyle = quiet;
      ctx.beginPath();
      ctx.arc(158, 72, 24, 0, Math.PI * 2);
      ctx.fill();
      // Working arm: upper arm pinned along the torso, forearm at the ideal angle.
      const elbow = { x: shoulder.x, y: shoulder.y + 70 };
      const [fx, fy] = rotate(0, 1, (-(180 - angle) * Math.PI) / 180);
      const wrist = { x: elbow.x + fx * 64, y: elbow.y + fy * 64 };
      ctx.strokeStyle = accent;
      ctx.lineWidth = 11;
      ctx.beginPath();
      ctx.moveTo(shoulder.x, shoulder.y);
      ctx.lineTo(elbow.x, elbow.y);
      ctx.lineTo(wrist.x, wrist.y);
      ctx.stroke();
      // Dumbbell.
      ctx.save();
      ctx.translate(wrist.x, wrist.y);
      ctx.rotate(Math.atan2(fy, fx));
      ctx.fillStyle = ink;
      ctx.fillRect(4, -16, 10, 32);
      ctx.restore();
      // Elbow angle readout.
      ctx.fillStyle = ink;
      ctx.font = '600 14px system-ui, sans-serif';
      ctx.fillText(`${Math.round(angle)}°`, elbow.x - 46, elbow.y + 5);
      if (playing) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  return (
    <figure className="demo">
      <canvas ref={ref} style={{ width: 320, height: 360 }} aria-label="Animated ideal bicep curl" />
      <figcaption className={`demo-phase phase-${phase}`}>{PHASE_LABEL[phase]}</figcaption>
    </figure>
  );
}
