import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { demoFrame, type Live } from '../monitor/demo';
import { acknowledge, attribute, DEFAULT_WATCH, emptyWatch, normalize, step, dayKey, type Alert, type MeStatus, type Minute, type Reading, type RvEdge, type RvHealth, type RvVitals, type WatchSettings, type WatchState } from '../monitor/engine';
import { LinkScope, RoomView, scopeColor } from '../monitor/RoomView';
import { fromDemo, fromHub, kcalPerSecond, metFor, type HubSensing, type MonView } from '../monitor/view';
import { useApp } from '../state/app';
import { IconAlert, IconCheck, IconHeart, IconMoon, IconPulse, IconShield, IconWifi } from '../ui/icons';
import { Bento, Ring, Row, Sheet, Spark, Widget } from '../ui/widgets';
import { vitals } from '../vitals/store';

const POLL_MS = 1000;
const DEMO_MS = 100;
const HIST = 120;
const KEY = 'fitmax.monitor';
const SKEY = 'fitmax.monitor.settings';
const MKEY = 'fitmax.monitor.mode';
const OKEY = 'fitmax.monitor.onlyme';
const CKEY = 'fitmax.monitor.kcal';
const DEMO_INACTIVITY_MIN = 15;
const LABELS = ['Empty room', 'Standing', 'Walking', 'Squats', 'Jumping jacks', 'Push-ups', 'Lying down', 'Fall (mat)'];

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
    /* storage blocked: works in memory */
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
async function post<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const r = await fetch(`/api/ruview/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

type Config = { configured: boolean; hub: string | null } | null;
type Mode = 'demo' | 'hub';
type Panel = null | 'room' | 'signal' | 'reps' | 'vitals' | 'safety' | 'settings' | 'record' | 'rest' | 'how' | 'heart';
const pushN = (a: number[], v: number, n = HIST) => (a.length >= n ? [...a.slice(1), v] : [...a, v]);
const mins = (s: number) => Math.round(s / 60);

export function Monitor() {
  const { profile } = useApp();
  const kg = profile?.weightKg ?? 75;
  const [config, setConfig] = useState<Config>(null);
  const [mode, setModeState] = useState<Mode | null>(() => {
    try {
      return (localStorage.getItem(MKEY) as Mode | null) ?? null;
    } catch {
      return null;
    }
  });
  const [reading, setReading] = useState<Reading | null>(null);
  const [view, setView] = useState<MonView | null>(null);
  const [series, setSeries] = useState<{ id: string; values: number[] }[]>([]);
  const [energyHist, setEnergyHist] = useState<number[]>([]);
  const [watch, setWatch] = useState<WatchState>(() => load(KEY, emptyWatch(Date.now())));
  const [settings, setSettings] = useState<WatchSettings>(() => load(SKEY, DEFAULT_WATCH));
  const [authFail, setAuthFail] = useState(false);
  const [onlyMe, setOnlyMe] = useState<boolean>(() => load(OKEY, { v: true }).v);
  const [me, setMe] = useState<MeStatus | null>(null);
  const [pausedWhy, setPausedWhy] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [kcal, setKcal] = useState<number>(() => {
    const k = load(CKEY, { day: '', kcal: 0 });
    return k.day === dayKey(Date.now()) ? k.kcal : 0;
  });
  const [labels, setLabels] = useState<{ label: string; at: number }[]>([]);
  const cam = useSyncExternalStore(vitals.subscribe, vitals.get);
  useEffect(() => vitals.autoStart(), []);
  const hr = cam.last;
  const hrLive = cam.hr;
  // Breathing: whichever source is surer right now, the camera (shoulders) or WiFi (links)
  const camBreath = cam.on && cam.breath?.bpm && Date.now() - cam.breath.at < 10_000 ? cam.breath : null;
  const onlyMeRef = useRef(onlyMe);
  onlyMeRef.current = onlyMe;
  const meRef = useRef(me);
  meRef.current = me;
  const watchRef = useRef(watch);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const kcalRef = useRef(kcal);
  const kgRef = useRef(kg);
  kgRef.current = kg;
  const demoReps = useRef({ done: 0, cur: 0, phase: '' });
  const demoSeries = useRef<Record<string, number[]>>({});

  const setMode = (m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem(MKEY, m);
    } catch {
      /* ignore */
    }
  };
  const flash = (t: string) => {
    setToast(t);
    window.setTimeout(() => setToast(null), 2600);
  };
  const addKcal = (v: MonView, r: Reading, dt: number) => {
    if (r.attributable === false) return;
    kcalRef.current += kcalPerSecond(metFor(v, r.motion), kgRef.current) * dt;
    setKcal(kcalRef.current);
  };

  useEffect(() => {
    void get<{ configured: boolean; hub: string | null }>('config').then((cfg) => {
      const c = cfg ?? { configured: false, hub: null };
      setConfig(c);
      setModeState((m) => m ?? (c.configured ? 'hub' : 'demo'));
    });
  }, []);

  useEffect(() => {
    if (!mode) return;
    const w = mode === 'hub' ? load(KEY, emptyWatch(Date.now())) : emptyWatch(Date.now());
    watchRef.current = w;
    setWatch(w);
    setReading(null);
    setView(null);
    setSeries([]);
    setEnergyHist([]);
    setAuthFail(false);
    demoReps.current = { done: 0, cur: 0, phase: '' };
    demoSeries.current = {};
  }, [mode]);

  // Demo: a scripted day at home (1 s = 1 min), through the same alert engine as the hub
  useEffect(() => {
    if (mode !== 'demo') return;
    const t0 = performance.now();
    const startAt = Date.now();
    const id = window.setInterval(() => {
      const sec = (performance.now() - t0) / 1000;
      const { reading: raw, live: l } = demoFrame(sec, startAt);
      const { reading: r } = attribute(raw, onlyMeRef.current, { configured: true, home: true });
      const { state } = step(watchRef.current, r, { ...settingsRef.current, inactivityMin: Math.min(settingsRef.current.inactivityMin, DEMO_INACTIVITY_MIN) });
      watchRef.current = state;
      const dr = demoReps.current;
      if (l.phase === 'workout') dr.cur = Math.max(dr.cur, l.reps ?? 0);
      else if (dr.phase === 'workout') {
        dr.done += dr.cur;
        dr.cur = 0;
      }
      dr.phase = l.phase ?? '';
      const v = fromDemo(l, r, dr.done + dr.cur);
      const ser = demoSeries.current;
      v.links.forEach((lk, k) => {
        const base = [-48, -54, -61][k] ?? -55;
        const val = base - (lk.z - 0.8) * 0.9 + (Math.random() - 0.5) * (0.6 + (lk.z - 0.8) * 1.4) + (l.phase === 'workout' && k === 0 ? 3 * Math.sin(sec * 2.6) : 0);
        ser[lk.id] = pushN(ser[lk.id] ?? [], val);
      });
      setSeries(v.links.map((lk) => ({ id: lk.id, values: ser[lk.id] })));
      setWatch(state);
      setReading(r);
      setView(v);
      setEnergyHist((h) => pushN(h, l.energy));
      addKcal(v, r, (DEMO_MS / 1000) * 60); // the demo clock runs 60x
    }, DEMO_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Hub: the UNO Q through the laptop's proxy, once a second
  useEffect(() => {
    if (mode !== 'hub' || !config?.configured) return;
    let alive = true;
    let timer: number | undefined;
    const tick = async () => {
      const [h, s, v, e] = await Promise.all([get<RvHealth>('health'), get<HubSensing>('sensing/latest'), get<RvVitals>('vital-signs'), get<RvEdge>('edge-vitals')]);
      if (!alive) return;
      setAuthFail(Boolean(h) && !s && (await fetch('/api/ruview/status').then((x) => x.status === 401).catch(() => false)));
      const { reading: r, reason } = attribute(normalize(Date.now(), h, s, v, e), onlyMeRef.current, meRef.current);
      setPausedWhy(reason);
      const { state } = step(watchRef.current, r, settingsRef.current);
      watchRef.current = state;
      const mv = fromHub(s, r);
      setReading(r);
      setView(mv);
      setWatch(state);
      setEnergyHist((hh) => pushN(hh, mv.energy, 60));
      if (r.live) addKcal(mv, r, POLL_MS / 1000);
      save(KEY, state);
      if (s?.source === 'rssi') {
        const raw = await get<{ links?: Record<string, number[]>; rssi?: number[] }>('rssi/recent?seconds=12');
        if (alive && raw) setSeries(raw.links ? Object.entries(raw.links).map(([id, values]) => ({ id, values })) : [{ id: 'link', values: raw.rssi ?? [] }]);
      }
      timer = window.setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, config?.configured]);

  useEffect(() => save(CKEY, { day: dayKey(Date.now()), kcal: Math.round(kcal * 10) / 10 }), [kcal]);

  useEffect(() => {
    if (mode !== 'hub') return;
    let alive = true;
    const poll = () =>
      void fetch('/api/me', { cache: 'no-store' })
        .then((x) => (x.ok ? (x.json() as Promise<MeStatus>) : null))
        .catch(() => null)
        .then((m) => alive && setMe(m));
    poll();
    const id = window.setInterval(poll, 15_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [mode]);

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
  const calibrate = async () => {
    if (mode !== 'hub') return flash('Calibration runs on the live hub');
    const r = await post<{ calibrated: Record<string, unknown> }>('calibrate/empty', {});
    flash(r ? `Calibrated ${Object.keys(r.calibrated ?? {}).length} links to the empty room` : 'Hub didn’t answer');
  };
  const label = async (l: string) => {
    setLabels((x) => [{ label: l, at: Date.now() }, ...x].slice(0, 30));
    if (mode === 'hub') await post('label', { label: l });
    flash(`Marked: ${l}`);
  };

  const demo = mode === 'demo';
  const r = reading;
  const v = view;
  const open = watch.alerts.filter((a) => Object.values(watch.open).includes(a.id));
  const critical = open.find((a) => a.severity === 'critical');
  const status = demo ? 'demo' : !r ? 'connecting' : !r.reachable ? 'offline' : authFail ? 'locked' : r.simulated ? 'simulated' : r.live ? 'live' : 'waiting';
  const needsSetup = mode === 'hub' && config && !config.configured;
  const stillMin = r?.presence && r.motion === 'still' && watch.lastMoveAt ? Math.floor((r.at - watch.lastMoveAt) / 60_000) : 0;
  const activeMin = Math.round(watch.activeMs / 60_000);
  const intenseMin = v?.totals ? mins(v.totals.intenseS) : demo ? Math.round(activeMin * 0.4) : null;
  const setsDone = v?.sets.length ?? 0;

  return (
    <div className="monitor">
      <div className="page-head">
        <div>
          <p className="eyebrow">WiFi sensing</p>
          <h1>Home</h1>
        </div>
        <div className="head-actions">
          <div className="segmented" role="tablist" aria-label="Source">
            <button className={demo ? 'on' : ''} onClick={() => setMode('demo')}>
              Demo
            </button>
            <button className={!demo ? 'on' : ''} onClick={() => setMode('hub')}>
              Live hub
            </button>
          </div>
          <StatusChip status={status} source={r?.source} paused={onlyMe && !demo ? pausedWhy : null} links={v?.links.filter((l) => l.live).length ?? 0} />
          <button className="icon-btn" onClick={() => setPanel('settings')} aria-label="Monitor settings">
            ⚙
          </button>
        </div>
      </div>

      {critical && (
        <div className="mon-critical" role="alert">
          <IconAlert size={26} />
          <div>
            <strong>{critical.title}</strong>
            <p>{critical.detail}</p>
          </div>
          <button className="btn" onClick={() => ack(critical.id)}>
            I’ve checked
          </button>
        </div>
      )}
      {!demo && status === 'offline' && <Notice tone="warn" title="Can’t reach the hub" body="Board on? Same hotspot? RUVIEW_URL right?" onMore={() => setPanel('how')} />}
      {!demo && authFail && <Notice tone="warn" title="Token rejected" body="Copy RUVIEW_API_TOKEN from the board into .env and restart." />}

      {needsSetup ? (
        <SetupCard onDemo={() => setMode('demo')} />
      ) : (
        <Bento>
          <Widget label="Room" icon={<IconWifi />} span={2} tall live={status === 'live' || demo} onOpen={() => setPanel('room')} badge={<span className="pill">{v?.zone ?? v?.activity ?? '…'}</span>}>
            {v ? <RoomView nodes={v.nodes} links={v.links} field={v.presence ? v.field : null} position={v.position} room={v.room} presence={v.presence} label={!v.presence ? (status === 'offline' ? 'Offline' : 'Nobody here') : undefined} /> : <div className="rv-skel" />}
          </Widget>

          <Widget label="Signal" icon={<IconPulse />} span={2} onOpen={() => setPanel('signal')} badge={<span className="pill">{series.length} links</span>}>
            <LinkScope series={series} height={96} />
            <div className="scope-legend">
              {series.map((s, k) => (
                <span key={s.id}>
                  <i style={{ background: scopeColor(k) }} />
                  {s.id.replace('-', ' ↔ ')}
                </span>
              ))}
            </div>
          </Widget>

          <Widget label="Now" value={v?.activity ?? '—'} sub={v?.periodic ? `${v.cadence ?? '–'} reps/min` : stillMin ? `still ${stillMin} min` : v?.zone ?? ' '} tone={v?.periodic ? 'accent' : undefined} className="w-now">
            <Spark data={energyHist} max={1} />
          </Widget>

          <Widget label="Reps today" value={v?.reps ?? 0} sub={v?.periodic ? 'counting…' : setsDone ? `${setsDone} set${setsDone > 1 ? 's' : ''}` : 'train across a link'} tone="accent" onOpen={() => setPanel('reps')} />

          <Widget label="Active" value={activeMin} unit="min" sub={intenseMin != null ? `${intenseMin} min hard` : undefined} tone="good">
            <Ring value={activeMin} max={30} size={44} stroke={5} color="var(--good)" />
          </Widget>

          <Widget label="Burned at home" value={Math.round(kcal)} unit="kcal" sub={`est. from activity × ${Math.round(kg)} kg`} />

          <Widget
            label="Breathing"
            icon={<IconHeart />}
            value={camBreath?.bpm ? camBreath.bpm : v?.breathing.bpm ? Math.round(v.breathing.bpm) : '—'}
            unit={camBreath?.bpm || v?.breathing.bpm ? '/min' : undefined}
            sub={camBreath?.bpm ? `camera · ${Math.round(camBreath.confidence * 100)}% sure` : v?.breathing.bpm ? `WiFi · ${Math.round(v.breathing.confidence * 100)}% sure` : cam.on ? cam.breath?.why ?? 'measuring…' : 'phone on chest, or start the camera'}
            badge={v?.breathing.experimental ? <span className="pill warn">beta</span> : undefined}
            onOpen={() => setPanel('vitals')}
          />

          <Widget
            label="Heart rate"
            icon={<IconHeart />}
            live={cam.on && Boolean(hrLive?.bpm)}
            value={cam.on && hrLive?.bpm ? hrLive.bpm : hr ? hr.bpm : '—'}
            unit={hr || hrLive?.bpm ? 'bpm' : undefined}
            tone={hr || hrLive?.bpm ? 'danger' : undefined}
            onOpen={() => setPanel('heart')}
          >
            <button
              className={`btn ${cam.on ? '' : 'btn-primary'}`}
              style={{ minHeight: 34, padding: '4px 12px', alignSelf: 'flex-start' }}
              onClick={(e) => {
                e.stopPropagation();
                vitals.set({ on: !cam.on, ...(cam.on ? { hr: null } : {}) });
              }}
            >
              {cam.on ? 'Stop' : 'Turn on'}
            </button>
          </Widget>

          <Widget label="Safety" icon={<IconShield />} value={open.length ? `${open.length} alert${open.length > 1 ? 's' : ''}` : 'All clear'} tone={critical ? 'danger' : open.length ? 'warn' : 'good'} sub={v?.interference ? 'radio noise: paused' : 'falls · stillness · offline'} onOpen={() => setPanel('safety')} />

          <Widget label="Rest" icon={<IconMoon />} value={v?.totals ? mins(v.totals.lyingS) : stillMin} unit="min" sub={v?.totals ? `${v.totals.restless} restless moments` : 'lying still'} onOpen={() => setPanel('rest')} />

          <Widget label="Sitting streak" value={stillMin} unit="min" tone={stillMin >= 30 ? 'warn' : undefined} sub={stillMin >= 30 ? 'time to move' : 'resets when you move'} />

          <Widget label="Today" span={2} className="w-timeline">
            <Timeline minutes={watch.timeline} at={r?.at ?? Date.now()} />
          </Widget>

          <Widget label="Teach FitMax" span={2} onOpen={() => setPanel('record')} sub="Label what you’re doing; it becomes your training data." badge={<span className="pill">{labels.length}</span>}>
            <div className="chips mini-chips" onClick={(e) => e.stopPropagation()}>
              {LABELS.slice(0, 5).map((l) => (
                <button key={l} className="chip-toggle" onClick={() => void label(l)}>
                  {l}
                </button>
              ))}
            </div>
          </Widget>
        </Bento>
      )}

      {toast && <div className="toast">{toast}</div>}

      {panel === 'room' && v && (
        <Sheet title="Your room, through WiFi" onClose={() => setPanel(null)} wide>
          <RoomView nodes={v.nodes} links={v.links} field={v.field} position={v.position} room={v.room} presence={v.presence} />
          <p className="small muted" style={{ marginTop: 10 }}>
            Each line is a radio link between two of your devices. Your body is mostly water, so it absorbs and scatters 2.4 GHz WiFi: links you stand near dim and jitter. Comparing all the links gives the heat map (radio tomographic imaging).
          </p>
          <button className="btn" style={{ marginTop: 12 }} onClick={() => setPanel('how')}>
            What WiFi can measure
          </button>
        </Sheet>
      )}
      {panel === 'signal' && (
        <Sheet title="Links" onClose={() => setPanel(null)} wide>
          <LinkScope series={series} height={180} />
          <div style={{ marginTop: 10 }}>
            {(v?.links ?? []).map((l) => (
              <Row key={l.id} k={`${l.a} ↔ ${l.b}`} hint={`${l.kind === 'ble' ? 'Bluetooth LE' : 'WiFi'}${l.calibrated ? ' · calibrated' : ''}${l.sparse ? ' · flickering' : ''}${l.live ? '' : ' · no data'}`} v={`${l.rssi != null ? `${Math.round(l.rssi)} dBm · ` : ''}${l.z.toFixed(1)}×`} />
            ))}
          </div>
          <p className="tiny muted" style={{ marginTop: 8 }}>
            × = how much more the link is moving than when the room is empty. Over 2.4× for a second counts as motion.
          </p>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => void calibrate()}>
            Calibrate empty room
          </button>
          <p className="tiny muted" style={{ marginTop: 6 }}>
            Step out of the triangle for 15 s first.
          </p>
        </Sheet>
      )}
      {panel === 'reps' && (
        <Sheet title="Reps" onClose={() => setPanel(null)}>
          <Row k="Today" v={v?.reps ?? 0} />
          {(v?.sets ?? []).map((s, i) => (
            <Row key={i} k={`Set ${i + 1}`} hint={s.ended ? new Date(s.ended * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : undefined} v={`${s.reps} reps · ${s.cadence ?? '–'}/min`} />
          ))}
          <p className="tiny muted" style={{ marginTop: 10 }}>
            Counted from the rhythm your body makes crossing a link: needs a clear wave (≥2 dB, regular period, same link). Level flicker and walking laps don’t count. Typical error ±1–2 reps.
          </p>
        </Sheet>
      )}
      {panel === 'vitals' && (
        <Sheet title="Breathing & heart" onClose={() => setPanel(null)}>
          <Row k="Breathing" v={v?.breathing.bpm ? `${Math.round(v.breathing.bpm)} /min` : '—'} hint={v?.breathing.why ?? undefined} />
          <Row k="Heart rate" v={hr ? `${hr.bpm} bpm` : v?.heart && demo ? `${v.heart} bpm` : '—'} hint={hr ? 'from the webcam' : demo ? 'demo values' : 'WiFi RSSI can’t see a heartbeat: use the webcam widget'} />
          <p className="tiny muted" style={{ marginTop: 10 }}>
            Breathing from signal strength works when you lie or sit still with your chest close to a link (Patwari et al., 2014; UbiBreathe, 2015). FitMax only shows a number when the rhythm is clear, otherwise it says why not. Not a medical device.
          </p>
        </Sheet>
      )}
      {panel === 'rest' && (
        <Sheet title="Rest" onClose={() => setPanel(null)}>
          <Row k="Lying still" v={`${v?.totals ? mins(v.totals.lyingS) : 0} min`} hint="still for 5+ minutes" />
          <Row k="Restless moments" v={v?.totals?.restless ?? 0} hint="movement after a long still stretch" />
          <Row k="At home" v={`${v?.totals ? mins(v.totals.presentS) : Math.round(watch.presentMs / 60_000)} min`} />
        </Sheet>
      )}
      {panel === 'safety' && (
        <Sheet title="Safety" onClose={() => setPanel(null)}>
          {watch.alerts.length === 0 ? (
            <p className="muted small">No alerts yet. FitMax raises one for a possible fall, a long stillness while someone is home, or the hub going offline.</p>
          ) : (
            <ul className="list mon-alerts">
              {watch.alerts.slice(0, 12).map((a) => (
                <AlertRow key={a.id} a={a} onAck={() => ack(a.id)} />
              ))}
            </ul>
          )}
          {v?.interference && <p className="small warn" style={{ marginTop: 10 }}>2.4 GHz noise jump (microwave, Bluetooth audio, a nearby router): motion and falls are paused so it can’t fake an alert.</p>}
        </Sheet>
      )}
      {panel === 'record' && (
        <Sheet title="Teach FitMax" onClose={() => setPanel(null)}>
          <p className="small muted">Tap what you’re doing as you start it. Labels are stored on the hub with the raw signal (GET /api/v1/rssi/recent?seconds=300), building a dataset of your home for a model that’s tuned to it.</p>
          <div className="chips" style={{ margin: '12px 0' }}>
            {LABELS.map((l) => (
              <button key={l} className="chip-toggle" onClick={() => void label(l)}>
                {l}
              </button>
            ))}
          </div>
          {labels.slice(0, 8).map((l) => (
            <Row key={l.at} k={l.label} v={new Date(l.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })} />
          ))}
        </Sheet>
      )}
      {panel === 'settings' && (
        <Sheet title="Monitor settings" onClose={() => setPanel(null)}>
          <label className="field">
            <span>Alert if someone home hasn’t moved for</span>
            <select className="input" value={settings.inactivityMin} onChange={(e) => updateSettings({ ...settings, inactivityMin: Number(e.target.value) })}>
              {[15, 30, 45, 60, 90, 120, 180].map((m) => (
                <option key={m} value={m}>
                  {m < 60 ? `${m} min` : `${m / 60} h`}
                </option>
              ))}
            </select>
          </label>
          <label className="setting">
            <span>
              <strong className="small">Only track me</strong>
              <span className="tiny muted" style={{ display: 'block' }}>
                Credit activity only when one person is sensed{me?.configured ? ' and your phone is home' : ''}. Falls still cover anyone.
              </span>
            </span>
            <input
              type="checkbox"
              className="switch"
              checked={onlyMe}
              onChange={(e) => {
                setOnlyMe(e.target.checked);
                save(OKEY, { v: e.target.checked });
              }}
            />
          </label>
          <LayoutEditor current={v?.room} onSave={async (room, nodes) => flash((await post('layout', { room, nodes })) ? 'Layout saved on the hub' : 'Layout needs the live hub')} />
          <button className="btn" style={{ marginTop: 12 }} onClick={() => void calibrate()}>
            Calibrate empty room
          </button>
          {!demo && config?.hub && <p className="tiny muted" style={{ marginTop: 10 }}>Hub {config.hub}</p>}
        </Sheet>
      )}
      {panel === 'heart' && (
        <Sheet title="Heart rate & breathing · webcam" onClose={() => setPanel(null)}>
          <Row k="Heart rate" v={hrLive?.bpm ? `${hrLive.bpm} bpm` : hr ? `${hr.bpm} bpm (last)` : '—'} hint={hrLive?.bpm ? `${Math.round(hrLive.confidence * 100)}% sure · SNR ${hrLive.snr.toFixed(1)} dB` : hrLive?.why ?? (cam.on ? 'starting…' : 'camera off')} />
          {hrLive?.wave?.length ? <Spark data={hrLive.wave} color="var(--danger)" height={46} fill={false} /> : null}
          <Row k="Breathing (camera)" v={cam.breath?.bpm ? `${cam.breath.bpm} /min` : '—'} hint={cam.breath?.bpm ? `${Math.round(cam.breath.confidence * 100)}% sure · from your shoulders` : cam.breath?.why ?? 'needs the camera on'} />
          <Row k="Breathing (WiFi)" v={v?.breathing.bpm ? `${Math.round(v.breathing.bpm)} /min` : '—'} hint={v?.breathing.why ?? 'lie still, phone on your chest'} />
          <button className={`btn ${cam.on ? '' : 'btn-primary'}`} style={{ marginTop: 12 }} onClick={() => vitals.set({ on: !cam.on, ...(cam.on ? { hr: null } : {}) })}>
            {cam.on ? 'Stop camera' : 'Turn camera back on'}
          </button>
          <p className="tiny muted" style={{ marginTop: 8 }}>
            Sit about 50 cm away, face lit from the front, shoulders in view. Heart rate = remote photoplethysmography (POS method, Wang et al. 2017): the pulse changes how much light your facial skin absorbs. Breathing = the rise and fall of your shoulders. ±5 bpm at rest; worse with movement or dim light. The camera starts by itself when you open Monitor and keeps measuring in the background on every tab, with no preview window, until you press Stop. Your browser's camera light stays on while it runs. Video never leaves this laptop. Not a medical device.
          </p>
        </Sheet>
      )}
      {panel === 'how' && <HowSheet caps={v?.capabilities ?? null} onClose={() => setPanel(null)} />}
    </div>
  );
}

function StatusChip({ status, source, paused, links }: { status: string; source?: string; paused: string | null; links: number }) {
  const map: Record<string, [string, string]> = {
    demo: ['good', 'Demo day'],
    live: ['good', `Live · ${links} link${links === 1 ? '' : 's'}${source && source !== 'rssi' ? ` · ${source}` : ''}`],
    simulated: ['warn', 'Simulated'],
    offline: ['bad', 'Offline'],
    locked: ['bad', 'Token rejected'],
    waiting: ['warn', 'Waiting'],
    connecting: ['', 'Connecting…'],
  };
  const [tone, text] = map[status] ?? ['', status];
  return (
    <span className="status-chip">
      <i className={`dot ${tone}`} />
      {paused ? `Paused: ${paused}` : text}
    </span>
  );
}

function Notice({ tone, title, body, onMore }: { tone: 'warn' | 'info'; title: string; body: string; onMore?: () => void }) {
  return (
    <div className={`mon-note ${tone === 'warn' ? 'warn' : ''}`}>
      <IconWifi size={18} />
      <span>
        <strong>{title}.</strong> {body}{' '}
        {onMore && (
          <button className="linklike" onClick={onMore}>
            Help
          </button>
        )}
      </span>
    </div>
  );
}

function LayoutEditor({ current, onSave }: { current?: [number, number]; onSave: (room: [number, number], nodes: Record<string, [number, number]>) => void }) {
  const [w, setW] = useState(current?.[0] ?? 4);
  const [h, setH] = useState(current?.[1] ?? 3);
  const nodes = useMemo<Record<string, [number, number]>>(() => ({ uno: [0.3, h / 2], ap: [w - 0.3, h / 2], laptop: [w / 2, h - 0.3] }), [w, h]);
  return (
    <div className="layout-ed">
      <span className="small" style={{ fontWeight: 650 }}>
        Room & devices
      </span>
      <div className="row">
        <label className="field" style={{ flex: 1 }}>
          <span>Width (m)</span>
          <input className="input" type="number" min={2} max={12} step={0.5} value={w} onChange={(e) => setW(Number(e.target.value))} />
        </label>
        <label className="field" style={{ flex: 1 }}>
          <span>Depth (m)</span>
          <input className="input" type="number" min={2} max={12} step={0.5} value={h} onChange={(e) => setH(Number(e.target.value))} />
        </label>
      </div>
      <p className="tiny muted">Board on the left wall, phone hotspot on the right, laptop in the middle of the near wall, all about chest height.</p>
      <button className="btn" onClick={() => onSave([w, h], nodes)}>
        Save layout
      </button>
    </div>
  );
}

function SetupCard({ onDemo }: { onDemo: () => void }) {
  return (
    <Bento>
      <Widget label="Set up the hub" span={4} sub="On the board: ./setup.sh rssi → copy RUVIEW_URL and RUVIEW_API_TOKEN into apps/web/.env → restart npm run dev.">
        <button className="btn" onClick={onDemo} style={{ alignSelf: 'flex-start' }}>
          Watch the demo instead
        </button>
      </Widget>
    </Bento>
  );
}

const CAP_ROWS: [string, string, string][] = [
  ['Presence', 'presence', 'Someone home or not, from motion and the link-level drop a body causes.'],
  ['Motion & active minutes', 'motion', 'How much the links jitter vs. the empty room.'],
  ['Reps & sets', 'rep_rhythm', 'A regular wave on one link while you train across it.'],
  ['Where in the room', 'position_heatmap', 'Which links are disturbed, combined (radio tomography).'],
  ['Rest & restlessness', 'sleep_restlessness', 'Long still stretches and the movements that break them.'],
  ['Breathing', 'breathing', 'Chest motion modulates a nearby link at 0.1–0.6 Hz.'],
  ['Falls', 'fall', 'A sudden large swing, then stillness in a new spot.'],
  ['Radio noise', 'interference', 'Noise-floor jumps (microwave oven) pause sensing so they can’t fake motion.'],
  ['Heart rate', 'heart_rate', 'Needs channel-state (CSI) hardware such as an ESP32-S3.'],
];

function HowSheet({ caps, onClose }: { caps: Record<string, string> | null; onClose: () => void }) {
  return (
    <Sheet title="What WiFi can measure" onClose={onClose} wide>
      {CAP_ROWS.map(([name, key, how]) => (
        <Row key={key} k={name} hint={how} v={caps?.[key] ? caps[key].split(':')[0] : key === 'heart_rate' ? 'not with RSSI' : '—'} />
      ))}
      <p className="tiny muted" style={{ marginTop: 10 }}>
        Setup: board, phone hotspot and laptop in a triangle 2–4 m apart at chest height; train inside it. Metal racks and mirrors reflect WiFi, water (aquariums, people) absorbs it, wood and fabric barely matter.
      </p>
    </Sheet>
  );
}

function Timeline({ minutes, at }: { minutes: Minute[]; at: number }) {
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
        <span className="mon-legend">
          {(['active', 'moving', 'still', 'absent'] as const).map((m) => (
            <span key={m}>
              <i className={`m-${m}`} /> {m === 'absent' ? 'away' : m}
            </span>
          ))}
        </span>
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
        <span className="tiny muted"> · {time}</span>
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

export type { Live };
