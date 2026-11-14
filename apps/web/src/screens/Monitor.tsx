import { useEffect, useRef, useState } from 'react';
import { demoFrame, hubLive, type Live } from '../monitor/demo';
import { acknowledge, DEFAULT_WATCH, emptyWatch, normalize, step, type Alert, type Minute, type Reading, type RvEdge, type RvHealth, type RvSensing, type RvVitals, type WatchSettings, type WatchState } from '../monitor/engine';
import { LiveView } from '../monitor/LiveView';
import { useApp } from '../state/app';
import { IconAlert, IconCheck, IconPulse, IconShield, IconWifi } from '../ui/icons';

const POLL_MS = 2000;
const DEMO_MS = 100;
const HIST = 100; // samples kept for the live scopes
const KEY = 'fitmax.monitor';
const SKEY = 'fitmax.monitor.settings';
const MKEY = 'fitmax.monitor.mode';
const DEMO_INACTIVITY_MIN = 15; // the demo's sofa scene is 17 "minutes"

const load = <T,>(k: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? { ...fallback, ...JSON.parse(v) } : fallback;
  } catch {
    return fallback;
  }
};
const save = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage full or blocked: monitor still works in memory */
  }
};

async function get<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`/api/ruview/${path}`, { cache: 'no-store' });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

type Config = { configured: boolean; hub: string | null } | null;
type Mode = 'demo' | 'hub';
interface Track { energyHist: number[]; breathHist: number[]; bedExitAt: number | null; hrPeak: number | null; hrRecovery: number | null }
const emptyTrack = (): Track => ({ energyHist: [], breathHist: [], bedExitAt: null, hrPeak: null, hrRecovery: null });
const push = (a: number[], v: number) => (a.length >= HIST ? [...a.slice(1), v] : [...a, v]);

export function Monitor() {
  const { profile } = useApp();
  const [config, setConfig] = useState<Config>(null);
  const [mode, setModeState] = useState<Mode | null>(() => {
    try {
      return (localStorage.getItem(MKEY) as Mode | null) ?? null;
    } catch {
      return null;
    }
  });
  const [reading, setReading] = useState<Reading | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [track, setTrack] = useState<Track>(emptyTrack);
  const [watch, setWatch] = useState<WatchState>(() => load(KEY, emptyWatch(Date.now())));
  const [settings, setSettings] = useState<WatchSettings>(() => load(SKEY, DEFAULT_WATCH));
  const [nodesTotal, setNodesTotal] = useState(0);
  const [authFail, setAuthFail] = useState(false);
  const watchRef = useRef(watch);
  const trackRef = useRef(track);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const setMode = (m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem(MKEY, m);
    } catch {
      /* ignore */
    }
  };

  // Which hub (if any) is configured; picks the default mode the first time.
  useEffect(() => {
    void get<{ configured: boolean; hub: string | null }>('config').then((cfg) => {
      const c = cfg ?? { configured: false, hub: null };
      setConfig(c);
      setModeState((m) => m ?? (c.configured ? 'hub' : 'demo'));
    });
  }, []);

  // Reset the view when switching source; the hub's history is persisted, the demo's isn't.
  useEffect(() => {
    if (!mode) return;
    const w = mode === 'hub' ? load(KEY, emptyWatch(Date.now())) : emptyWatch(Date.now());
    watchRef.current = w;
    trackRef.current = emptyTrack();
    setWatch(w);
    setTrack(trackRef.current);
    setReading(null);
    setLive(null);
    setAuthFail(false);
  }, [mode]);

  // Demo: scripted day at home at 10 Hz, through the same alert engine
  useEffect(() => {
    if (mode !== 'demo') return;
    const t0 = performance.now();
    const startAt = Date.now();
    const id = window.setInterval(() => {
      const sec = (performance.now() - t0) / 1000;
      const { reading: r, live: l } = demoFrame(sec, startAt);
      const { state } = step(watchRef.current, r, { ...settingsRef.current, inactivityMin: Math.min(settingsRef.current.inactivityMin, DEMO_INACTIVITY_MIN) });
      const tr = trackRef.current;
      const next: Track = {
        energyHist: push(tr.energyHist, l.energy),
        breathHist: push(tr.breathHist, l.breath ?? 0),
        bedExitAt: l.phase === 'wake' && (tr.bedExitAt == null || r.at - tr.bedExitAt > 10 * 60_000) ? r.at : tr.bedExitAt,
        hrPeak: l.phase === 'workout' ? Math.max(tr.hrPeak ?? 0, l.hr ?? 0) : tr.hrPeak,
        hrRecovery: l.phase === 'cooldown' && tr.hrPeak && l.hr ? Math.max(0, tr.hrPeak - l.hr) : l.phase === 'workout' ? null : tr.hrRecovery,
      };
      watchRef.current = state;
      trackRef.current = next;
      setWatch(state);
      setTrack(next);
      setReading(r);
      setLive(l);
    }, DEMO_MS);
    return () => window.clearInterval(id);
  }, [mode]);

  // Hub: poll the UNO Q through the laptop's read-only proxy
  useEffect(() => {
    if (mode !== 'hub' || !config?.configured) return;
    let alive = true;
    let timer: number | undefined;
    const tick = async () => {
      const [h, s, v, e, n] = await Promise.all([
        get<RvHealth>('health'),
        get<RvSensing>('sensing/latest'),
        get<RvVitals>('vital-signs'),
        get<RvEdge>('edge-vitals'),
        get<{ total?: number }>('nodes'),
      ]);
      if (!alive) return;
      // Health is open but /api/v1/* needs the token: a 401 there means .env has the wrong one
      setAuthFail(Boolean(h) && !s && (await fetch('/api/ruview/status').then((x) => x.status === 401).catch(() => false)));
      const r = normalize(Date.now(), h, s, v, e);
      const { state } = step(watchRef.current, r, settingsRef.current);
      const l = hubLive(s, r);
      const tr = trackRef.current;
      trackRef.current = { ...tr, energyHist: push(tr.energyHist, l.energy) };
      watchRef.current = state;
      setTrack(trackRef.current);
      setReading(r);
      setLive(l);
      setWatch(state);
      setNodesTotal(Math.max(n?.total ?? 0, r.nodes.length));
      save(KEY, state);
      timer = window.setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [mode, config?.configured]);

  const updateSettings = (s: WatchSettings) => {
    setSettings(s);
    save(SKEY, s);
  };
  const ack = (id: string) => {
    const next = acknowledge(watchRef.current, id);
    watchRef.current = next;
    setWatch(next);
    if (mode === 'hub') save(KEY, next);
  };

  const demo = mode === 'demo';
  const r = reading;
  const open = watch.alerts.filter((a) => Object.values(watch.open).includes(a.id));
  const critical = open.find((a) => a.severity === 'critical');
  const stillMin = r?.presence && r.motion === 'still' && watch.lastMoveAt ? Math.floor((r.at - watch.lastMoveAt) / 60_000) : 0;
  const status = demo ? 'demo' : !r ? 'connecting' : !r.reachable ? 'offline' : authFail ? 'locked' : r.simulated ? 'simulated' : r.live ? 'live' : 'waiting';
  const needsSetup = mode === 'hub' && config && !config.configured;
  const inactivityMin = demo ? Math.min(settings.inactivityMin, DEMO_INACTIVITY_MIN) : settings.inactivityMin;

  return (
    <div className="monitor">
      <div className="page-head">
        <div>
          <p className="eyebrow">Home monitor · WiFi sensing, on-device</p>
          <h1>At home</h1>
        </div>
        <div className="row">
          <div className="seg" role="tablist" aria-label="Data source">
            <button role="tab" aria-selected={demo} className={demo ? 'on' : ''} onClick={() => setMode('demo')}>
              Live demo
            </button>
            <button role="tab" aria-selected={!demo} className={!demo ? 'on' : ''} onClick={() => setMode('hub')}>
              My hub
            </button>
          </div>
          {!demo && <SourcePill status={status} source={r?.source} />}
          {!demo && config?.hub && <span className="pill">Hub {config.hub}</span>}
        </div>
      </div>

      {demo && (
        <div className="mon-note demo">
          <IconPulse size={18} />
          <span>
            <strong>Demo: a day at home, 1 second = 1 minute.</strong> Sleep → bed exit → home workout → sofa → a fall → recovery, played through the same alert logic as the real hub. With ESP32 sensors, “My hub” shows your home live.
          </span>
        </div>
      )}
      {!demo && authFail && (
        <div className="mon-note warn">
          <IconShield size={18} />
          <span>
            <strong>The hub rejected FitMax’s token.</strong> Copy RUVIEW_API_TOKEN again from the hub (re-run <code>./setup.sh</code> to print it) into <code>apps/web/.env</code>, then restart <code>npm run dev</code>.
          </span>
        </div>
      )}
      {!demo && !authFail && status === 'simulated' && (
        <div className="mon-note">
          <IconShield size={18} />
          <span>
            <strong>Simulated data.</strong> RuView is running on your hub, but no sensor nodes are streaming yet. Readings and alerts below are a demo until an ESP32-S3 node is added.
          </span>
        </div>
      )}
      {!demo && status === 'offline' && (
        <div className="mon-note warn">
          <IconWifi size={18} />
          <span>
            <strong>Can’t reach the hub.</strong> Check the UNO Q is powered and on the same WiFi, and that RUVIEW_URL in .env points to it.
          </span>
        </div>
      )}

      {critical && (
        <div className="mon-critical" role="alert">
          <IconAlert size={26} />
          <div>
            <strong>{critical.title}</strong>
            <p>
              {critical.detail} {critical.demo && (demo ? '(demo)' : '(simulated)')}
            </p>
          </div>
          <button className="btn" onClick={() => ack(critical.id)}>
            I’ve checked
          </button>
        </div>
      )}

      {needsSetup ? (
        <Setup onDemo={() => setMode('demo')} />
      ) : (
        <>
          {r && live && (
            <LiveView
              r={r}
              live={live}
              watch={watch}
              x={{ ...track, stillMin, inactivityMin, age: profile?.age ?? 30, demo }}
            />
          )}
          <div className="grid" style={{ marginTop: 14 }}>
            <div className="card col-8">
              <div className="card-head">
                <h2>
                  <IconPulse size={18} /> {demo ? 'Demo day' : 'Today at home'}
                </h2>
                <span className="pill good">{Math.round(watch.activeMs / 60_000)} active min</span>
              </div>
              <Timeline minutes={watch.timeline} at={r?.at ?? Date.now()} />
              <div className="mon-legend tiny muted">
                {(['active', 'moving', 'still', 'absent', 'offline'] as const).map((m) => (
                  <span key={m}>
                    <i className={`m-${m}`} /> {MOTION_LABEL[m]}
                  </span>
                ))}
              </div>
              <p className="small muted" style={{ marginTop: 10 }}>
                {Math.round(watch.presentMs / 60_000)} min at home. Movement time here counts toward your daily activity, alongside the workouts you log in Train.
              </p>
            </div>

            <div className="card col-4">
              <div className="card-head">
                <h2>Alerts</h2>
                {open.length > 0 && <span className="pill warn">{open.length} open</span>}
              </div>
              {watch.alerts.length === 0 ? (
                <p className="muted small">No alerts. FitMax raises one for a possible fall, long stillness while someone is home, resting vitals outside your range, or the hub going offline.</p>
              ) : (
                <ul className="list mon-alerts">
                  {watch.alerts.slice(0, 8).map((a) => (
                    <AlertRow key={a.id} a={a} onAck={() => ack(a.id)} />
                  ))}
                </ul>
              )}
            </div>

            <div className="card col-6">
              <div className="card-head">
                <h2>Alert rules</h2>
              </div>
              <label className="field">
                <span>Alert after no movement (someone home) for</span>
                <select value={settings.inactivityMin} onChange={(e) => updateSettings({ ...settings, inactivityMin: Number(e.target.value) })}>
                  {[15, 30, 45, 60, 90, 120, 180].map((m) => (
                    <option key={m} value={m}>
                      {m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? 's' : ''}`}
                    </option>
                  ))}
                </select>
              </label>
              <p className="tiny muted" style={{ marginTop: 8 }}>
                {demo && `The demo uses ${DEMO_INACTIVITY_MIN} min so you can see it fire. `}Resting breathing {settings.breathing[0]}–{settings.breathing[1]} br/min and heart rate {settings.heart[0]}–{settings.heart[1]} bpm. Vitals only count when RuView is at least {Math.round(settings.minConfidence * 100)}% confident; it abstains rather than guess. Not a medical device.
              </p>
            </div>

            <div className="card col-6">
              <div className="card-head">
                <h2>
                  <IconWifi size={18} /> Sensor nodes
                </h2>
                <span className="pill data">{demo ? r?.nodes.length ?? 0 : nodesTotal}</span>
              </div>
              {r?.nodes.length ? (
                <ul className="list">
                  {r.nodes.map((n) => (
                    <li key={n.id} className="row" style={{ justifyContent: 'space-between' }}>
                      <span>
                        {demo ? 'Demo node' : 'Node'} {n.id}
                      </span>
                      <span className="muted num">{n.rssi != null ? `${Math.round(n.rssi)} dBm` : '–'}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">No ESP32-S3 nodes yet. Each one (~$9) streams WiFi channel data to the hub; two or more per room give better presence and fall detection. Setup is in hub/uno-q/README.md.</p>
              )}
              <p className="tiny muted" style={{ marginTop: 8 }}>
                Everything stays on your network: no cameras, no cloud. The hub can also publish to Home Assistant over MQTT for Google Home or Apple Home later.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const MOTION_LABEL: Record<Minute['m'], string> = { absent: 'Away', still: 'Still', moving: 'Moving', active: 'Active', offline: 'Offline' };

function SourcePill({ status, source }: { status: string; source?: string }) {
  if (status === 'live') return <span className="pill good">● Live · {source}</span>;
  if (status === 'simulated') return <span className="pill warn">Simulated</span>;
  if (status === 'offline') return <span className="pill bad-pill">Hub offline</span>;
  if (status === 'locked') return <span className="pill bad-pill">Token rejected</span>;
  if (status === 'waiting') return <span className="pill">Waiting for sensors</span>;
  return <span className="pill">Connecting…</span>;
}

function Timeline({ minutes, at }: { minutes: Minute[]; at: number }) {
  // Last 3 hours, one slot per minute
  const now = Math.floor(at / 60_000) * 60_000;
  const by = new Map(minutes.map((m) => [m.t, m.m]));
  const slots = Array.from({ length: 180 }, (_, i) => now - (179 - i) * 60_000);
  return (
    <div>
      <div className="mon-timeline" aria-label="Movement over the last 3 hours">
        {slots.map((t) => (
          <i key={t} className={`m-${by.get(t) ?? 'none'}`} />
        ))}
      </div>
      <div className="row tiny muted" style={{ justifyContent: 'space-between' }}>
        <span>3 h ago</span>
        <span>now</span>
      </div>
    </div>
  );
}

function AlertRow({ a, onAck }: { a: Alert; onAck: () => void }) {
  const time = new Date(a.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return (
    <li className={`mon-alert ${a.severity} ${a.ack ? 'acked' : ''}`}>
      <div>
        <strong>{a.title}</strong>
        <span className="tiny muted">
          {' '}
          · {time}
          {a.demo && ' · simulated'}
        </span>
        <p className="tiny muted">{a.detail}</p>
      </div>
      {a.ack ? (
        <IconCheck size={16} className="muted" />
      ) : (
        <button className="btn btn-ghost tiny" onClick={onAck}>
          OK
        </button>
      )}
    </li>
  );
}

function Setup({ onDemo }: { onDemo: () => void }) {
  return (
    <>
      <div className="mon-note">
        <IconWifi size={18} />
        <span>
          <strong>No hub connected yet.</strong> Follow the steps below, or{' '}
          <button className="linklike" onClick={onDemo}>
            watch the live demo
          </button>{' '}
          to see everything it tracks.
        </span>
      </div>
      <div className="grid">
        <div className="card col-7">
          <ol className="mon-steps">
            <li>
              <strong>Run RuView on the Arduino UNO Q.</strong> Copy <code>hub/uno-q</code> to the board and run <code>./setup.sh</code>. It prints the hub address and an access token.
            </li>
            <li>
              <strong>Point FitMax at it.</strong> In <code>apps/web/.env</code> set <code>RUVIEW_URL=http://&lt;uno-q-ip&gt;:3000</code> and <code>RUVIEW_API_TOKEN=…</code>, then restart <code>npm run dev</code>.
            </li>
            <li>
              <strong>Add sensors when you have them.</strong> Flash an ESP32-S3 with the RuView CSI firmware and point it at the hub. Until then the hub runs in simulated mode, clearly labelled here.
            </li>
          </ol>
        </div>
        <div className="card col-5">
          <h2>What it watches</h2>
          <ul className="list small">
            <li>Presence and how many people are home</li>
            <li>Movement through the day, and active minutes</li>
            <li>Possible falls, and long stillness while someone’s home</li>
            <li>Resting breathing and heart rate, when confident</li>
          </ul>
          <p className="tiny muted" style={{ marginTop: 10 }}>
            WiFi sensing uses no camera, and all data stays on your network.
          </p>
        </div>
      </div>
    </>
  );
}
