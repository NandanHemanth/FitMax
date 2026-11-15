import type { ReactNode } from 'react';
import { ANCHORS, GRID, type Live } from './demo';
import type { Reading, WatchState } from './engine';

/** Everything the live view needs beyond the current frame. */
export interface LiveExtras {
  energyHist: number[];
  breathHist: number[];
  stillMin: number;
  inactivityMin: number;
  bedExitAt: number | null;
  hrPeak: number | null; // highest HR in the last workout
  hrRecovery: number | null; // drop from that peak during cool-down
  age: number;
  demo: boolean;
  rawRssi?: number[]; // RSSI mode: the last ~15 s of raw signal strength at 10 Hz
}

const fmtTime = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function LiveView({ r, live, watch, x }: { r: Reading; live: Live; watch: WatchState; x: LiveExtras }) {
  const fallOpen = Boolean(watch.open.fall);
  const maxHr = 220 - x.age;
  const zone = live.hr != null ? hrZone(live.hr / maxHr) : null;
  const sleeping = x.demo ? live.phase === 'sleep' : r.presence && r.motion === 'still' && (live.br ?? 99) < 16;
  const workout = live.phase === 'workout' || Boolean(live.exercising) || (!x.demo && r.motion === 'active');
  const rssi = r.source === 'rssi';

  const tiles: { label: string; value: ReactNode; sub?: string; tone?: 'on' | 'warn' | 'bad' | 'off' }[] = [
    { label: 'Presence', value: r.presence ? `Home · ${r.persons}` : 'Away', sub: `${Math.round(r.confidence * 100)}% confidence`, tone: r.presence ? 'on' : 'off' },
    { label: 'Where', value: live.zone ?? (r.presence ? 'In range' : '—'), sub: x.demo ? 'Room zones' : rssi ? 'In the WiFi path; no position in RSSI mode' : 'Zones need setup in RuView', tone: r.presence ? 'on' : 'off' },
    { label: 'Movement', value: MOTION[r.motion], sub: `Energy ${Math.round(live.energy * 100)}%`, tone: r.motion === 'active' || r.motion === 'moving' ? 'on' : 'off' },
    { label: 'Home workout', value: workout ? (live.reps != null && (live.phase === 'workout' || live.exercising) ? `${live.exerciseName ?? 'Squats'} · ${live.reps}` : 'Detected') : live.reps ? `${live.reps} reps today` : 'Not now', sub: workout ? 'From the motion rhythm, no camera' : 'Detects sustained exercise', tone: workout ? 'on' : 'off' },
    { label: 'Active minutes', value: `${Math.round(watch.activeMs / 60_000)} min`, sub: 'Today, at home', tone: 'on' },
    { label: 'Sedentary', value: x.stillMin >= 1 && r.motion === 'still' ? `Still ${x.stillMin} min` : 'Moving', sub: `Nudge at ${x.inactivityMin} min`, tone: x.stillMin >= x.inactivityMin ? 'warn' : x.stillMin > 0 ? 'on' : 'off' },
    { label: 'Sleep', value: sleeping ? 'Asleep' : 'Awake', sub: sleeping ? `Breathing ${live.br ?? '–'}/min, still` : 'Stillness + slow breathing', tone: sleeping ? 'on' : 'off' },
    { label: 'Bed exit', value: x.bedExitAt ? fmtTime(x.bedExitAt) : '—', sub: 'Night-time get-ups', tone: x.bedExitAt ? 'on' : 'off' },
    { label: 'Breathing', value: live.br != null ? `${live.br} /min` : '–', sub: r.breathing.abstained ? (rssi ? 'Needs CSI hardware' : 'Needs 1-person calibration') : 'Resting rate', tone: live.br != null ? 'on' : 'off' },
    { label: 'Heart rate', value: live.hr != null ? `${live.hr} bpm` : '–', sub: zone ? `${zone} · ${Math.round(((live.hr ?? 0) / maxHr) * 100)}% of max` : rssi ? 'Needs CSI hardware' : 'Needs 1-person calibration', tone: live.hr != null ? 'on' : 'off' },
    { label: 'HR recovery', value: x.hrRecovery != null ? `−${x.hrRecovery} bpm` : '—', sub: x.hrPeak ? `From a ${x.hrPeak} bpm workout peak` : 'Drop after a workout = fitness', tone: x.hrRecovery != null ? 'on' : 'off' },
    { label: 'Fall detection', value: fallOpen ? 'Possible fall' : rssi ? 'Off' : 'Watching', sub: fallOpen ? 'Alert raised' : rssi ? 'Needs CSI hardware' : 'Impact, then stillness', tone: fallOpen ? 'bad' : rssi ? 'off' : 'on' },
  ];

  return (
    <div className="grid">
      <div className="card col-7 live-room-card">
        <div className="card-head">
          <h2>Live room</h2>
          <span className={`pill ${fallOpen ? 'bad-pill' : workout ? 'accent' : 'data'}`}>{live.activity}</span>
        </div>
        <Room live={live} fall={fallOpen} demo={x.demo} rssi={rssi} />
        <p className="tiny muted" style={{ marginTop: 8 }}>
          {rssi
            ? 'RSSI mode: the line pulses as your movement disturbs the WiFi link between the UNO Q and the router. No camera, no images.'
            : 'Heatmap = how much the person disturbs the WiFi signal between the sensor nodes (◆). No camera, no images.'}
        </p>
      </div>
      <div className="card col-5">
        <div className="card-head">
          <h2>Live signals</h2>
          <span className="pill">{x.demo || rssi ? '10 Hz' : '1 Hz'}</span>
        </div>
        {rssi && x.rawRssi && x.rawRssi.length > 5 && (
          <Scope
            label="WiFi signal strength (raw, live)"
            values={x.rawRssi}
            min={Math.min(...x.rawRssi) - 1}
            max={Math.max(...x.rawRssi) + 1}
            cls="scope-rssi"
            value={`${Math.round(x.rawRssi[x.rawRssi.length - 1])} dBm`}
            note="Flat = still room · wiggles = you moving · a regular wave = reps"
          />
        )}
        <Scope label="Motion energy" values={x.energyHist} min={0} max={1} cls="scope-energy" value={`${Math.round(live.energy * 100)}%`} />
        <Scope label="Breathing" values={x.breathHist} min={-1.3} max={1.3} cls="scope-breath" value={live.br != null ? `${live.br}/min` : '–'} empty={x.breathHist.length === 0 ? (rssi ? 'Breathing needs CSI hardware (ESP32-S3); RSSI is too coarse' : 'Breathing waveform appears once RuView is calibrated') : undefined} />
        <div className="live-hr">
          <div>
            <span className="stat-label">Heart rate</span>
            <span className="stat-num">
              {live.hr ?? '–'} <small className="muted">bpm</small>
            </span>
          </div>
          {zone && <ZoneBar pct={(live.hr ?? 0) / maxHr} />}
        </div>
      </div>
      <div className="card col-12">
        <div className="card-head">
          <h2>What FitMax tracks at home</h2>
          <span className="tiny muted">Lit = active right now</span>
        </div>
        <div className="track-grid">
          {tiles.map((t) => (
            <div key={t.label} className={`track ${t.tone ?? 'off'}`}>
              <span className="track-label">
                <i /> {t.label}
              </span>
              <strong>{t.value}</strong>
              {t.sub && <span className="tiny muted">{t.sub}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const MOTION = { absent: 'Away', still: 'Still', moving: 'Moving', active: 'Very active' } as const;

function hrZone(f: number) {
  if (f < 0.5) return 'Resting';
  if (f < 0.6) return 'Zone 1';
  if (f < 0.7) return 'Zone 2';
  if (f < 0.8) return 'Zone 3';
  if (f < 0.9) return 'Zone 4';
  return 'Zone 5';
}

function ZoneBar({ pct }: { pct: number }) {
  return (
    <div className="zone-bar" aria-label={`${Math.round(pct * 100)}% of max heart rate`}>
      {[0.5, 0.6, 0.7, 0.8, 0.9].map((z, i) => (
        <i key={z} className={pct >= z ? `z${i + 1} on` : `z${i + 1}`} />
      ))}
    </div>
  );
}

function Room({ live, fall, demo, rssi }: { live: Live; fall: boolean; demo: boolean; rssi?: boolean }) {
  const cell = 100 / GRID;
  return (
    <svg className="room" viewBox="0 0 100 100" role="img" aria-label={`Room view: ${live.activity}`}>
      <rect x="0.5" y="0.5" width="99" height="99" rx="3" className="room-floor" />
      {live.field?.map((v, i) => (v > 0.12 ? <rect key={i} x={(i % GRID) * cell} y={Math.floor(i / GRID) * cell} width={cell + 0.2} height={cell + 0.2} className="heat" style={{ opacity: Math.min(0.85, v * 0.9) }} /> : null))}
      {demo &&
        ANCHORS.map((a) => (
          <g key={a.name}>
            <rect x={a.x * 100} y={a.y * 100} width={a.w * 100} height={a.h * 100} rx="2" className="furn" />
            <text x={a.x * 100 + 2} y={a.y * 100 + 5} className="furn-label">
              {a.name}
            </text>
          </g>
        ))}
      {/* sensor nodes */}
      {!rssi && [
        [3, 50],
        [97, 50],
      ].map(([nx, ny]) => (
        <rect key={nx} x={nx - 1.6} y={ny - 1.6} width="3.2" height="3.2" transform={`rotate(45 ${nx} ${ny})`} className="node" />
      ))}
      {live.persons.map((p, i) => (
        <g key={i} className={fall ? 'person fall' : 'person'} transform={`translate(${p.x * 100} ${p.y * 100})`}>
          <circle r={4 + live.energy * 6} className="person-ring" />
          <circle r="2.6" className="person-dot" />
        </g>
      ))}
      {rssi && (
        <g className="rssi-link">
          <line x1="8" y1="50" x2="92" y2="50" style={{ strokeWidth: 0.6 + live.energy * 2.4, opacity: 0.35 + live.energy * 0.65 }} />
          <text x="8" y="44" className="furn-label">UNO Q</text>
          <text x="92" y="44" textAnchor="end" className="furn-label">Router</text>
        </g>
      )}
      {live.persons.length === 0 && (
        <text x="50" y={rssi ? 62 : 52} textAnchor="middle" className="furn-label">
          {live.note ?? 'Nobody detected'}
        </text>
      )}
    </svg>
  );
}

function Scope({ label, values, min, max, cls, value, empty, note }: { label: string; values: number[]; min: number; max: number; cls: string; value: string; empty?: string; note?: string }) {
  const W = 200;
  const H = 44;
  const n = Math.max(values.length, 2);
  const pts = values.map((v, i) => `${((i / (n - 1)) * W).toFixed(1)},${(H - ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * H).toFixed(1)}`).join(' ');
  return (
    <div className="scope">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="stat-label">{label}</span>
        <span className="num small">{value}</span>
      </div>
      {empty ? (
        <p className="tiny muted scope-empty">{empty}</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={`scope-svg ${cls}`}>
          <polyline points={pts} />
        </svg>
      )}
      {note && <p className="tiny muted" style={{ margin: '4px 0 0' }}>{note}</p>}
    </div>
  );
}
