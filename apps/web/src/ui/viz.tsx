/** Small, dependency-free charts and rings. Colours come from CSS variables. */

export function Ring({
  value,
  max,
  size = 120,
  stroke = 12,
  color = 'var(--good)',
  label,
  sub,
}: {
  value: number;
  max: number;
  size?: number;
  stroke?: number;
  color?: string;
  label?: string;
  sub?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label ?? ''} ${Math.round(pct * 100)}%`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${c * pct} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dasharray 0.8s ease' }}
      />
      {label && (
        <text x="50%" y={sub ? '47%' : '53%'} textAnchor="middle" fontSize={size * 0.2} fontWeight={800} fill="var(--text)">
          {label}
        </text>
      )}
      {sub && (
        <text x="50%" y="64%" textAnchor="middle" fontSize={Math.max(10, size * 0.095)} fill="var(--muted)">
          {sub}
        </text>
      )}
    </svg>
  );
}

export function Bars({
  data,
  height = 150,
  color = 'var(--data)',
  goal,
}: {
  data: { label: string; value: number; mark?: boolean }[];
  height?: number;
  color?: string;
  goal?: number;
}) {
  const w = 560, h = height, padB = 22, padT = 16;
  const max = Math.max(goal ?? 0, ...data.map((d) => d.value), 1);
  const bw = (w / data.length) * 0.56;
  const y = (v: number) => padT + (h - padB - padT) * (1 - v / max);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="chart" role="img" aria-label="Bar chart">
      {goal !== undefined && (
        <g>
          <line x1={0} x2={w} y1={y(goal)} y2={y(goal)} stroke="var(--good)" strokeDasharray="4 4" />
        </g>
      )}
      {data.map((d, i) => {
        const cx = (w / data.length) * (i + 0.5);
        const top = y(d.value);
        return (
          <g key={i}>
            <rect x={cx - bw / 2} y={top} width={bw} height={Math.max(2, h - padB - top)} rx={6} fill={color} opacity={0.9} />
            {d.mark && <circle cx={cx} cy={top - 8} r={4} fill="var(--accent)" />}
            <text x={cx} y={h - 6} textAnchor="middle" className="axis">
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function Line({ data, height = 120, color = 'var(--good)', min = 0, max = 100 }: { data: number[]; height?: number; color?: string; min?: number; max?: number }) {
  const w = 560, h = height, pad = 10;
  if (data.length < 2) return <p className="small muted">Finish two sets to see your trend.</p>;
  const x = (i: number) => pad + ((w - pad * 2) * i) / (data.length - 1);
  const y = (v: number) => pad + (h - pad * 2) * (1 - (v - min) / (max - min));
  const d = data.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="chart" role="img" aria-label="Trend line">
      {[25, 50, 75].map((g) => (
        <line key={g} x1={0} x2={w} y1={y(g)} y2={y(g)} className="grid-line" />
      ))}
      <path d={`${d} L${x(data.length - 1)},${h} L${x(0)},${h} Z`} fill={color} opacity={0.12} />
      <path d={d} fill="none" stroke={color} strokeWidth={3} strokeLinejoin="round" />
      {data.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r={4} fill="var(--surface)" stroke={color} strokeWidth={2.5} />
      ))}
    </svg>
  );
}
