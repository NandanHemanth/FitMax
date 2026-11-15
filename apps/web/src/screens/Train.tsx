import { useState } from 'react';
import { FLAG_CUE, FLAG_LABEL, type Flag, type Rep, type SetSummary, type Side } from '../engine/curl';
import { useApp } from '../state/app';
import { saveSet, type SavedSet, type Settings } from '../store';
import { DemoFigure } from '../ui/DemoFigure';
import { IconBolt, IconDumbbell, IconPlay } from '../ui/icons';
import { LiveSet } from '../ui/LiveSet';
import { loadPose } from '../ui/pose';
import { unlockVoice } from '../ui/voice';

type View = { name: 'overview' } | { name: 'demo' } | { name: 'live' } | { name: 'summary'; set: SavedSet };

const tone = (s: number) => (s >= 85 ? 'good' : s >= 60 ? 'warn' : 'bad');

export function Train() {
  const { settings, updateSettings, sets, refreshSets, profile } = useApp();
  const [view, setView] = useState<View>({ name: 'overview' });
  const [style, setStyle] = useState('gym');

  const start = () => {
    unlockVoice();
    void loadPose().catch(() => undefined);
    setView({ name: 'demo' });
  };

  const done = (summary: SetSummary, reps: Rep[], side: Side) => {
    const set: SavedSet = { id: crypto.randomUUID?.() ?? String(Date.now()), exercise: 'bicep-curl', at: new Date().toISOString(), side, summary, reps };
    if (summary.reps > 0) {
      saveSet(set);
      refreshSets();
    }
    setView({ name: 'summary', set });
  };

  if (view.name === 'live') return <LiveSet settings={settings} onDone={done} onCancel={() => setView({ name: 'overview' })} />;
  if (view.name === 'demo') return <Demo onReady={() => setView({ name: 'live' })} onBack={() => setView({ name: 'overview' })} />;
  if (view.name === 'summary') return <Summary set={view.set} onAgain={start} onHome={() => setView({ name: 'overview' })} />;

  const knee = profile?.injuries.some((i) => ['Elbow', 'Wrist', 'Shoulder'].includes(i));

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">AI form coach</p>
          <h1>Train</h1>
          <p className="muted">Live rep counting, form scoring and voice cues. The camera feed stays on this device.</p>
        </div>
        <select className="input" style={{ width: 'auto', minWidth: 130, alignSelf: 'flex-start' }} value={style} onChange={(e) => setStyle(e.target.value)} aria-label="Workout type">
          <option value="gym">Gym</option>
          <option value="yoga">Yoga</option>
          <option value="pilates">Pilates</option>
        </select>
      </div>
      <div className="grid">
        <section className="card hero-card col-7">
          <div className="train-hero">
            <div>
              <span className="pill accent">
                <IconDumbbell size={14} /> Bicep curls
              </span>
              <h1 style={{ marginTop: 10 }}>Curl with a coach watching every rep</h1>
              <p className="muted" style={{ margin: '6px 0 16px' }}>
                Counts reps, flags elbow drift, swinging and short range, and tells you the one thing to fix.
              </p>
              {knee && (
                <p className="small warn" style={{ marginBottom: 12 }}>
                  You listed an arm or shoulder injury: start light and stop if it hurts.
                </p>
              )}
              <div className="row">
                <button className="btn btn-primary btn-lg" onClick={start}>
                  <IconBolt size={18} /> Start curls
                </button>
                <button className="btn btn-lg" onClick={() => setView({ name: 'demo' })}>
                  <IconPlay size={16} /> Watch the ideal rep
                </button>
              </div>
            </div>
            <DemoFigure />
          </div>
        </section>
        <section className="card col-5">
          <h2>Setup</h2>
          <Segmented
            label="Arm"
            value={settings.side}
            options={[
              ['auto', 'Auto'],
              ['left', 'Left'],
              ['right', 'Right'],
            ]}
            onChange={(v) => updateSettings({ side: v as Settings['side'] })}
          />
          <Segmented
            label="Camera"
            value={settings.camera}
            options={[
              ['user', 'Front'],
              ['environment', 'Back'],
            ]}
            onChange={(v) => updateSettings({ camera: v as Settings['camera'] })}
          />
          <Toggle label="Voice coaching" checked={settings.voice} onChange={(voice) => updateSettings({ voice })} />
          <Toggle label="Count reps aloud" checked={settings.countAloud} onChange={(countAloud) => updateSettings({ countAloud })} />
          <Toggle label="Show ideal-rep ghost" checked={settings.ghost} onChange={(ghost) => updateSettings({ ghost })} />
          <p className="small muted" style={{ marginTop: 8 }}>
            Prop the camera at hip height about 2 m away, side-on, so your shoulder, elbow, wrist and hip are in view.
          </p>
        </section>

        <section className="card col-12">
          <div className="card-head">
            <h2>Recent sets</h2>
            <span className="tiny muted">{sets.length} total</span>
          </div>
          {sets.length === 0 ? (
            <p className="muted">No sets yet. Your first set shows up here with a rep-by-rep breakdown.</p>
          ) : (
            <ul className="list">
              {sets.slice(0, 8).map((s) => (
                <li key={s.id}>
                  <button className="row" style={{ width: '100%', background: 'none', border: 0, padding: 0, textAlign: 'left' }} onClick={() => setView({ name: 'summary', set: s })}>
                    <span style={{ flex: 1 }}>
                      <strong>{new Date(s.at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</strong>
                      <br />
                      <span className="small muted">
                        {s.summary.reps} reps · {s.side} arm · {Math.round(s.summary.avgRom)}° range
                      </span>
                    </span>
                    <span className={`pill ${tone(s.summary.avgScore) === 'good' ? 'good' : 'warn'}`}>Form {Math.round(s.summary.avgScore)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

function Demo({ onReady, onBack }: { onReady: () => void; onBack: () => void }) {
  return (
    <div className="grid" style={{ maxWidth: 760, margin: '0 auto' }}>
      <section className="card col-12">
        <p className="eyebrow">Watch one rep</p>
        <h1>The ideal curl</h1>
        <DemoFigure />
        <ul className="rules">
          <li>
            <strong>Elbow pinned</strong> to your side the whole set.
          </li>
          <li>
            <strong>Full range:</strong> straight arm at the bottom, full squeeze at the top.
          </li>
          <li>
            <strong>Tempo:</strong> about 2 s up, 2 to 3 s down.
          </li>
          <li>
            <strong>No swinging.</strong> If you have to lean back, the weight is too heavy.
          </li>
        </ul>
        <p className="small muted" style={{ margin: '12px 0' }}>
          The dashed blue arm on the camera view moves at this pace. Follow it.
        </p>
        <div className="row">
          <button className="btn" onClick={onBack}>
            Back
          </button>
          <button className="btn btn-primary btn-lg" style={{ flex: 1 }} onClick={onReady}>
            I'm ready
          </button>
        </div>
      </section>
    </div>
  );
}

function Summary({ set, onAgain, onHome }: { set: SavedSet; onAgain: () => void; onHome: () => void }) {
  const s = set.summary;
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(set, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fitmax-curls-${set.at.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  if (s.reps === 0) {
    return (
      <section className="card" style={{ maxWidth: 640, margin: '0 auto' }}>
        <h1>No reps counted</h1>
        <p className="muted" style={{ marginBottom: 16 }}>
          Stand side-on so your shoulder, elbow, wrist and hip stay in view, and curl from a straight arm to a full squeeze.
        </p>
        <div className="row">
          <button className="btn btn-primary" onClick={onAgain}>
            Try again
          </button>
          <button className="btn" onClick={onHome}>
            Back to Train
          </button>
        </div>
      </section>
    );
  }
  const fix = s.topFix;
  return (
    <div className="grid" style={{ maxWidth: 900, margin: '0 auto' }}>
      <section className="card hero-card col-12">
        <p className="eyebrow">Set complete · {set.side} arm</p>
        <div className="big-score">
          <span className={`ring ${tone(s.avgScore)}`}>{Math.round(s.avgScore)}</span>
          <div>
            <h1>{s.reps} reps</h1>
            <p className="muted">{fix ? `Next set: ${FLAG_CUE[fix as Flag].toLowerCase()}` : 'Clean set. Add weight or a rep next time.'}</p>
          </div>
        </div>
      </section>
      <section className="card col-12">
        <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
          <div className="stat">
            <span className="stat-num">{Math.round(s.avgRom)}°</span>
            <span className="stat-label">avg range</span>
          </div>
          <div className="stat">
            <span className="stat-num">
              {s.avgUpSec.toFixed(1)}/{s.avgDownSec.toFixed(1)}s
            </span>
            <span className="stat-label">up / down</span>
          </div>
          <div className="stat">
            <span className="stat-num">{Math.round(s.timeUnderTensionSec)}s</span>
            <span className="stat-label">under tension</span>
          </div>
        </div>
      </section>
      <section className="card col-12">
        <h2>Form score by rep</h2>
        <RepBars reps={set.reps} />
        {Object.keys(s.flagCounts).length > 0 && (
          <ul className="list" style={{ marginTop: 12 }}>
            {(Object.entries(s.flagCounts) as [Flag, number][]).map(([f, n]) => (
              <li key={f} className="row" style={{ justifyContent: 'space-between' }}>
                <span>{FLAG_LABEL[f]}</span>
                <span className="muted">
                  {n} of {s.reps} reps
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="row col-12">
        <button className="btn btn-primary btn-lg" style={{ flex: 1 }} onClick={onAgain}>
          Another set
        </button>
        <button className="btn btn-lg" onClick={onHome}>
          Done
        </button>
        <button className="btn btn-lg" onClick={exportJson}>
          Export
        </button>
      </div>
    </div>
  );
}

function RepBars({ reps }: { reps: Rep[] }) {
  const w = 560, h = 120, gap = 6;
  const bw = Math.min(60, Math.max(6, (w - gap * (reps.length - 1)) / Math.max(reps.length, 1)));
  return (
    <svg viewBox={`0 0 ${w} ${h + 18}`} className="rep-bars" role="img" aria-label="Form score for each rep">
      {reps.map((r, i) => {
        const bh = Math.max(4, (r.score / 100) * h);
        const x = i * (bw + gap);
        return (
          <g key={r.index}>
            <rect x={x} y={h - bh} width={bw} height={bh} rx={4} className={`bar-rect ${tone(r.score)}`} />
            <text x={x + bw / 2} y={h + 14} textAnchor="middle" className="bar-label">
              {r.index}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Segmented({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="setting">
      <span>{label}</span>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map(([v, l]) => (
          <button key={v} role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="setting">
      <span>{label}</span>
      <input type="checkbox" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
