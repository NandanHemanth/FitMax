/**
 * Home monitor logic for RuView WiFi sensing (view-only in FitMax).
 * Raw RuView responses → one normalized Reading → HomeWatch turns readings into
 * activity minutes, a timeline and de-duplicated alerts. Pure: time is passed in.
 */

export type Motion = 'absent' | 'still' | 'moving' | 'active';

/** Subset of RuView's GET /api/v1/sensing/latest that we use. */
export interface RvSensing {
  source?: string;
  timestamp?: number;
  age_ms?: number;
  status?: string;
  classification?: { motion_level?: string; presence?: boolean; confidence?: number };
  estimated_persons?: number;
  features?: { motion_band_power?: number; breathing_band_power?: number; mean_rssi?: number };
  nodes?: { node_id: number | string; rssi_dbm?: number; subcarrier_count?: number }[];
  /** FitMax RSSI hub only: rhythm detector for repetitive exercise */
  exercise?: { periodic?: boolean; cadence_per_min?: number | null; reps?: number };
}
export interface RvVitals {
  authority?: string;
  abstention_reason?: string;
  vital_signs?: {
    breathing_rate_bpm?: number | null;
    heart_rate_bpm?: number | null;
    breathing_confidence?: number | null;
    heartbeat_confidence?: number | null;
  };
}
export interface RvEdge {
  status?: string;
  message?: string;
  edge_vitals?: { fall_detected?: boolean; presence?: boolean; n_persons?: number; breathing_rate_bpm?: number | null; heartrate_bpm?: number | null } | null;
}
export interface RvHealth {
  status?: string;
  source?: string;
  processing?: { state?: string; last_update_age_ms?: number };
}

export interface Vital {
  bpm: number | null;
  confidence: number | null;
  /** Why RuView declined to publish a value (it abstains rather than guess). */
  abstained: string | null;
}

export interface Reading {
  at: number;
  reachable: boolean;
  source: string; // simulated | esp32 | wifi | …
  simulated: boolean;
  live: boolean; // hub is producing fresh frames
  presence: boolean;
  persons: number;
  motion: Motion;
  confidence: number;
  breathing: Vital;
  heart: Vital;
  fall: boolean;
  nodes: { id: string; rssi: number | null }[];
  /** False when Only-me mode can't confirm this is you: metrics aren't credited, safety alerts still run. */
  attributable?: boolean;
}

export const motionFrom = (level: string | undefined, presence: boolean): Motion => {
  if (!presence || level === 'absent') return 'absent';
  if (level === 'active') return 'active';
  if (level === 'present_moving' || level === 'moving') return 'moving';
  return 'still';
};

export function normalize(at: number, health: RvHealth | null, sensing: RvSensing | null, vitals: RvVitals | null, edge: RvEdge | null): Reading {
  const source = sensing?.source ?? health?.source ?? 'unknown';
  const fresh = Boolean(sensing?.classification) && sensing?.status !== 'stale';
  const presence = fresh && Boolean(sensing?.classification?.presence);
  const ev = edge?.edge_vitals ?? null;
  const vs = vitals?.vital_signs ?? {};
  const abst = vitals?.authority === 'abstained' ? vitals.abstention_reason || 'abstained' : null;
  const vital = (bpm: number | null | undefined, conf: number | null | undefined, edgeBpm: number | null | undefined): Vital => {
    const v = fresh ? bpm ?? edgeBpm ?? null : null;
    return { bpm: v, confidence: conf ?? null, abstained: v == null ? abst ?? edge?.message ?? 'no estimate yet' : null };
  };
  return {
    at,
    reachable: Boolean(health),
    source,
    simulated: source === 'simulated',
    live: Boolean(health) && health?.processing?.state !== 'stale' && fresh,
    presence,
    persons: presence ? Math.max(1, sensing?.estimated_persons ?? ev?.n_persons ?? 1) : 0,
    motion: motionFrom(sensing?.classification?.motion_level, presence),
    confidence: sensing?.classification?.confidence ?? 0,
    breathing: vital(vs.breathing_rate_bpm, vs.breathing_confidence, ev?.breathing_rate_bpm),
    heart: vital(vs.heart_rate_bpm, vs.heartbeat_confidence, ev?.heartrate_bpm),
    fall: Boolean(ev?.fall_detected),
    nodes: (sensing?.nodes ?? []).map((n) => ({ id: String(n.node_id), rssi: n.rssi_dbm ?? null })),
  };
}

export type Severity = 'critical' | 'warn' | 'info';
export interface Alert {
  id: string;
  kind: 'fall' | 'inactivity' | 'breathing' | 'heart' | 'offline';
  severity: Severity;
  title: string;
  detail: string;
  at: number;
  demo: boolean; // raised from simulated data
  ack?: boolean;
}

export interface WatchSettings {
  inactivityMin: number; // presence with no movement for this long → alert
  breathing: [number, number]; // normal resting range, breaths/min
  heart: [number, number]; // beats/min
  minConfidence: number; // ignore vitals below this confidence
  offlineSec: number;
}
export const DEFAULT_WATCH: WatchSettings = { inactivityMin: 45, breathing: [8, 25], heart: [40, 120], minConfidence: 0.6, offlineSec: 90 };

/** One minute bucket in today's timeline: the most active state seen. */
export interface Minute { t: number; m: Motion | 'offline' }

export interface WatchState {
  day: string;
  activeMs: number; // moving + active time today
  presentMs: number;
  lastMoveAt: number | null;
  lastSeenAt: number | null;
  lastAt: number | null;
  timeline: Minute[];
  alerts: Alert[];
  open: Partial<Record<Alert['kind'], string>>; // currently-active alert per kind (dedupe)
}

export const dayKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const emptyWatch = (t: number): WatchState => ({ day: dayKey(t), activeMs: 0, presentMs: 0, lastMoveAt: null, lastSeenAt: null, lastAt: null, timeline: [], alerts: [], open: {} });

const RANK: Record<Minute['m'], number> = { offline: -1, absent: 0, still: 1, moving: 2, active: 3 };
const MAX_GAP = 30_000; // don't credit time across long polling gaps
const MAX_ALERTS = 100;

/** Fold one reading into the state. Returns a new state and any newly raised alerts. */
export function step(prev: WatchState, r: Reading, s: WatchSettings = DEFAULT_WATCH): { state: WatchState; raised: Alert[] } {
  let st: WatchState = prev.day === dayKey(r.at) ? { ...prev, open: { ...prev.open }, timeline: [...prev.timeline] } : { ...emptyWatch(r.at), alerts: prev.alerts, open: { ...prev.open } };
  const raised: Alert[] = [];
  const dt = st.lastAt != null ? Math.min(Math.max(0, r.at - st.lastAt), MAX_GAP) : 0;

  const raise = (kind: Alert['kind'], severity: Severity, title: string, detail: string) => {
    if (st.open[kind]) return;
    const a: Alert = { id: `${kind}-${r.at}`, kind, severity, title, detail, at: r.at, demo: r.simulated };
    st.open[kind] = a.id;
    raised.push(a);
  };
  const clear = (kind: Alert['kind']) => {
    delete st.open[kind];
  };

  if (r.reachable && r.live) {
    st.lastSeenAt = r.at;
    clear('offline');
    const mine = r.attributable !== false;
    if (r.presence && mine) st.presentMs += dt;
    const moving = r.motion === 'moving' || r.motion === 'active';
    if (moving) {
      if (mine) st.activeMs += dt;
      st.lastMoveAt = r.at;
    } else if (!r.presence) {
      st.lastMoveAt = null; // nobody home: inactivity clock doesn't run
    } else if (st.lastMoveAt == null) {
      st.lastMoveAt = r.at; // someone arrived still; start the clock now
    }

    // Fall
    // A fall stays open until a person acknowledges it (see acknowledge), even if the flag drops.
    if (r.fall) raise('fall', 'critical', 'Possible fall detected', 'Sudden motion followed by stillness. Check on them now.');

    // Inactivity while someone is home
    const stillMin = r.presence && !moving && st.lastMoveAt != null ? (r.at - st.lastMoveAt) / 60_000 : 0;
    if (stillMin >= s.inactivityMin) raise('inactivity', 'warn', `No movement for ${Math.round(stillMin)} min`, 'Someone is home but hasn’t moved. Could be sleep, could need a check-in.');
    else if (moving || !r.presence) clear('inactivity');

    // Vitals, only when RuView is confident enough to publish them
    const check = (kind: 'breathing' | 'heart', v: Vital, [lo, hi]: [number, number], unit: string, label: string) => {
      if (!mine || v.bpm == null || (v.confidence ?? 0) < s.minConfidence || moving) return; // your resting values only
      if (v.bpm < lo || v.bpm > hi) raise(kind, 'warn', `${label} ${Math.round(v.bpm)} ${unit}`, `Outside the resting range you set (${lo}–${hi}). WiFi estimates are approximate: confirm with a wearable.`);
      else clear(kind);
    };
    check('breathing', r.breathing, s.breathing, 'br/min', 'Breathing');
    check('heart', r.heart, s.heart, 'bpm', 'Heart rate');
  } else if (st.lastSeenAt != null && r.at - st.lastSeenAt > s.offlineSec * 1000) {
    raise('offline', 'info', 'Home hub offline', 'No data from the UNO Q hub. Check its power and WiFi.');
  }

  // Timeline: one bucket per minute, keeping the most active state
  const t = Math.floor(r.at / 60_000) * 60_000;
  const m: Minute['m'] = r.reachable && r.live ? r.motion : 'offline';
  const last = st.timeline[st.timeline.length - 1];
  if (last && last.t === t) {
    if (RANK[m] > RANK[last.m]) st.timeline[st.timeline.length - 1] = { t, m };
  } else st.timeline.push({ t, m });
  if (st.timeline.length > 24 * 60) st.timeline = st.timeline.slice(-24 * 60);

  st.lastAt = r.at;
  if (raised.length) st = { ...st, alerts: [...raised, ...st.alerts].slice(0, MAX_ALERTS) };
  return { state: st, raised };
}

/** Mark an alert as seen. Closes it, so the same kind can be raised again. */
export function acknowledge(st: WatchState, id: string): WatchState {
  const open = { ...st.open };
  for (const k of Object.keys(open) as Alert['kind'][]) if (open[k] === id) delete open[k];
  return { ...st, open, alerts: st.alerts.map((a) => (a.id === id ? { ...a, ack: true } : a)) };
}

export type MeStatus = { configured: boolean; home: boolean | null };

/** Only-me gate: credit metrics to you only when exactly one person is sensed and your phone is home. */
export function attribute(r: Reading, onlyMe: boolean, me: MeStatus | null): { reading: Reading; reason: string | null } {
  if (!onlyMe || !r.presence) return { reading: { ...r, attributable: true }, reason: null };
  const reason = r.persons > 1 ? `${r.persons} people sensed` : me?.configured && me.home === false ? 'your phone isn’t home' : null;
  if (!reason) return { reading: { ...r, attributable: true }, reason: null };
  const hide = { bpm: null, confidence: null, abstained: `Paused: ${reason}` };
  return { reading: { ...r, attributable: false, breathing: hide, heart: hide }, reason };
}
