import { useState, type ReactElement } from 'react';
import {
  cmToFtIn,
  DIETS,
  EXPERIENCE_STEPS,
  experienceLabel,
  ftInToCm,
  GOALS,
  INJURIES,
  kgToLb,
  lbToKg,
  type Goal,
  type HealthPermission,
  type HealthSource,
  type Intensity,
  type Profile,
  type Session,
  type Sex,
  type Units,
} from '../state/profile';
import { IconBolt, IconDumbbell, IconHeart, IconLeaf, IconMoon, IconShield, IconSteps, IconTarget } from '../ui/icons';

/* ------------------------------------------------------------------ */
/* Sign in (demo) + fitness data permissions                           */
/* ------------------------------------------------------------------ */

const PERMS: { id: HealthPermission; label: string; why: string; icon: ReactElement }[] = [
  { id: 'steps', label: 'Steps & activity', why: 'Weekly active minutes vs the WHO target', icon: <IconSteps /> },
  { id: 'heart', label: 'Heart rate', why: 'Resting heart rate trend and readiness', icon: <IconHeart /> },
  { id: 'workouts', label: 'Workouts', why: 'Count runs, rides and lifts toward your goal', icon: <IconDumbbell /> },
  { id: 'sleep', label: 'Sleep', why: 'Recovery before hard sessions', icon: <IconMoon /> },
  { id: 'weight', label: 'Body weight', why: 'Progress toward your target weight', icon: <IconTarget /> },
  { id: 'nutrition', label: 'Nutrition', why: 'Sync meals you log elsewhere', icon: <IconLeaf /> },
];

const PROVIDER: Record<HealthSource, { app: string; account: string }> = {
  google: { app: 'Google Fit', account: 'Google' },
  apple: { app: 'Apple Health', account: 'Apple' },
};

export function SignIn({ onSignedIn }: { onSignedIn: (s: Session) => void }) {
  const [provider, setProvider] = useState<HealthSource | null>(null);
  const [perms, setPerms] = useState<Record<HealthPermission, boolean>>({
    steps: true,
    heart: true,
    workouts: true,
    sleep: true,
    weight: true,
    nutrition: false,
  });

  const finish = (p: HealthSource, grant: boolean) =>
    onSignedIn({
      provider: p,
      displayName: '',
      permissions: grant ? perms : { steps: false, heart: false, workouts: false, sleep: false, weight: false, nutrition: false },
      signedInAt: new Date().toISOString(),
    });

  return (
    <div className="auth">
      <section className="auth-hero">
        <div className="brand">
          <img src="/logo.svg" alt="" /> FitMax
        </div>
        <div>
          <h1>Fitness that fits where you live.</h1>
          <p>
            A coach that watches every rep, plans meals around your goal, and finds the homes and neighbourhoods that make training
            easy.
          </p>
        </div>
        <div className="hero-stats">
          <div>
            <strong>31%</strong>
            <span>of adults worldwide don't get enough activity (WHO, 2022)</span>
          </div>
          <div>
            <strong>66 days</strong>
            <span>median time for a new habit to stick (Lally et al., 2010)</span>
          </div>
          <div>
            <strong>On device</strong>
            <span>your camera never leaves your phone</span>
          </div>
        </div>
      </section>

      <section className="auth-panel">
        {!provider ? (
          <div className="auth-box">
            <p className="eyebrow">Get started</p>
            <h1>Welcome to FitMax</h1>
            <p className="muted">Sign in with the account that holds your fitness data.</p>
            <button className="provider-btn" onClick={() => setProvider('google')}>
              <GoogleMark /> Continue with Google
            </button>
            <button className="provider-btn dark" onClick={() => setProvider('apple')}>
              <AppleMark /> Continue with Apple
            </button>
            <div className="divider">demo build</div>
            <p className="tiny muted">
              <IconShield size={14} style={{ verticalAlign: '-2px' }} /> Sign-in is simulated for this demo: no account is created and nothing leaves this
              device. Health data shown is simulated until HealthKit and Health Connect are connected.
            </p>
          </div>
        ) : (
          <div className="auth-box">
            <p className="eyebrow">Connect {PROVIDER[provider].app}</p>
            <h1>Let FitMax read your fitness data</h1>
            <p className="muted">Choose what to share. You can change this any time in Profile.</p>
            <div className="card" style={{ padding: '6px 16px' }}>
              {PERMS.map((p) => (
                <label key={p.id} className="perm">
                  <span className="ico">{p.icon}</span>
                  <span style={{ flex: 1 }}>
                    <strong>{p.label}</strong>
                    <br />
                    <span className="small muted">{p.why}</span>
                  </span>
                  <input type="checkbox" className="switch" checked={perms[p.id]} onChange={(e) => setPerms({ ...perms, [p.id]: e.target.checked })} />
                </label>
              ))}
            </div>
            <button className="btn btn-primary btn-lg btn-block" onClick={() => finish(provider, true)}>
              Allow and continue
            </button>
            <button className="btn btn-ghost btn-block" onClick={() => finish(provider, false)}>
              Not now
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

/** Neutral provider marks (not the companies' logos). */
function GoogleMark() {
  return (
    <span aria-hidden style={{ width: 22, height: 22, borderRadius: 6, display: 'grid', placeItems: 'center', background: 'var(--data-soft)', color: 'var(--data)', fontWeight: 800 }}>
      G
    </span>
  );
}
function AppleMark() {
  return (
    <span aria-hidden style={{ width: 22, height: 22, borderRadius: 6, display: 'grid', placeItems: 'center', background: 'rgb(127 127 127 / 0.25)' }}>
      <IconHeart size={14} />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Onboarding                                                          */
/* ------------------------------------------------------------------ */

interface Draft {
  name: string;
  sex: Sex | '';
  age: string;
  units: Units;
  heightCm: string;
  heightFt: string;
  heightIn: string;
  weight: string;
  targetWeight: string;
  goal: Goal | '';
  experience: string;
  intensity: Intensity | '';
  daysPerWeek: string;
  injuries: string[];
  injuryNotes: string;
  diet: string[];
}

const empty: Draft = {
  name: '',
  sex: '',
  age: '',
  units: 'imperial',
  heightCm: '',
  heightFt: '',
  heightIn: '',
  weight: '',
  targetWeight: '',
  goal: '',
  experience: '',
  intensity: '',
  daysPerWeek: '',
  injuries: [],
  injuryNotes: '',
  diet: [],
};

function fromProfile(p: Profile): Draft {
  const imp = p.units === 'imperial';
  const { ft, inch } = cmToFtIn(p.heightCm);
  const w = (kg: number) => String(Math.round(imp ? kgToLb(kg) : kg));
  return {
    name: p.name,
    sex: p.sex,
    age: String(p.age),
    units: p.units,
    heightCm: String(Math.round(p.heightCm)),
    heightFt: String(ft),
    heightIn: String(inch),
    weight: w(p.weightKg),
    targetWeight: p.targetWeightKg ? w(p.targetWeightKg) : '',
    goal: p.goal,
    experience: String(p.experienceYears),
    intensity: p.intensity,
    daysPerWeek: String(p.daysPerWeek),
    injuries: p.injuries,
    injuryNotes: p.injuryNotes,
    diet: p.diet,
  };
}

const STEP_TITLES = ['About you', 'Your goal', 'Body & diet'];

export function Onboarding({ initial, onDone, onCancel }: { initial?: Profile | null; onDone: (p: Profile) => void; onCancel?: () => void }) {
  const [step, setStep] = useState(0);
  const [d, setD] = useState<Draft>(initial ? fromProfile(initial) : empty);
  const [tried, setTried] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const toggle = (k: 'injuries' | 'diet', v: string) => set(k, d[k].includes(v) ? d[k].filter((x) => x !== v) : [...d[k], v]);
  const imp = d.units === 'imperial';

  const heightCm = imp ? ftInToCm(Number(d.heightFt) || 0, Number(d.heightIn) || 0) : Number(d.heightCm);
  const toKg = (s: string) => (s ? (imp ? lbToKg(Number(s)) : Number(s)) : NaN);

  const errors: Record<number, string[]> = {
    0: [
      !d.sex && 'Choose an option for sex',
      !(Number(d.age) >= 13 && Number(d.age) <= 100) && 'Enter an age between 13 and 100',
      !(heightCm >= 120 && heightCm <= 230) && 'Enter your height',
      !(toKg(d.weight) >= 30 && toKg(d.weight) <= 300) && 'Enter your weight',
    ].filter(Boolean) as string[],
    1: [!d.goal && 'Pick a goal', d.experience === '' && 'Choose your training experience', !d.intensity && 'Choose an intensity', !d.daysPerWeek && 'Choose days per week'].filter(
      Boolean,
    ) as string[],
    2: [],
  };

  const next = () => {
    if (errors[step].length) {
      setTried(true);
      return;
    }
    setTried(false);
    if (step < 2) return setStep(step + 1);
    onDone({
      name: d.name.trim() || 'Athlete',
      sex: d.sex as Sex,
      age: Number(d.age),
      heightCm,
      weightKg: toKg(d.weight),
      targetWeightKg: d.targetWeight ? toKg(d.targetWeight) : null,
      units: d.units,
      goal: d.goal as Goal,
      experienceYears: Number(d.experience),
      intensity: d.intensity as Intensity,
      daysPerWeek: Number(d.daysPerWeek),
      injuries: d.injuries,
      injuryNotes: d.injuryNotes.trim(),
      diet: d.diet,
      createdAt: initial?.createdAt ?? new Date().toISOString(),
    });
  };

  return (
    <div className="onb">
      <div className="row">
        <div className="brand" style={{ padding: 0 }}>
          <img src="/logo.svg" alt="" /> FitMax
        </div>
        <span className="spacer" />
        <span className="small muted">
          Step {step + 1} of 3 · {STEP_TITLES[step]}
        </span>
      </div>
      <div className="steps">
        {[0, 1, 2].map((i) => (
          <span key={i} className={i <= step ? 'on' : ''} />
        ))}
      </div>

      {step === 0 && (
        <section className="card">
          <h1>Tell FitMax about you</h1>
          <p className="muted" style={{ marginBottom: 18 }}>
            Used to set calorie and protein targets and to size your training. Stays on this device.
          </p>
          <div className="form-grid">
            <label className="field full">
              <span>First name</span>
              <input className="input" placeholder="e.g. Alex" value={d.name} onChange={(e) => set('name', e.target.value)} autoComplete="given-name" />
            </label>
            <label className="field">
              <span>Sex</span>
              <select className="input" value={d.sex} onChange={(e) => set('sex', e.target.value as Sex)}>
                <option value="" disabled>
                  Select…
                </option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Prefer not to say</option>
              </select>
            </label>
            <label className="field">
              <span>Age</span>
              <input className="input" inputMode="numeric" placeholder="e.g. 24" value={d.age} onChange={(e) => set('age', e.target.value.replace(/\D/g, ''))} />
            </label>
            <div className="field full">
              <span>Units</span>
              <div className="segmented" role="radiogroup" aria-label="Units">
                {(['imperial', 'metric'] as Units[]).map((u) => (
                  <button key={u} role="radio" aria-checked={d.units === u} className={d.units === u ? 'on' : ''} onClick={() => set('units', u)}>
                    {u === 'imperial' ? 'lb · ft/in' : 'kg · cm'}
                  </button>
                ))}
              </div>
            </div>
            {imp ? (
              <div className="field">
                <span>Height</span>
                <div className="unit-row">
                  <select className="input" value={d.heightFt} onChange={(e) => set('heightFt', e.target.value)}>
                    <option value="" disabled>
                      ft
                    </option>
                    {[4, 5, 6, 7].map((f) => (
                      <option key={f} value={f}>
                        {f} ft
                      </option>
                    ))}
                  </select>
                  <select className="input" value={d.heightIn} onChange={(e) => set('heightIn', e.target.value)}>
                    <option value="" disabled>
                      in
                    </option>
                    {Array.from({ length: 12 }, (_, i) => (
                      <option key={i} value={i}>
                        {i} in
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <label className="field">
                <span>Height (cm)</span>
                <input className="input" inputMode="numeric" placeholder="e.g. 175" value={d.heightCm} onChange={(e) => set('heightCm', e.target.value.replace(/\D/g, ''))} />
              </label>
            )}
            <label className="field">
              <span>Weight ({imp ? 'lb' : 'kg'})</span>
              <input className="input" inputMode="decimal" placeholder={imp ? 'e.g. 165' : 'e.g. 75'} value={d.weight} onChange={(e) => set('weight', e.target.value.replace(/[^\d.]/g, ''))} />
            </label>
            <label className="field full">
              <span>Target weight ({imp ? 'lb' : 'kg'}) · optional</span>
              <input className="input" inputMode="decimal" placeholder="Leave blank to stay where you are" value={d.targetWeight} onChange={(e) => set('targetWeight', e.target.value.replace(/[^\d.]/g, ''))} />
            </label>
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="card">
          <h1>What are you training for?</h1>
          <p className="muted" style={{ marginBottom: 18 }}>
            Your goal sets your targets, your milestones and how FitMax scores homes.
          </p>
          <div className="goal-grid">
            {GOALS.map((g) => (
              <button key={g.id} className="goal-card" aria-pressed={d.goal === g.id} onClick={() => set('goal', g.id)}>
                <strong>{g.label}</strong>
                <span>{g.blurb}</span>
              </button>
            ))}
          </div>
          <div className="form-grid" style={{ marginTop: 18 }}>
            <label className="field">
              <span>Training experience</span>
              <select className="input" value={d.experience} onChange={(e) => set('experience', e.target.value)}>
                <option value="" disabled>
                  Select…
                </option>
                {EXPERIENCE_STEPS.map((y) => (
                  <option key={y} value={y}>
                    {experienceLabel(y)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Usual intensity</span>
              <select className="input" value={d.intensity} onChange={(e) => set('intensity', e.target.value as Intensity)}>
                <option value="" disabled>
                  Select…
                </option>
                <option value="light">Light: easy pace, can chat</option>
                <option value="moderate">Moderate: breathing harder</option>
                <option value="hard">Hard: close to your limit</option>
              </select>
            </label>
            <label className="field">
              <span>Days per week you can train</span>
              <select className="input" value={d.daysPerWeek} onChange={(e) => set('daysPerWeek', e.target.value)}>
                <option value="" disabled>
                  Select…
                </option>
                {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                  <option key={n} value={n}>
                    {n} {n === 1 ? 'day' : 'days'}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="card">
          <h1>Anything to work around?</h1>
          <p className="muted" style={{ marginBottom: 18 }}>
            FitMax adapts cues, plans and home scores to injuries and diet. Skip if none apply.
          </p>
          <div className="field">
            <span>Injuries or pain</span>
            <div className="chips">
              {INJURIES.map((i) => (
                <button key={i} className="chip-toggle" aria-pressed={d.injuries.includes(i)} onClick={() => toggle('injuries', i)}>
                  {i}
                </button>
              ))}
            </div>
          </div>
          <label className="field" style={{ marginTop: 14 }}>
            <span>Details · optional</span>
            <textarea className="input" rows={2} placeholder="e.g. ACL repair in 2023, avoid deep knee bends" value={d.injuryNotes} onChange={(e) => set('injuryNotes', e.target.value)} />
          </label>
          <div className="field" style={{ marginTop: 18 }}>
            <span>Dietary restrictions</span>
            <div className="chips">
              {DIETS.map((x) => (
                <button key={x} className="chip-toggle" aria-pressed={d.diet.includes(x)} onClick={() => toggle('diet', x)}>
                  {x}
                </button>
              ))}
            </div>
          </div>
          <p className="tiny muted" style={{ marginTop: 16 }}>
            <IconShield size={13} style={{ verticalAlign: '-2px' }} /> FitMax gives general guidance, not medical advice. Check with a clinician before training through an injury.
          </p>
        </section>
      )}

      {tried && errors[step].length > 0 && (
        <p className="small warn" role="alert" style={{ marginTop: 12 }}>
          {errors[step].join(' · ')}
        </p>
      )}

      <div className="onb-foot">
        <div>
          {step > 0 ? (
            <button className="btn" onClick={() => setStep(step - 1)}>
              Back
            </button>
          ) : (
            onCancel && (
              <button className="btn" onClick={onCancel}>
                Cancel
              </button>
            )
          )}
          <span className="spacer" />
          <button className="btn btn-primary btn-lg" onClick={next}>
            {step < 2 ? 'Continue' : (
              <>
                <IconBolt size={18} /> Build my plan
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

