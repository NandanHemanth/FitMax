import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { geocode } from '../places/data';
import { scoreTone } from '../places/score';
import { byKey, CATALOG, GOAL_ROLES, ROLE_LABEL, ROOMS, type ItemDef, type Role } from '../space/catalog';
import { estimateFootprint, loadFootprint, osmGround, vexcelConfigured, vexcelGround, type Footprint, type Ground, type SpaceHome } from '../space/home';
import { bodyRect, findSpot, newUid, overlap, recommend, scoreSpace, validate, type Issue, type Placed, type Recommendation, type Room } from '../space/layout';
import { HOME_KEY } from '../space/open';
import { loadScan, reorient, scanObstacles, type Scan } from '../space/scan';
import { Space3D, type Space3DHandle } from '../space/Space3D';
import { useApp } from '../state/app';
import { GOALS, type Goal } from '../state/profile';
import { IconAlert, IconCheck, IconCube, IconPlus, IconSearch, IconSparkle, IconX } from '../ui/icons';

const CUSTOM_KEY = 'fitmax.space.custom';
const layoutKey = (id: string) => `fitmax.space.layout.${id}`;
const BUDGETS = [500, 1000, 2000, 3000, 5000, 8000, 12000];
const DEFAULT_HOME: SpaceHome = { id: 'w1278644263', name: 'The Langley', addr: '1717 Bissonnet St, Houston', lat: 29.72538, lng: -95.40294 };

const read = <T,>(k: string, fallback: T, store: Storage = localStorage): T => {
  try {
    const v = store.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (k: string, v: unknown, store: Storage = localStorage) => {
  try {
    store.setItem(k, JSON.stringify(v));
  } catch {
    /* storage blocked: the builder still works in memory */
  }
};

interface Saved {
  room: Room;
  preset: string;
  items: Placed[];
}

export function Space() {
  const [home, setHome] = useState<SpaceHome>(() => read(HOME_KEY, DEFAULT_HOME, sessionStorage));
  // A fresh builder per home, so one home's layout never leaks into another's
  return <Builder key={home.id} home={home} setHome={setHome} />;
}

function Builder({ home, setHome }: { home: SpaceHome; setHome: (h: SpaceHome) => void }) {
  const { profile, theme } = useApp();
  const imperial = profile?.units === 'imperial';
  const [footprint, setFootprint] = useState<Footprint | null>(null);
  const [ground, setGround] = useState<Ground | null>(null);
  const [vexcel, setVexcel] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'home' | 'room' | 'tour'>('room');
  const [scan, setScan] = useState<Scan | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanErr, setScanErr] = useState('');
  const [mp, setMp] = useState<{ sdkKey: string | null; apiConfigured: boolean } | null>(null);
  const [mpModel, setMpModel] = useState<string>(() => read<string>('fitmax.space.mpModel', ''));
  const [mpOpen, setMpOpen] = useState<string>('');
  const [custom, setCustom] = useState<ItemDef[]>(() => read<ItemDef[]>(CUSTOM_KEY, []));
  const saved = read<Saved | null>(layoutKey(home.id), null);
  const [preset, setPreset] = useState(saved?.preset ?? 'garage2');
  const [room, setRoom] = useState<Room>(saved?.room ?? { w: 6, l: 6, h: 2.6 });
  const [items, setItems] = useState<Placed[]>(saved?.items ?? []);
  const [selected, setSelected] = useState<string | null>(null);
  const [goal, setGoal] = useState<Goal>(profile?.goal ?? 'general');
  const [budget, setBudget] = useState(3000);
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState('');
  const handle = useRef<Space3DHandle | null>(null);
  const injuries = profile?.injuries ?? [];

  const defs = useCallback((k: string) => byKey(k, custom), [custom]);

  // Load the home's footprint and ground imagery
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFootprint(null);
    setGround(null);
    void (async () => {
      const [fp, vx] = await Promise.all([loadFootprint(home.lat, home.lng).catch(() => estimateFootprint()), vexcelConfigured()]);
      if (!alive) return;
      setFootprint(fp);
      setVexcel(vx);
      const size = Math.min(160, Math.max(60, Math.sqrt(fp.areaM2) * 3));
      const g = (vx ? await vexcelGround(home.lat, home.lng, size) : null) ?? (await osmGround(home.lat, home.lng, size));
      if (!alive) return;
      setGround(g);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [home.lat, home.lng]);

  useEffect(() => {
    fetch('/api/matterport/config')
      .then((r) => (r.ok ? r.json() : null))
      .then(setMp)
      .catch(() => setMp(null));
  }, []);

  const onScanFile = async (file: File | undefined) => {
    if (!file) return;
    setScanBusy(true);
    setScanErr('');
    try {
      const sc = await loadScan(file);
      setScan(sc);
      setRoom({ w: Math.round(sc.w * 10) / 10, l: Math.round(sc.l * 10) / 10, h: Math.min(8, Math.max(2, Math.round(sc.h * 10) / 10)) });
      setPreset('custom');
      setView('room');
    } catch (e) {
      setScanErr(`Couldn't open that file: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    } finally {
      setScanBusy(false);
    }
  };
  const flipScan = () => {
    if (!scan) return;
    const sc = reorient(scan);
    setScan(sc);
    setRoom({ w: Math.round(sc.w * 10) / 10, l: Math.round(sc.l * 10) / 10, h: Math.min(8, Math.max(2, Math.round(sc.h * 10) / 10)) });
  };
  const openTour = () => {
    const id = mpModel.trim().match(/[?&]m=([\w-]+)/)?.[1] ?? mpModel.trim();
    if (!/^[\w-]{6,}$/.test(id)) return;
    write('fitmax.space.mpModel', id);
    setMpModel(id);
    setMpOpen(id);
    setView('tour');
  };

  // Save this home's layout
  useEffect(() => write(layoutKey(home.id), { room, preset, items } satisfies Saved), [home.id, room, preset, items]);
  useEffect(() => write(CUSTOM_KEY, custom), [custom]);

  // Real furniture in a loaded scan (HM3D / Matterport) is fixed: equipment can't go through it
  const obstacles = useMemo(() => (scan ? scanObstacles(scan.object, scan.w, scan.l, scan.h) : []), [scan]);
  const issues = useMemo(() => {
    const base = validate(room, items, defs, injuries);
    const extra: Issue[] = [];
    for (const it of items) {
      const d = defs(it.key);
      if (!d || d.h < 0.05) continue;
      const b = bodyRect(it, d);
      if (obstacles.some((o) => overlap(b, o))) extra.push({ uid: it.uid, severity: 'error', text: `${d.name} sits inside furniture in the scan` });
    }
    return [...base, ...extra];
  }, [room, items, defs, injuries, obstacles]);
  const score = useMemo(() => scoreSpace(room, items, defs, goal, budget, issues), [room, items, defs, goal, budget, issues]);
  const sel = items.find((i) => i.uid === selected) ?? null;
  const selDef = sel ? defs(sel.key) : undefined;

  const len = (m: number) => (imperial ? `${(m * 3.2808).toFixed(1)} ft` : `${m.toFixed(1)} m`);
  const area = (m2: number) => (imperial ? `${Math.round(m2 * 10.764).toLocaleString()} sq ft` : `${Math.round(m2)} m²`);

  const doRecommend = () => {
    const r = recommend(room, goal, budget, injuries, defs);
    setItems(r.items);
    setRec(r);
    setSelected(null);
  };
  const add = (key: string) => {
    const spot = findSpot(room, items, key, defs) ?? { uid: newUid(), key, x: room.w / 2, z: room.l / 2, rot: 0 as const };
    setItems((xs) => [...xs, spot]);
    setSelected(spot.uid);
  };
  const move = useCallback((uid: string, x: number, z: number) => setItems((xs) => xs.map((i) => (i.uid === uid ? { ...i, x, z } : i))), []);
  const rotate = () => sel && setItems((xs) => xs.map((i) => (i.uid === sel.uid ? { ...i, rot: (((i.rot + 90) % 360) as Placed['rot']) } : i)));
  const remove = () => {
    if (!sel) return;
    setItems((xs) => xs.filter((i) => i.uid !== sel.uid));
    setSelected(null);
  };
  const setPresetRoom = (id: string) => {
    setPreset(id);
    const r = ROOMS.find((x) => x.id === id);
    if (r) setRoom({ w: r.w, l: r.l, h: r.h });
  };
  const exportPng = () => {
    const url = handle.current?.snapshot();
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `fitmax-space-${home.name.replace(/\W+/g, '-').toLowerCase()}.png`;
    a.click();
  };
  const search = async () => {
    if (!q.trim()) return;
    setSearching(true);
    setSearchErr('');
    try {
      const hit = await geocode(q.trim());
      if (!hit) setSearchErr('No match for that address.');
      else {
        const h: SpaceHome = { id: `q:${hit.center[1].toFixed(5)},${hit.center[0].toFixed(5)}`, name: hit.short, addr: hit.name, lat: hit.center[1], lng: hit.center[0] };
        write(HOME_KEY, h, sessionStorage);
        setHome(h);
      }
    } catch {
      setSearchErr('Address search is unavailable right now.');
    } finally {
      setSearching(false);
    }
  };

  const goalRoles = Object.keys(GOAL_ROLES[goal]) as Role[];

  return (
    <div className="space-screen">
      <div className="page-head">
        <div>
          <p className="eyebrow">FitMax your space · 3D home gym builder</p>
          <h1>{home.name}</h1>
          <p className="small muted" style={{ margin: '4px 0 0' }}>
            {home.addr ?? `${home.lat.toFixed(5)}, ${home.lng.toFixed(5)}`}
            {home.score != null && <> · FitMax home score {home.score}</>}
          </p>
        </div>
        <div className="row">
          <div className="seg" role="tablist" aria-label="View">
            <button role="tab" aria-selected={view === 'home'} className={view === 'home' ? 'on' : ''} onClick={() => setView('home')}>
              Home
            </button>
            <button role="tab" aria-selected={view === 'room'} className={view === 'room' ? 'on' : ''} onClick={() => setView('room')}>
              Gym room
            </button>
            {mpOpen && (
              <button role="tab" aria-selected={view === 'tour'} className={view === 'tour' ? 'on' : ''} onClick={() => setView('tour')}>
                Matterport tour
              </button>
            )}
          </div>
        </div>
      </div>

      <form
        className="row space-search"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <div className="field" style={{ flex: 1, margin: 0 }}>
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Any address, e.g. 2727 Kirby Dr, Houston" aria-label="Address" />
        </div>
        <button className="btn" disabled={searching}>
          <IconSearch size={16} /> {searching ? 'Finding…' : 'Load home'}
        </button>
      </form>
      {searchErr && <p className="small" style={{ color: 'var(--danger)' }}>{searchErr}</p>}

      <div className="grid">
        <div className="card col-8 space-stage-card">
          <div className="space-stage">
            <Space3D view={view === 'home' ? 'home' : 'room'} dark={theme === 'dark'} footprint={footprint} ground={ground} room={room} items={items} defs={defs} issues={issues} selected={selected} onSelect={setSelected} onMove={move} handleRef={handle} scan={scan?.object ?? null} />
            {view === 'tour' && mpOpen && (
              <iframe
                className="mp-tour"
                title="Matterport tour"
                src={`https://my.matterport.com/show/?m=${encodeURIComponent(mpOpen)}&play=1&qs=1${mp?.sdkKey ? `&applicationKey=${encodeURIComponent(mp.sdkKey)}` : ''}`}
                allow="fullscreen; xr-spatial-tracking"
                allowFullScreen
              />
            )}
            {loading && <div className="space-loading">Loading the building and imagery…</div>}
            {sel && selDef && view !== 'tour' && (
              <div className="space-toolbar">
                <strong>{selDef.name}</strong>
                <span className="tiny muted">
                  {len(selDef.w)} × {len(selDef.d)} · ${selDef.price.toLocaleString()}
                </span>
                <button className="btn btn-ghost tiny" onClick={rotate}>
                  Rotate 90°
                </button>
                <button className="btn btn-ghost tiny" onClick={remove}>
                  <IconX size={14} /> Remove
                </button>
              </div>
            )}
          </div>
          <div className="row tiny muted space-legend">
            <span>
              <i className="sw ok" /> safe zone
            </span>
            <span>
              <i className="sw warn" /> crowded
            </span>
            <span>
              <i className="sw bad" /> overlap / outside
            </span>
            <span>Drag to move · click to select · drag empty space to orbit</span>
          </div>
          <div className="row tiny muted" style={{ marginTop: 6, gap: 12 }}>
            <span>
              Building:{' '}
              {footprint?.source === 'osm' ? `OpenStreetMap footprint, ${area(footprint.areaM2)}, ${footprint.levels} floor${footprint.levels > 1 ? 's' : ''}, ~${len(footprint.height)} tall` : 'no outline in OpenStreetMap here, showing a typical house'}
            </span>
            <span>
              Ground: {ground ? ground.attribution : '—'}
              {vexcel === false && ' · add VEXCEL_API_KEY to .env for aerial imagery'}
              {vexcel && ground?.source === 'osm' && ' · Vexcel returned no imagery here (see /api/vexcel/check)'}
              {scan && ` · Interior: ${scan.name} (scan)`}
            </span>
          </div>
        </div>

        <div className="col-4 space-side">
          <div className="card">
            <div className="card-head">
              <h2>FitMax Space score</h2>
              <span className={`score-badge ${scoreTone(score.total)}`}>{score.total}</span>
            </div>
            <div className="role-chips">
              {goalRoles.map((r) => (
                <span key={r} className={`role-chip ${score.covered.includes(r) ? 'on' : ''}`}>
                  {score.covered.includes(r) ? <IconCheck size={12} /> : null} {ROLE_LABEL[r]}
                </span>
              ))}
            </div>
            <div className="space-kpis">
              <div>
                <span className="stat-label">Goal coverage</span>
                <strong>{Math.round(score.coverage * 100)}%</strong>
              </div>
              <div>
                <span className="stat-label">Open floor</span>
                <strong>{Math.round(score.openFloor * 100)}%</strong>
              </div>
              <div>
                <span className="stat-label">Cost</span>
                <strong className={score.budgetOk ? '' : 'warn-text'}>${score.cost.toLocaleString()}</strong>
              </div>
            </div>
            <p className="tiny muted" style={{ margin: '8px 0 0' }}>
              50% covers your goal's training, 25% safe clearances, 15% open floor, 10% within budget.
            </p>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Recommend a layout</h2>
            </div>
            <div className="space-form">
              <label className="field">
                <span>Goal</span>
                <select className="input" value={goal} onChange={(e) => setGoal(e.target.value as Goal)}>
                  {GOALS.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Budget</span>
                <select className="input" value={budget} onChange={(e) => setBudget(Number(e.target.value))}>
                  {BUDGETS.map((b) => (
                    <option key={b} value={b}>
                      ${b.toLocaleString()}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button className="btn btn-primary btn-block" onClick={doRecommend}>
              <IconSparkle size={16} /> FitMax this space
            </button>
            {injuries.length > 0 && <p className="tiny muted" style={{ margin: '8px 0 0' }}>Working around: {injuries.join(', ').toLowerCase()}.</p>}
            {rec && (
              <ul className="list small space-rec">
                {rec.swapped.map((s) => (
                  <li key={s.from}>
                    Swapped {defs(s.from)?.name.toLowerCase()} for a {defs(s.to)?.name.toLowerCase()} ({s.injury.toLowerCase()})
                  </li>
                ))}
                {rec.skipped.map((s) => (
                  <li key={s.key} className="muted">
                    Left out {defs(s.key)?.name.toLowerCase()}: {s.why}
                  </li>
                ))}
                {rec.swapped.length + rec.skipped.length === 0 && <li>Everything for your goal fits safely.</li>}
              </ul>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Real interior</h2>
            </div>
            <label className="field">
              <span>3D scan (.glb), e.g. a Habitat-Matterport 3D (HM3D) scene</span>
              <input className="input" type="file" accept=".glb,.gltf,model/gltf-binary" onChange={(e) => void onScanFile(e.target.files?.[0])} disabled={scanBusy} />
            </label>
            {scanBusy && <p className="tiny muted">Loading the scan… large scenes take a few seconds.</p>}
            {scanErr && <p className="tiny" style={{ color: 'var(--danger)' }}>{scanErr}</p>}
            {scan && (
              <div className="row" style={{ marginTop: 6 }}>
                <span className="tiny muted" style={{ flex: 1 }}>
                  {scan.name}: {len(scan.w)} × {len(scan.l)}, {len(scan.h)} tall · {obstacles.length} pieces of furniture detected
                </span>
                <button className="btn btn-ghost tiny" onClick={flipScan}>
                  Flip up-axis
                </button>
                <button className="btn btn-ghost tiny" onClick={() => setScan(null)}>
                  <IconX size={14} /> Remove
                </button>
              </div>
            )}
            <form
              className="row"
              style={{ marginTop: 10, gap: 8, flexWrap: 'nowrap' }}
              onSubmit={(e) => {
                e.preventDefault();
                openTour();
              }}
            >
              <input className="input" value={mpModel} onChange={(e) => setMpModel(e.target.value)} placeholder="Matterport model ID or link" aria-label="Matterport model ID" />
              <button className="btn" disabled={!mpModel.trim()}>
                Tour
              </button>
            </form>
            <p className="tiny muted" style={{ margin: '6px 0 0' }}>
              {mp?.sdkKey ? 'Matterport SDK key loaded from .env.' : 'Public Matterport tours open without a key; add MATTERPORT_SDK_KEY for SDK features.'} HM3D scans are for academic, non-commercial use.
            </p>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Room</h2>
            </div>
            <label className="field">
              <span>Space in this home</span>
              <select className="input" value={preset} onChange={(e) => setPresetRoom(e.target.value)}>
                {ROOMS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · {len(r.w)} × {len(r.l)}
                  </option>
                ))}
                <option value="custom">Custom size</option>
              </select>
            </label>
            <div className="space-form three">
              {(['w', 'l', 'h'] as const).map((k) => (
                <label className="field" key={k}>
                  <span>{k === 'w' ? 'Width' : k === 'l' ? 'Length' : 'Ceiling'} (m)</span>
                  <input className="input"
                    type="number"
                    min={k === 'h' ? 1.8 : 1.5}
                    max={k === 'h' ? 8 : 20}
                    step={0.1}
                    value={room[k]}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && v > 0) {
                        setRoom((r) => ({ ...r, [k]: v }));
                        setPreset('custom');
                      }
                    }}
                  />
                </label>
              ))}
            </div>
            {imperial && (
              <p className="tiny muted" style={{ margin: '4px 0 0' }}>
                {len(room.w)} × {len(room.l)}, {len(room.h)} ceiling
              </p>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Safety check</h2>
              <span className={`pill ${issues.some((i) => i.severity === 'error') ? 'bad-pill' : issues.some((i) => i.severity === 'warn') ? 'warn' : 'good'}`}>
                {issues.filter((i) => i.severity !== 'info').length || 'All clear'}
              </span>
            </div>
            {issues.length === 0 ? (
              <p className="small muted">Every item has its clearance and fits under the ceiling.</p>
            ) : (
              <ul className="list small space-issues">
                {issues.map((i, n) => (
                  <li key={n} className={i.severity} onClick={() => setSelected(i.uid)}>
                    <IconAlert size={14} /> {i.text}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Add equipment</h2>
            </div>
            <ul className="list catalog">
              {[...CATALOG, ...custom].map((d) => (
                <li key={d.key}>
                  <div>
                    <strong className="small">{d.name}</strong>
                    <div className="tiny muted">
                      {len(d.w)} × {len(d.d)} · ${d.price.toLocaleString()}
                      {d.custom && ' · yours'}
                    </div>
                  </div>
                  <button className="btn btn-ghost tiny" onClick={() => add(d.key)} aria-label={`Add ${d.name}`}>
                    <IconPlus size={14} />
                  </button>
                </li>
              ))}
            </ul>
            <CustomForm
              onAdd={(d) => {
                setCustom((c) => [...c, d]);
                setTimeout(() => add(d.key), 0);
              }}
            />
          </div>

          <div className="row">
            <button className="btn" onClick={exportPng}>
              <IconCube size={16} /> Save image
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                setItems([]);
                setRec(null);
              }}
            >
              Clear room
            </button>
          </div>
          <p className="tiny muted">Sizes, prices and clearances are typical values, not a professional install plan. Layouts save automatically for each home.</p>
        </div>
      </div>
    </div>
  );
}

function CustomForm({ onAdd }: { onAdd: (d: ItemDef) => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', w: 1, d: 1, h: 1, clear: 0.6, price: 0, color: '#ff6b2c' });
  if (!open)
    return (
      <button className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={() => setOpen(true)}>
        <IconPlus size={14} /> Your own equipment
      </button>
    );
  const num = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: Number(e.target.value) });
  return (
    <form
      className="custom-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!f.name.trim() || f.w <= 0 || f.d <= 0) return;
        onAdd({
          key: `c-${newUid()}`,
          name: f.name.trim(),
          w: f.w,
          d: f.d,
          h: Math.max(0.02, f.h),
          clear: { front: f.clear, back: f.clear, side: f.clear },
          price: Math.max(0, f.price),
          roles: [],
          shape: 'box',
          color: f.color,
          custom: true,
        });
        setOpen(false);
        setF({ ...f, name: '' });
      }}
    >
      <label className="field">
        <span>Name</span>
        <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Peloton Tread, sauna, boxing bag" required />
      </label>
      <div className="space-form three">
        <label className="field">
          <span>Width (m)</span>
          <input className="input" type="number" step={0.05} min={0.1} value={f.w} onChange={num('w')} />
        </label>
        <label className="field">
          <span>Depth (m)</span>
          <input className="input" type="number" step={0.05} min={0.1} value={f.d} onChange={num('d')} />
        </label>
        <label className="field">
          <span>Height (m)</span>
          <input className="input" type="number" step={0.05} min={0.02} value={f.h} onChange={num('h')} />
        </label>
      </div>
      <div className="space-form three">
        <label className="field">
          <span>Clearance (m)</span>
          <input className="input" type="number" step={0.1} min={0} value={f.clear} onChange={num('clear')} />
        </label>
        <label className="field">
          <span>Price ($)</span>
          <input className="input" type="number" step={10} min={0} value={f.price} onChange={num('price')} />
        </label>
        <label className="field">
          <span>Colour</span>
          <input className="input color" type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} />
        </label>
      </div>
      <div className="row">
        <button className="btn btn-primary">Add to room</button>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
