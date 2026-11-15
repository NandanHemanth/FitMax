import { useEffect, useMemo, useRef, useState } from 'react';
import { recommend, roomBox, score, place, uid, type Item, type Mode, type Rot } from '../interior/engine';
import { TourStage, type TourGear } from '../interior/TourStage';
import { makePlan, trainingCandidates, type Home, type PlanRoom } from '../interior/floorplan';
import { Scene, type SceneHandle } from '../interior/Scene';
import { ERGO_NOTES, THINGS, thing, type Thing } from '../interior/things';
import { HOME_KEY } from '../space/open';
import { useApp } from '../state/app';
import { IconCube, IconSearch, IconSparkle } from '../ui/icons';
import { Bento, Ring, Row, Sheet, Widget } from '../ui/widgets';

const SAVE = (id: number) => `fitmax.interior.${id}`;
const LAST = 'fitmax.interior.home';
const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'space', label: 'Best for space', hint: 'Open floor, walls first' },
  { id: 'fitness', label: 'Best for fitness', hint: 'Train safely, every day' },
  { id: 'modern', label: 'Best modern', hint: 'Calm, supportive, anchored' },
];
const read = <T,>(k: string, f: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : f;
  } catch {
    return f;
  }
};
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* in-memory only */
  }
};
const fmt = (n: number) => n.toLocaleString();

/** Furnish every room once, so the dollhouse opens furnished. */
function furnishAll(rooms: PlanRoom[], goal: Parameters<typeof recommend>[2]): Record<string, Item[]> {
  const out: Record<string, Item[]> = {};
  for (const r of rooms) out[r.id] = r.type === 'hall' ? [] : recommend(roomBox(r), 'modern', goal).items;
  return out;
}

export function Interior() {
  const { profile, theme } = useApp();
  const goal = profile?.goal ?? 'general';
  const injuries = useMemo(() => profile?.injuries ?? [], [profile?.injuries]);
  const [homes, setHomes] = useState<Home[] | null>(null);
  const [home, setHome] = useState<Home | null>(null);
  const [level, setLevel] = useState(0);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [items, setItems] = useState<Record<string, Item[]>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [why, setWhy] = useState<{ mode: Mode; lines: string[]; skipped: string[] } | null>(null);
  const [panel, setPanel] = useState<null | 'homes' | 'library' | 'research' | 'tour' | 'scores'>(null);
  const [q, setQ] = useState('');
  const [wifi, setWifi] = useState(true);
  const [mpKey, setMpKey] = useState<string | null>(null);
  const [tour, setTour] = useState<{ state: 'checking' | 'loading' | 'ready' | 'slow' | 'gone' | 'plain'; why?: string }>({ state: 'checking' });
  const scene = useRef<SceneHandle>(null);

  // CoStar listings (Houston + LA homes on the Matterport capture list)
  useEffect(() => {
    void fetch('/data/homes.json')
      .then((r) => r.json())
      .then((hs: Home[]) => {
        setHomes(hs);
        const last = read<number | null>(LAST, null);
        // Coming from Places ("FitMax this home"): open the nearest CoStar home to that spot
        let fromPlaces: { lat: number; lng: number } | null = null;
        try {
          fromPlaces = JSON.parse(sessionStorage.getItem(HOME_KEY) ?? 'null');
          sessionStorage.removeItem(HOME_KEY);
        } catch {
          /* ignore */
        }
        let h = fromPlaces ? null : hs.find((x) => x.id === last) ?? null;
        if (!h && fromPlaces) h = [...hs].sort((a, b) => Math.hypot(a.lat - fromPlaces.lat, a.lng - fromPlaces.lng) - Math.hypot(b.lat - fromPlaces.lat, b.lng - fromPlaces.lng))[0];
        setHome(h ?? hs.find((x) => x.mpOk && x.garage && x.beds >= 3 && x.city === 'Houston') ?? hs.find((x) => x.mpOk) ?? hs[0]);
      })
      .catch(() => setHomes([]));
    void fetch('/api/matterport/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => setMpKey(c?.sdkKey ?? null))
      .catch(() => undefined);
  }, []);

  const plan = useMemo(() => (home ? makePlan(home) : null), [home]);
  useEffect(() => {
    if (!home || !plan) return;
    write(LAST, home.id);
    setItems(read(SAVE(home.id), null) ?? furnishAll(plan.rooms, goal));
    setRoomId(null);
    setSelected(null);
    setLevel(0);
    setWhy(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);
  useEffect(() => {
    if (home && Object.keys(items).length) write(SAVE(home.id), items);
  }, [items, home]);

  const room = plan && roomId ? plan.rooms.find((r) => r.id === roomId) ?? null : null;
  const box = room ? roomBox(room) : null;
  const roomItems = room ? items[room.id] ?? [] : [];
  // WiFi sensing triangle for this room: board, phone hotspot, laptop at chest height
  const links = useMemo<[[number, number], [number, number]][] | null>(() => {
    if (!room) return null;
    const a: [number, number] = [0.3, room.d / 2];
    const b: [number, number] = [room.w - 0.3, room.d / 2];
    const c: [number, number] = [room.w / 2, room.d - 0.3];
    return [
      [a, b],
      [c, b],
      [c, a],
    ];
  }, [room]);
  const result = useMemo(() => (box ? score(box, roomItems, goal, injuries, links ?? []) : null), [box, roomItems, goal, injuries, links]);
  const sel = selected ? roomItems.find((i) => i.uid === selected) ?? null : null;
  const selT = sel ? thing(sel.key) : null;
  const best = plan ? trainingCandidates(plan)[0] : null;

  const setRoomItems = (list: Item[]) => room && setItems((all) => ({ ...all, [room.id]: list }));
  const apply = (m: Mode) => {
    if (!box || !room) return;
    const rec = recommend(box, m, goal, injuries, links ?? []);
    setRoomItems(rec.items);
    setSelected(null);
    setWhy({ mode: m, lines: rec.why, skipped: rec.skipped });
  };
  const add = (t: Thing) => {
    if (!box) return;
    const p = place(box, roomItems, t.key, {}, 'modern');
    if (p) setRoomItems([...roomItems, p]);
    else setRoomItems([...roomItems, { uid: uid(), key: t.key, x: box.w / 2, z: box.l / 2, rot: 0 }]); // drop in the middle; physics/drag sorts it out
    setPanel(null);
  };
  const rotate = () => sel && setRoomItems(roomItems.map((i) => (i.uid === sel.uid ? { ...i, rot: (((i.rot + 90) % 360) as Rot) } : i)));
  const remove = () => {
    if (!sel) return;
    setRoomItems(roomItems.filter((i) => i.uid !== sel.uid));
    setSelected(null);
  };
  const reset = () => {
    if (!plan || !home) return;
    setItems(furnishAll(plan.rooms, goal));
    setWhy(null);
  };
  const saveImage = () => {
    const url = scene.current?.snapshot();
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `fitmax-${home?.addr.replace(/\W+/g, '-') ?? 'home'}${room ? `-${room.name.replace(/\W+/g, '-')}` : ''}.png`;
    a.click();
  };

  // Opening the tour: confirm Matterport still serves the scan, then time the load
  useEffect(() => {
    if (panel !== 'tour' || !home?.mp) return;
    let off = false;
    setTour({ state: 'checking' });
    void fetch(`/api/matterport/check?m=${home.mp}`)
      .then((r) => r.json())
      .then((c: { ok: boolean | null; status: string }) => {
        if (off) return;
        if (c.ok === false) {
          setTour({ state: 'gone', why: c.status });
          setHomes((hs) => hs?.map((x) => (x.id === home.id ? { ...x, mpOk: false } : x)) ?? hs);
        } else setTour({ state: 'loading' });
      })
      .catch(() => !off && setTour({ state: 'loading' }));
    return () => {
      off = true;
    };
  }, [panel, home?.mp, home?.id]);

  // Gym equipment you've placed anywhere in this home, for pinning inside the real tour
  const tourGear = useMemo<TourGear[]>(() => {
    const out: TourGear[] = [];
    for (const list of Object.values(items))
      for (const it of list) {
        const t = THINGS.find((x) => x.key === it.key);
        if (t && t.cat === 'gym') out.push({ name: t.name, w: t.w, d: t.d, color: t.color, clearance: t.clear.back ? `keep ${t.clear.back} m clear behind` : undefined });
      }
    return out.slice(0, 10);
  }, [items]);

  const nextTourHome = () => {
    if (!homes || !home) return;
    const near = homes.filter((x) => x.mpOk && x.id !== home.id).sort((a, b) => Math.hypot(a.lat - home.lat, a.lng - home.lng) - Math.hypot(b.lat - home.lat, b.lng - home.lng))[0];
    if (near) setHome(near);
  };

  const filtered = useMemo(() => {
    if (!homes) return [];
    const s = q.trim().toLowerCase();
    const list = s ? homes.filter((h) => `${h.addr} ${h.city} ${h.st}`.toLowerCase().includes(s)) : homes.filter((h) => h.mpOk !== false && (h.gym || (h.garage && h.beds >= 3)));
    return list.slice(0, 40);
  }, [homes, q]);

  if (!homes || !home || !plan) return <p className="muted">Loading homes…</p>;
  const issues = result?.issues ?? [];
  const errors = issues.filter((i) => i.level === 'error');

  return (
    <div className="interior">
      <div className="page-head">
        <div>
          <p className="eyebrow">Design · CoStar home</p>
          <h1 className="interior-title">
            {room ? (
              <>
                <button className="linklike" onClick={() => (setRoomId(null), setSelected(null), setWhy(null))}>
                  {home.addr}
                </button>{' '}
                / {room.name}
              </>
            ) : (
              home.addr
            )}
          </h1>
        </div>
        <div className="head-actions">
          {plan.levels > 1 && !room && (
            <div className="segmented">
              {Array.from({ length: plan.levels }, (_, i) => (
                <button key={i} className={level === i ? 'on' : ''} onClick={() => setLevel(i)}>
                  Floor {i + 1}
                </button>
              ))}
            </div>
          )}
          <button className="btn" onClick={() => setPanel('homes')}>
            <IconSearch size={16} /> Homes
          </button>
          {home.mp && (
            <button className="btn" onClick={() => setPanel('tour')}>
              <IconCube size={16} /> Real 3D tour
            </button>
          )}
          <button className="icon-btn" onClick={saveImage} aria-label="Save image">
            ⤓
          </button>
        </div>
      </div>

      <div className="interior-grid">
        <div className="scene-wrap">
          <Scene
            ref={scene}
            plan={plan}
            level={room ? room.level : level}
            items={items}
            roomId={roomId}
            selected={selected}
            dark={theme === 'dark'}
            links={wifi ? links : null}
            onPickRoom={(id) => {
              setRoomId(id);
              setSelected(null);
              setWhy(null);
            }}
            onSelect={setSelected}
            onCommit={(rid, list) => setItems((all) => ({ ...all, [rid]: list }))}
          />
          {!room && (
            <div className="scene-hint">
              Tap a room to step inside{best ? ` · best spot to train: ${best.name}` : ''}
            </div>
          )}
          {room && (
            <div className="mode-bar">
              {MODES.map((m) => (
                <button key={m.id} className={`mode-btn ${why?.mode === m.id ? 'on' : ''}`} onClick={() => apply(m.id)}>
                  <IconSparkle size={15} />
                  <span>
                    <strong>{m.label}</strong>
                    <small>{m.hint}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
          {room && (
            <div className="scene-tools">
              <button className="btn" onClick={() => setPanel('library')}>
                + Add
              </button>
              <label className="chip-toggle" aria-pressed={wifi}>
                <input type="checkbox" checked={wifi} onChange={(e) => setWifi(e.target.checked)} hidden /> WiFi lines
              </label>
            </div>
          )}
        </div>

        <aside className="interior-side">
          {!room ? (
            <Bento className="side-bento">
              <Widget label="Home" span={2} value={`${home.beds} bd · ${home.baths} ba`} sub={`${fmt(home.sqft)} sq ft · ${home.city}, ${home.st}${home.year ? ` · built ${home.year}` : ''}`}>
                {home.thumb && <img className="home-thumb" src={home.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = 'none')} />}
              </Widget>
              <Widget label="Rooms" value={plan.rooms.filter((r) => r.level === level && r.type !== 'hall').length} sub={`${plan.areaM2} m² living`} />
              <Widget label="Train in" value={best?.name ?? '—'} sub={best ? `${best.w.toFixed(1)} × ${best.d.toFixed(1)} m` : undefined} onOpen={best ? () => (setRoomId(best.id), setLevel(best.level)) : undefined} tone="accent" />
              <Widget label="Why these picks" span={2} sub="Back-friendly furniture, safe gym clearances, WiFi-aware layout: the research behind every recommendation." onOpen={() => setPanel('research')} />
            </Bento>
          ) : (
            <Bento className="side-bento">
              <Widget label="Room score" span={2} value={result?.scores.overall ?? 0} unit="/100" onOpen={() => setPanel('scores')} sub={`${room.w.toFixed(1)} × ${room.d.toFixed(1)} m · ${result?.scores.freePct ?? 0}% floor free`}>
                <Ring value={result?.scores.overall ?? 0} max={100} size={48} stroke={5} />
              </Widget>
              <Widget label="Space" value={result?.scores.space ?? 0} tone="data" />
              <Widget label="Fitness" value={result?.scores.fitness ?? 0} tone="accent" />
              <Widget label="Modern" value={result?.scores.modern ?? 0} />
              <Widget label="Back-friendly" value={result?.scores.ergonomics ?? 0} tone="good" />
              <Widget label="WiFi-ready" value={result?.scores.sensing ?? 0} sub="metal/water off the lines" />
              <Widget label="Checks" value={errors.length ? `${errors.length} fix${errors.length > 1 ? 'es' : ''}` : 'Safe'} tone={errors.length ? 'danger' : 'good'} onOpen={() => setPanel('scores')} />
              {sel && selT ? (
                <Widget label={selT.cat === 'gym' ? 'Equipment' : 'Selected'} span={2} value={<span className="sel-name">{selT.name}</span>} sub={selT.ergo?.why ?? selT.note ?? `${selT.w} × ${selT.d} m · ${selT.mass} kg`}>
                  <div className="row">
                    <button className="btn" onClick={rotate}>
                      ↻ Rotate
                    </button>
                    <button className="btn" onClick={remove}>
                      Remove
                    </button>
                    <span className="pill">{selT.rf === 'metal' ? 'reflects WiFi' : selT.rf === 'water' ? 'absorbs WiFi' : 'WiFi-neutral'}</span>
                  </div>
                </Widget>
              ) : why ? (
                <Widget label={MODES.find((m) => m.id === why.mode)?.label ?? ''} span={2}>
                  <ul className="why-list">
                    {why.lines.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                    {why.skipped.length > 0 && <li className="muted">Didn’t fit: {why.skipped.join(', ')}</li>}
                  </ul>
                </Widget>
              ) : (
                <Widget label="Tip" span={2} sub="Pick a recommendation, or drag pieces around: they push each other like real furniture." />
              )}
            </Bento>
          )}
          <div className="row" style={{ marginTop: 8 }}>
            {room && (
              <button className="btn btn-ghost" onClick={reset}>
                Reset whole home
              </button>
            )}
            <button className="btn btn-ghost" onClick={() => (location.hash = '/space')}>
              Use a 3D scan (.glb / HM3D)
            </button>
          </div>
        </aside>
      </div>

      {panel === 'homes' && (
        <Sheet title="CoStar homes (Houston & LA)" onClose={() => setPanel(null)} wide>
          <input className="input" placeholder="Search address or city" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <p className="tiny muted" style={{ margin: '8px 0' }}>
            {q ? `${filtered.length} matches` : 'Homes with a live 3D tour and a gym, or a garage and 3+ bedrooms'} · {fmt(homes.filter((h) => h.mpOk).length)} of {fmt(homes.length)} scans still live on Matterport
          </p>
          <div className="home-list">
            {filtered.map((h) => (
              <button key={h.id} className={`home-row ${h.id === home.id ? 'on' : ''}`} onClick={() => (setHome(h), setPanel(null))}>
                {h.thumb ? <img src={h.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} /> : <span className="ph" />}
                <span>
                  <strong>{h.addr}</strong>
                  <small>
                    {h.city} · {h.beds} bd · {h.baths} ba · {fmt(h.sqft)} sq ft{h.garage ? ' · garage' : ''}
                  </small>
                </span>
                {h.mpOk && <span className="pill">3D</span>}
                {h.gym && <span className="pill accent">gym</span>}
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {panel === 'library' && room && (
        <Sheet title={`Add to ${room.name}`} onClose={() => setPanel(null)} wide>
          {(['furniture', 'gym', 'decor'] as const).map((cat) => (
            <div key={cat} style={{ marginBottom: 12 }}>
              <p className="eyebrow">{cat === 'gym' ? 'Gym equipment' : cat}</p>
              <div className="lib-grid">
                {THINGS.filter((t) => t.cat === cat && (t.rooms.includes(room.type) || cat !== 'furniture')).map((t) => (
                  <button key={t.key} className="lib-item" onClick={() => add(t)}>
                    <strong>{t.name}</strong>
                    <small>
                      {t.w}×{t.d} m{t.price ? ` · $${fmt(t.price)}` : ''}
                      {t.ergo ? ` · back ${Math.round(t.ergo.backScore * 10)}/10` : ''}
                    </small>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </Sheet>
      )}
      {panel === 'scores' && result && (
        <Sheet title="Room check" onClose={() => setPanel(null)}>
          <Row k="Space" v={result.scores.space} hint={`${result.scores.freePct}% of the floor is free`} />
          <Row k="Fitness" v={result.scores.fitness} hint="training roles for your goal, a clear floor zone, light, mirror" />
          <Row k="Modern" v={result.scores.modern} hint="style, rug-anchored groups, plants and light, not cluttered" />
          <Row k="Back-friendly" v={result.scores.ergonomics} hint="seat height/depth, firmness, lumbar support" />
          <Row k="WiFi-ready" v={result.scores.sensing} hint="no big metal or water on the sensing lines" />
          <div style={{ marginTop: 10 }}>
            {issues.length === 0 && <p className="small good">No problems found.</p>}
            {issues.map((i, k) => (
              <p key={k} className={`small ${i.level === 'error' ? 'bad' : i.level === 'warn' ? 'warn' : 'muted'}`}>
                {i.level === 'error' ? '✕' : i.level === 'warn' ? '!' : '·'} {i.text}
              </p>
            ))}
          </div>
        </Sheet>
      )}
      {panel === 'research' && (
        <Sheet title="The research behind the picks" onClose={() => setPanel(null)} wide>
          {ERGO_NOTES.map((n) => (
            <Row key={n.title} k={n.title} hint={n.body} v="" />
          ))}
        </Sheet>
      )}
      {panel === 'tour' && home.mp && (
        <Sheet title="Real 3D tour (Matterport)" onClose={() => setPanel(null)} wide>
          {tour.state === 'gone' ? (
            <div className="mp-tour mp-msg">
              <strong>Matterport no longer serves this scan</strong>
              <span>{tour.why}. The listing was likely sold or taken down.</span>
              <button className="btn btn-primary" onClick={nextTourHome}>
                Open the nearest home with a live tour
              </button>
            </div>
          ) : (
            <div className="mp-wrap">
              {tour.state !== 'checking' && (
                <TourStage key={home.mp} model={home.mp} sdkKey={mpKey} gear={tourGear} onState={(st, why) => setTour((t) => (t.state === 'gone' ? t : { state: st, why }))} />
              )}
              {(tour.state === 'checking' || tour.state === 'loading' || tour.state === 'slow') && (
                <div className="mp-msg mp-over">
                  <span className="spinner" />
                  <span>{tour.state === 'checking' ? 'Checking the scan…' : tour.state === 'slow' ? 'Still loading. Matterport sends 20–40 MB, slow on a hotspot.' : 'Loading the 3D tour…'}</span>
                  {tour.state === 'slow' && (
                    <a className="btn" href={`https://my.matterport.com/show/?m=${home.mp}&play=1&qs=1`} target="_blank" rel="noreferrer">
                      Open in a new tab
                    </a>
                  )}
                </div>
              )}
            </div>
          )}
          {tour.state === 'plain' && tour.why && <p className="tiny muted" style={{ marginTop: 6 }}>{tour.why}</p>}
          <p className="small" style={{ marginTop: 8 }}>
            <a href={`https://my.matterport.com/show/?m=${home.mp}&play=1&qs=1`} target="_blank" rel="noreferrer">
              Open in a new tab
            </a>
          </p>
        </Sheet>
      )}
    </div>
  );
}
