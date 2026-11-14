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
  const milestones = [
    { label: 'Habit locked in', detail: `${m.trainDays} of ${HABIT_DAYS} training days`, value: m.trainDays, max: HABIT_DAYS, tone: 'accent' },
    isMuscle
      ? { label: 'Weekly biceps volume', detail: `${m.weekSets} of 10 sets this week`, value: m.weekSets, max: 10, tone: 'good' }
      : { label: 'Strength days this week', detail: `${m.strengthDaysWeek} of 2 days`, value: m.strengthDaysWeek, max: 2, tone: 'good' },
    { label: 'Active minutes (WHO)', detail: `${Math.round(m.activeMin)} of 150 min this week`, value: m.activeMin, max: 150, tone: 'data' },
    { label: `Next: ${m.nextRep} total reps`, detail: `${m.totalReps} reps logged`, value: m.totalReps - m.prevRep, max: m.nextRep - m.prevRep, tone: 'accent' },
    ...(target
      ? [{ label: `Goal weight ${fmtWeight(target, profile.units)}`, detail: `${fmtWeight(currentKg, profile.units)} now · started ${fmtWeight(startKg, profile.units)}`, value: weightPct, max: 1, tone: 'good' }]
      : []),
  ];

  const proteinPct = Math.round((m.food.protein / targets.proteinG) * 100);
  const translate = [
    {
      icon: <IconDumbbell size={18} />,
      tone: '',
      text: m.weekSets
        ? `Your ${m.weekSets} curl ${m.weekSets === 1 ? 'set' : 'sets'} this week ${m.weekSets >= 10 ? 'reach' : 'are ' + Math.round((m.weekSets / 10) * 100) + '% of'} the 10+ weekly sets linked with more muscle growth.`
        : 'One curl set today starts your weekly volume. 10+ sets a week per muscle is linked with more growth.',
      cite: 'Schoenfeld 2017',
    },
    {
      icon: <IconHeart size={18} />,
      tone: 'data',
      text:
        m.strengthDaysWeek >= 2
          ? `${m.strengthDaysWeek} strength days this week: you meet the WHO muscle-strengthening guideline.`
          : `${m.strengthDaysWeek} of the 2 strength days the WHO recommends each week. ${2 - m.strengthDaysWeek} to go.`,
      cite: 'WHO 2020',
    },
    {
      icon: <IconTrend size={18} />,
      tone: '',
      text: `${Math.round(m.strengthMin)} min of strength work this week. 30 to 60 min a week is linked to 10 to 20% lower risk of early death and heart disease.`,
      cite: 'Momma 2022',
    },
    {
      icon: <IconFlame size={18} />,
      tone: 'accent',
      text: `${Math.round(m.food.protein)} g protein today is ${proteinPct}% of your ${targets.proteinG} g target (${targets.proteinPerKg} g/kg).`,
      cite: 'Morton 2018',
    },
  ];

  const daysLabel = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const trainSet = new Set(m.thisWeek.map((s) => isoDay(new Date(s.at))));
  const weekBars = health.map((d) => ({ label: daysLabel[(new Date(d.date + 'T12:00').getDay() + 6) % 7], value: d.activeMinutes, mark: trainSet.has(d.date) }));
  const papers = PAPERS.filter((p) => p.tags.includes(profile.goal) || p.tags.includes('all')).slice(0, 6);
  const daysToHabit = Math.max(0, HABIT_DAYS - m.trainDays);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">{goalLabel(profile.goal)} plan</p>
          <h1>
            {greeting()}, {profile.name}
          </h1>
          <p className="muted">
            {m.streak > 0 ? `${m.streak}-day streak. ` : ''}
            {daysToHabit > 0 ? `${daysToHabit} training days until this becomes a habit.` : 'Habit locked in. Keep raising the bar.'}
          </p>
        </div>
        <button className="btn btn-primary btn-lg" onClick={() => setTab('train')}>
          <IconBolt size={18} /> Start workout
        </button>
      </div>

      <div className="grid">
        <section className="card hero-card col-5">
          <div className="card-head">
            <h2>Goal progress</h2>
            <span className="pill accent">
              <IconTarget size={14} /> {goalLabel(profile.goal)}
            </span>
          </div>
          <div className="ring-wrap" style={{ marginBottom: 16 }}>
            <Ring value={m.trainDays} max={HABIT_DAYS} size={128} color="var(--accent)" label={`${Math.round((m.trainDays / HABIT_DAYS) * 100)}%`} sub="to habit" />
            <div>
              <div className="stat-num">
                {m.trainDays}
                <span className="muted" style={{ fontSize: 16 }}>
                  {' '}
                  / {HABIT_DAYS} days
                </span>
              </div>
              <p className="small muted">New routines take about 66 days to feel automatic. Missing a day doesn't reset you.</p>
            </div>
          </div>
          <div className="milestones">
            {milestones.slice(1).map((x) => (
              <div className="milestone" key={x.label}>
                <div className="milestone-top">
                  <strong>{x.label}</strong>
                  <span className="muted num">{x.detail}</span>
                </div>
                <div className={`bar ${x.tone === 'data' ? 'data' : x.tone === 'accent' ? 'accent' : ''}`}>
                  <div style={{ width: `${Math.min(100, (x.value / x.max) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card col-7">
          <div className="card-head">
            <h2>Today</h2>
            <span className="pill data">{session?.provider === 'apple' ? 'Apple Health' : 'Google Fit'} · demo data</span>
          </div>
          <div className="stat-grid">
            <div className="stat">
              <span className="stat-label row" style={{ gap: 6 }}>
                <IconSteps size={15} /> Steps
              </span>
              <span className="stat-num">{m.today?.steps.toLocaleString() ?? '–'}</span>
              <span className="tiny muted">goal 8,000</span>
            </div>
            <div className="stat">
              <span className="stat-label row" style={{ gap: 6 }}>
                <IconHeart size={15} /> Resting HR
              </span>
              <span className="stat-num">{m.today?.restingHr ?? '–'}</span>
              <span className="tiny muted">bpm</span>
            </div>
            <div className="stat">
              <span className="stat-label row" style={{ gap: 6 }}>
                <IconMoon size={15} /> Sleep
              </span>
              <span className="stat-num">{m.today?.sleepHours ?? '–'}h</span>
              <span className={`tiny ${m.today && m.today.sleepHours < 7 ? 'warn' : 'good'}`}>{m.today && m.today.sleepHours < 7 ? 'under 7h: go lighter' : 'recovered'}</span>
            </div>
            <div className="stat">
              <span className="stat-label row" style={{ gap: 6 }}>
                <IconFlame size={15} /> Protein
              </span>
              <span className="stat-num">
                {Math.round(m.food.protein)}
                <span className="muted" style={{ fontSize: 15 }}>/{targets.proteinG}g</span>
              </span>
              <button className="tiny" style={{ background: 'none', border: 0, padding: 0, color: 'var(--data)', textAlign: 'left' }} onClick={() => setTab('nutrition')}>
                Log a meal →
              </button>
            </div>
          </div>
          <div style={{ marginTop: 18 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3>Active minutes this week</h3>
              <span className="tiny muted">
                <span style={{ color: 'var(--good)' }}>- - -</span> WHO pace (≈21 min/day) · <span style={{ color: 'var(--accent)' }}>●</span> strength session
              </span>
            </div>
            <Bars data={weekBars} goal={Math.round(150 / 7)} />
          </div>
        </section>

        <section className="nudge col-12">
          <IconTrophy size={34} />
          <div>
            <strong>
              {m.weekSets === 0
                ? 'Your next set is the one that counts.'
                : m.form !== null && m.formLast !== null && m.form > m.formLast
                  ? `Form up ${Math.round(m.form - m.formLast)} points on last week.`
                  : `${m.weekReps} reps this week. Keep the chain going.`}
            </strong>
            <p>
              {m.weekSets === 0
                ? 'Five minutes of curls keeps your streak alive and moves you toward the 2 strength days the WHO recommends.'
                : 'Small, consistent sessions beat rare heroic ones: consistency is what turns training into a habit.'}
            </p>
          </div>
        </section>

        <section className="card col-7">
          <div className="card-head">
            <h2>What your progress counts for</h2>
          </div>
          <ul className="list translate">
            {translate.map((t) => (
              <li key={t.cite}>
                <span className={`ico ${t.tone}`}>{t.icon}</span>
                <span>
                  {t.text} <span className="tiny muted">({t.cite})</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card col-5">
          <div className="card-head">
            <h2>Form score trend</h2>
            {m.form !== null && <span className={`pill ${m.form >= 85 ? 'good' : 'warn'}`}>{Math.round(m.form)} avg this week</span>}
          </div>
          <Line data={m.formTrend} />
          <div className="row" style={{ marginTop: 14 }}>
            <input
              className="input"
              style={{ flex: 1, minWidth: 0 }}
              inputMode="decimal"
              placeholder={`Log today's weight (${profile.units === 'imperial' ? 'lb' : 'kg'})`}
              value={weightInput}
              onChange={(e) => setWeightInput(e.target.value.replace(/[^\d.]/g, ''))}
            />
            <button className="btn" onClick={logWeight}>
              Save
            </button>
          </div>
        </section>

        <section className="card col-12">
          <div className="card-head">
            <h2>
              <IconBook size={18} style={{ verticalAlign: '-3px' }} /> Quick reads
            </h2>
            <span className="tiny muted">The research behind your plan</span>
          </div>
          <div className="paper-grid">
            {papers.map((p) => (
              <a key={p.id} className="paper" href={p.url} target="_blank" rel="noreferrer" style={{ color: 'var(--text)', textDecoration: 'none' }}>
                <h3>{p.title}</h3>
                <p className="small">{p.takeaway}</p>
                <span className="src">{p.source} ↗</span>
              </a>
            ))}
          </div>
        </section>

        <section className="card col-12">
          <div className="card-head">
            <h2>Watch</h2>
            <span className="tiny muted">Form refreshers</span>
          </div>
          <div className="video-grid">
            {VIDEOS.map((v) => (
              <a key={v.title} className="video" href={v.url} target="_blank" rel="noreferrer">
                <span className="play">
                  <IconPlay size={22} />
                </span>
                <span>
                  <strong className="small">{v.title}</strong>
                  <br />
                  <span className="tiny muted">
                    {v.by} · {v.minutes}
                  </span>
                </span>
              </a>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
