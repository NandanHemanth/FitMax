import { useEffect, useRef } from 'react';
import type { Field, LinkView, NodeView } from './view';

const NODE_LABEL: Record<string, string> = { uno: 'UNO Q', ap: 'Phone hotspot', laptop: 'Laptop' };

/**
 * The room from above: the sensing devices, the radio links between them (brighter = more
 * disturbed), the radio-tomography heat map, and where the motion is. No camera involved.
 */
export function RoomView({ nodes, links, field, position, room, presence, label }: { nodes: NodeView[]; links: LinkView[]; field: Field | null; position: { x: number; y: number } | null; room: [number, number]; presence: boolean; label?: string }) {
  const W = 100;
  const H = Math.round((100 * room[1]) / room[0]);
  const at = (n: NodeView) => [n.x * W, n.y * H] as const;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return (
    <svg className="roomview" viewBox={`-6 -6 ${W + 12} ${H + 12}`} role="img" aria-label="Room seen through WiFi">
      <rect x={0} y={0} width={W} height={H} rx={3} className="rv-floor" />
      {field &&
        field.values.map((v, i) => {
          if (v < 0.18) return null;
          const cx = i % field.w;
          const cy = Math.floor(i / field.w);
          return <rect key={i} x={(cx * W) / field.w} y={(cy * H) / field.h} width={W / field.w + 0.2} height={H / field.h + 0.2} className="rv-heat" style={{ opacity: Math.min(0.85, v * 0.85) }} />;
        })}
      {links.map((l) => {
        const a = byId.get(l.a);
        const b = byId.get(l.b);
        if (!a || !b) return null;
        const [x1, y1] = at(a);
        const [x2, y2] = at(b);
        const hot = Math.max(0, Math.min(1, (l.z - 1) / 4));
        return (
          <g key={l.id} className={`rv-link ${l.kind} ${l.live ? '' : 'dead'}`}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} className="rv-link-base" />
            <line x1={x1} y1={y1} x2={x2} y2={y2} className="rv-link-hot" style={{ opacity: 0.15 + hot * 0.85, strokeWidth: 0.6 + hot * 2.4 }} />
          </g>
        );
      })}
      {position && presence && (
        <g transform={`translate(${position.x * W} ${position.y * H})`} className="rv-person">
          <circle r={7} className="rv-pulse" />
          <circle r={2.6} className="rv-dot" />
        </g>
      )}
      {nodes.map((n) => {
        const [x, y] = at(n);
        return (
          <g key={n.id} transform={`translate(${x} ${y})`} className="rv-node">
            <rect x={-2.6} y={-2.6} width={5.2} height={5.2} rx={1.2} transform="rotate(45)" />
            <text y={n.y > 0.8 ? -5 : 7.5} textAnchor="middle">
              {NODE_LABEL[n.id] ?? n.id}
            </text>
          </g>
        );
      })}
      {label && (
        <text x={W / 2} y={H / 2} textAnchor="middle" className="rv-label">
          {label}
        </text>
      )}
    </svg>
  );
}

const COLORS = ['var(--accent)', 'var(--data)', 'var(--good)', 'var(--violet)'];

/** Raw signal strength of every link, last ~12 s. Flat = still room, wiggles = motion, waves = reps. */
export function LinkScope({ series, height = 120 }: { series: { id: string; values: number[] }[]; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    c.width = w * dpr;
    c.height = height * dpr;
    const g = c.getContext('2d');
    if (!g) return;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, height);
    const css = getComputedStyle(c);
    const lane = height / Math.max(1, series.length);
    series.forEach((s, k) => {
      const vals = s.values.slice(-120);
      if (vals.length < 2) return;
      const lo = Math.min(...vals);
      const hi = Math.max(...vals);
      const span = Math.max(4, hi - lo); // at least 4 dB tall so noise looks like noise
      const mid = (hi + lo) / 2;
      const y0 = lane * k + lane / 2;
      g.beginPath();
      vals.forEach((v, i) => {
        const x = (i / 119) * w;
        const y = y0 - ((v - mid) / span) * (lane * 0.8);
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
      });
      const col = COLORS[k % COLORS.length].match(/--[\w-]+/)?.[0];
      g.strokeStyle = (col && css.getPropertyValue(col).trim()) || '#888';
      g.lineWidth = 1.6;
      g.lineJoin = 'round';
      g.stroke();
    });
  }, [series, height]);
  return <canvas ref={ref} className="linkscope" style={{ height }} />;
}

export const scopeColor = (k: number) => COLORS[k % COLORS.length];
