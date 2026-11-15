import { useMemo, useState } from 'react';
import { PAPERS, VIDEOS } from '../content/research';
import { useApp } from '../state/app';
import { foodsOn, totals } from '../state/food';
import { isoDay } from '../state/health';
import { fmtWeight, goalLabel, lbToKg } from '../state/profile';
import type { SavedSet } from '../store';
import {
  IconBolt,
  IconBook,
  IconCube,
  IconPulse,
  IconDumbbell,
  IconFlame,
  IconHeart,
  IconMoon,
  IconPlay,
  IconSteps,
  IconTarget,
  IconTrend,
  IconTrophy,
} from '../ui/icons';
import { Bars, Line, Ring } from '../ui/viz';
import { Bento, Row, Sheet, Widget } from '../ui/widgets';

const DAY = 864e5;
const HABIT_DAYS = 66;
const REP_MILESTONES = [50, 100, 250, 500, 1000, 2500, 5000];

function weekStart(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday
  return x;
}
const setMinutes = (s: SavedSet) => (s.reps.length ? (s.reps.at(-1)!.endT - s.reps[0].startT) / 60000 + 1 : 0); // +1 min setup/rest

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function Dashboard() {
  const { profile, targets, health, sets, setTab, session } = useApp();
  const [weightInput, setWeightInput] = useState('');
  const [panel, setPanel] = useState<null | 'weight' | 'why'>(null);
  const [weights, setWeights] = useState<{ at: string; kg: number }[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('fitmax.weight') ?? '[]');
    } catch {
      return [];
    }
  });

  const m = useMemo(() => {
    const ws = weekStart().getTime();
    const thisWeek = sets.filter((s) => Date.parse(s.at) >= ws);
    const lastWeek = sets.filter((s) => Date.parse(s.at) >= ws - 7 * DAY && Date.parse(s.at) < ws);
    const trainDays = new Set(sets.map((s) => isoDay(new Date(s.at))));
    const strengthDaysWeek = new Set(thisWeek.map((s) => isoDay(new Date(s.at)))).size;
    let streak = 0;
    for (let i = 0; i < 400; i++) {
      const d = isoDay(new Date(Date.now() - i * DAY));
      if (trainDays.has(d)) streak++;
      else if (i > 0) break;
    }
    const totalReps = sets.reduce((n, s) => n + s.summary.reps, 0);
    const weekReps = thisWeek.reduce((n, s) => n + s.summary.reps, 0);
    const avg = (a: SavedSet[]) => (a.length ? a.reduce((n, s) => n + s.summary.avgScore, 0) / a.length : null);
    const strengthMin = thisWeek.reduce((n, s) => n + setMinutes(s), 0);
    const activeMin = health.reduce((n, d) => n + d.activeMinutes, 0) + strengthMin;
    const today = health.at(-1);
    const food = totals(foodsOn());
    const nextRep = REP_MILESTONES.find((x) => x > totalReps) ?? totalReps + 1000;
    const prevRep = [...REP_MILESTONES].reverse().find((x) => x <= totalReps) ?? 0;
    return {
      thisWeek,
      weekSets: thisWeek.length,
      weekReps,
      totalReps,
      trainDays: trainDays.size,
      strengthDaysWeek,
      streak,
      form: avg(thisWeek),
      formLast: avg(lastWeek),
      strengthMin,
      activeMin,
      today,
      food,
      nextRep,
      prevRep,
      formTrend: [...sets].reverse().slice(-12).map((s) => Math.round(s.summary.avgScore)),
    };
  }, [sets, health]);

  if (!profile || !targets) return null;
  const startKg = profile.weightKg;
  const currentKg = weights.at(-1)?.kg ?? startKg;
  const target = profile.targetWeightKg;
  const weightPct = target ? Math.max(0, Math.min(1, (startKg - currentKg) / (startKg - target || 1))) : 0;

  const logWeight = () => {
    const v = Number(weightInput);
    if (!v) return;
    const kg = profile.units === 'imperial' ? lbToKg(v) : v;
    const next = [...weights, { at: new Date().toISOString(), kg }];
    setWeights(next);
    localStorage.setItem('fitmax.weight', JSON.stringify(next));
    setWeightInput('');
  };

  const isMuscle = ['build_muscle', 'hypertrophy'].includes(profile.goal);
  const proteinPct = Math.round((m.food.protein / targets.proteinG) * 100);
  const daysLabel = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const trainSet = new Set(sets.map((s) => isoDay(new Date(s.at))));
  const weekBars = health.map((d) => ({ label: daysLabel[(new Date(d.date + 'T12:00').getDay() + 6) % 7], value: d.activeMinutes, mark: trainSet.has(d.date) }));
  const papers = PAPERS.filter((p) => p.tags.includes(profile.goal) || p.tags.includes('all')).slice(0, 6);
  const home = readHome();
  const unit = profile.units === 'imperial' ? 'lb' : 'kg';

  return (
    <div>
      <div className="page-head">
        <div>
          <p className="eyebrow">{goalLabel(profile.goal)}</p>
          <h1>
            {greeting()}, {profile.name.split(' ')[0]}
          </h1>
        </div>
        <button className="btn btn-primary btn-lg" onClick={() => setTab('train')}>
          <IconBolt size={18} /> Start workout
        </button>
      </div>

      <Bento>
        <Widget label="Habit" icon={<IconTarget />} span={2} tall value={`${m.trainDays}`} unit={`/ ${HABIT_DAYS} days`} sub={m.streak ? `${m.streak}-day streak` : 'missing a day doesn’t reset you'} tone="accent" onOpen={() => setPanel('why')}>
          <div className="dash-ring">
            <Ring value={m.trainDays} max={HABIT_DAYS} size={150} color="var(--accent)" label={`${Math.round((m.trainDays / HABIT_DAYS) * 100)}%`} sub="to habit" />
          </div>
        </Widget>
        <Widget label="Steps" icon={<IconSteps />} value={m.today ? m.today.steps.toLocaleString() : '—'} sub={`goal ${(8000).toLocaleString()}`} />
        <Widget label="Resting HR" icon={<IconHeart />} value={m.today?.restingHr ?? '—'} unit="bpm" />
        <Widget label="Sleep" icon={<IconMoon />} value={m.today ? m.today.sleepHours.toFixed(1) : '—'} unit="h" tone="good" />
        <Widget label="Protein" icon={<IconFlame />} value={Math.round(m.food.protein)} unit={`/${targets.proteinG} g`} sub={`${proteinPct}% of today`} onOpen={() => setTab('nutrition')} />
        <Widget label="Active minutes · week" span={2} value={Math.round(m.activeMin)} unit="/ 150" tone="data" sub="WHO weekly target">
          <Bars data={weekBars} goal={Math.round(150 / 7)} height={96} />
        </Widget>
        <Widget label={isMuscle ? 'Sets this week' : 'Strength days'} icon={<IconDumbbell />} value={isMuscle ? m.weekSets : m.strengthDaysWeek} unit={isMuscle ? '/ 10' : '/ 2'} tone="good" />
        <Widget label="Form score" icon={<IconTrend />} value={m.form != null ? Math.round(m.form) : '—'} sub={m.formTrend.length > 1 ? 'last 12 sets' : 'finish two sets'}>
          {m.formTrend.length > 1 && <Line data={m.formTrend} height={40} />}
        </Widget>
        <Widget label="Reps" icon={<IconTrophy />} value={m.totalReps} sub={`next milestone ${m.nextRep}`} />
        <Widget label="Weight" value={fmtWeight(currentKg, profile.units).replace(/ (lb|kg)/, '')} unit={unit} sub={target ? `goal ${fmtWeight(target, profile.units)} · ${Math.round(weightPct * 100)}%` : 'tap to log'} onOpen={() => setPanel('weight')} />
        <Widget label="Home" icon={<IconPulse />} value={home.active} unit="min" sub={`${home.kcal} kcal moving at home`} onOpen={() => setTab('monitor')} />
        <Widget label="Your gym room" icon={<IconCube />} value="Design" sub="3D home, one-tap layouts" onOpen={() => setTab('interior')} tone="accent" />
        <Widget label="Why it works" icon={<IconBook />} span={2} sub={`${papers.length} studies behind your plan · ${VIDEOS.length} form videos`} onOpen={() => setPanel('why')}>
          <div className="chips mini-chips">
            {papers.slice(0, 3).map((p) => (
              <span key={p.id} className="chip-toggle">
                {p.title}
              </span>
            ))}
          </div>
        </Widget>
      </Bento>

      {panel === 'weight' && (
        <Sheet title="Log weight" onClose={() => setPanel(null)}>
          <div className="row">
            <input className="input" style={{ flex: 1 }} inputMode="decimal" placeholder={`Today’s weight (${unit})`} value={weightInput} onChange={(e) => setWeightInput(e.target.value)} />
            <button className="btn btn-primary" onClick={() => (logWeight(), setPanel(null))}>
              Save
            </button>
          </div>
          <p className="tiny muted" style={{ marginTop: 8 }}>
            Started {fmtWeight(startKg, profile.units)}
            {target ? ` · goal ${fmtWeight(target, profile.units)}` : ''}
          </p>
        </Sheet>
      )}
      {panel === 'why' && (
        <Sheet title="Why it works" onClose={() => setPanel(null)} wide>
          {papers.map((p) => (
            <Row
              key={p.id}
              k={
                <a href={p.url} target="_blank" rel="noreferrer">
                  {p.title}
                </a>
              }
              hint={`${p.takeaway} · ${p.source}`}
              v=""
            />
          ))}
          <p className="eyebrow" style={{ marginTop: 14 }}>
            Watch
          </p>
          {VIDEOS.map((v) => (
            <Row
              key={v.url}
              k={
                <a href={v.url} target="_blank" rel="noreferrer">
                  <IconPlay size={13} /> {v.title}
                </a>
              }
              hint={v.by}
              v={v.minutes}
            />
          ))}
          <p className="tiny muted" style={{ marginTop: 10 }}>
            {session?.provider === 'apple' ? 'Apple Health' : 'Google Fit'} numbers are demo data until a health account is connected.
          </p>
        </Sheet>
      )}
    </div>
  );
}

/** Today's at-home activity, saved by the Monitor. */
function readHome() {
  try {
    const w = JSON.parse(localStorage.getItem('fitmax.monitor') ?? '{}');
    const k = JSON.parse(localStorage.getItem('fitmax.monitor.kcal') ?? '{}');
    return { active: Math.round((w.activeMs ?? 0) / 60000), kcal: Math.round(k.kcal ?? 0) };
  } catch {
    return { active: 0, kcal: 0 };
  }
}
