/**
 * Widget kit: small cards with one number each, details on tap. Keeps screens scannable.
 *   <Bento>                      responsive grid
 *   <Widget label value sub …>   one glanceable fact; onOpen shows a <Sheet> with the details
 *   <Spark data />               tiny trend line
 *   <Ring value max />           progress ring
 */
import { useEffect, type CSSProperties, type ReactNode } from 'react';

export type Tone = 'accent' | 'good' | 'data' | 'warn' | 'danger' | 'muted';

export function Bento({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bento ${className}`}>{children}</div>;
}

export function Widget({
  label,
  icon,
  value,
  unit,
  sub,
  tone,
  live,
  span = 1,
  tall,
  onOpen,
  badge,
  children,
  className = '',
  style,
}: {
  label: string;
  icon?: ReactNode;
  value?: ReactNode;
  unit?: string;
  sub?: ReactNode;
  tone?: Tone;
  live?: boolean;
  span?: 1 | 2 | 3 | 4;
  tall?: boolean;
  onOpen?: () => void;
  badge?: ReactNode;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  // A div with button semantics, so widgets can hold their own buttons (chips, toggles)
  return (
    <div
      className={`widget span-${span} ${tall ? 'tall' : ''} ${tone ? `tone-${tone}` : ''} ${onOpen ? 'clickable' : ''} ${className}`}
      onClick={onOpen}
      style={style}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onKeyDown={onOpen ? (e) => (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && (e.preventDefault(), onOpen()) : undefined}
    >
      <div className="w-head">
        <span className="w-label">
          {icon}
          {label}
        </span>
        {live && <span className="w-live" aria-label="live" />}
        {badge}
      </div>
      {value !== undefined && (
        <div className="w-value num">
          {value}
          {unit && <span className="w-unit">{unit}</span>}
        </div>
      )}
      {sub && <div className="w-sub">{sub}</div>}
      {children}
    </div>
  );
}

export function Sheet({ title, onClose, children, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div className={`sheet ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Spark({ data, max, min = 0, height = 34, color = 'var(--accent)', fill = true }: { data: number[]; max?: number; min?: number; height?: number; color?: string; fill?: boolean }) {
  const w = 120;
  const n = Math.max(2, data.length);
  const hi = max ?? Math.max(min + 1e-6, ...data);
  const lo = Math.min(min, ...data);
  const pts = data.map((v, i) => [(i / (n - 1)) * w, height - 2 - ((v - lo) / (hi - lo || 1)) * (height - 4)] as const);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" aria-hidden>
      {fill && data.length > 1 && <path d={`${d}L${w},${height}L0,${height}Z`} fill={color} opacity={0.12} />}
      {data.length > 1 && <path d={d} fill="none" stroke={color} strokeWidth={1.8} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
    </svg>
  );
}

export function Ring({ value, max, size = 64, stroke = 7, color = 'var(--accent)', children }: { value: number; max: number; size?: number; stroke?: number; color?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, max ? value / max : 0));
  return (
    <div className="ring-box" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * p} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
      </svg>
      <div className="ring-in">{children}</div>
    </div>
  );
}

/** A labelled row inside a sheet. */
export function Row({ k, v, hint }: { k: ReactNode; v: ReactNode; hint?: ReactNode }) {
  return (
    <div className="kv">
      <span>
        {k}
        {hint && <small>{hint}</small>}
      </span>
      <strong className="num">{v}</strong>
    </div>
  );
}
