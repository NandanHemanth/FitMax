import { useState } from 'react';
import { useApp } from '../state/app';
import { bmi, experienceLabel, fmtWeight, goalLabel, type HealthPermission } from '../state/profile';
import { IconLogout, IconMoon, IconShield, IconSun } from '../ui/icons';
import { Onboarding } from './Auth';

const PERM_LABEL: Record<HealthPermission, string> = {
  steps: 'Steps & activity',
  heart: 'Heart rate',
  workouts: 'Workouts',
  sleep: 'Sleep',
  weight: 'Body weight',
  nutrition: 'Nutrition',
};

export function ProfileScreen() {
  const { profile, setProfile, session, setSession, targets, theme, toggleTheme, signOut } = useApp();
  const [editing, setEditing] = useState(false);
  if (!profile || !targets) return null;
  if (editing)
    return (
      <Onboarding
        initial={profile}
        onCancel={() => setEditing(false)}
        onDone={(p) => {
          setProfile(p);
          setEditing(false);
        }}
      />
    );

  const ftIn = profile.units === 'imperial' ? `${Math.floor(profile.heightCm / 2.54 / 12)} ft ${Math.round((profile.heightCm / 2.54) % 12)} in` : `${Math.round(profile.heightCm)} cm`;
  const rows: [string, string][] = [
    ['Goal', goalLabel(profile.goal)],
    ['Age', String(profile.age)],
    ['Height', ftIn],
    ['Weight', fmtWeight(profile.weightKg, profile.units)],
    ['Target weight', profile.targetWeightKg ? fmtWeight(profile.targetWeightKg, profile.units) : '–'],
    ['Experience', experienceLabel(profile.experienceYears)],
    ['Intensity', profile.intensity[0].toUpperCase() + profile.intensity.slice(1)],
    ['Training days', `${profile.daysPerWeek} per week`],
    ['Injuries', profile.injuries.join(', ') || 'None'],
    ['Diet', profile.diet.join(', ') || 'No restrictions'],
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Profile</p>
          <h1>{profile.name}</h1>
          <p className="muted">BMI {bmi(profile).toFixed(1)} · {targets.kcal} kcal and {targets.proteinG} g protein a day</p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing(true)}>
          Edit profile
        </button>
      </div>
      <div className="grid">
        <section className="card col-7">
          <h2>About you</h2>
          <ul className="list">
            {rows.map(([k, v]) => (
              <li key={k} className="row" style={{ justifyContent: 'space-between' }}>
                <span className="muted">{k}</span>
                <strong style={{ textAlign: 'right' }}>{v}</strong>
              </li>
            ))}
          </ul>
          {profile.injuryNotes && <p className="small muted" style={{ marginTop: 10 }}>Notes: {profile.injuryNotes}</p>}
        </section>
        <section className="card col-5">
          <h2>Connected data</h2>
          <p className="small muted" style={{ marginBottom: 6 }}>
            {session?.provider === 'apple' ? 'Apple Health' : 'Google Fit'} · simulated in this demo
          </p>
          {session &&
            (Object.keys(PERM_LABEL) as HealthPermission[]).map((k) => (
              <label key={k} className="setting">
                <span>{PERM_LABEL[k]}</span>
                <input type="checkbox" className="switch" checked={session.permissions[k]} onChange={(e) => setSession({ ...session, permissions: { ...session.permissions, [k]: e.target.checked } })} />
              </label>
            ))}
          <p className="tiny muted" style={{ marginTop: 8 }}>
            <IconShield size={13} style={{ verticalAlign: '-2px' }} /> Coming next: Apple Watch, Whoop and Fitbit through HealthKit and Health Connect.
          </p>
        </section>
        <section className="card col-12 row" style={{ justifyContent: 'space-between' }}>
          <button className="btn" onClick={toggleTheme}>
            {theme === 'dark' ? <IconSun size={16} /> : <IconMoon size={16} />} {theme === 'dark' ? 'Light' : 'Dark'} theme
          </button>
          <div className="row">
            <button
              className="btn"
              onClick={() => {
                if (confirm('Delete your profile, sets and food log from this device?')) {
                  ['fitmax.profile', 'fitmax.sets', 'fitmax.food', 'fitmax.weight', 'fitmax.shopping'].forEach((k) => localStorage.removeItem(k));
                  location.reload();
                }
              }}
            >
              Reset data
            </button>
            <button className="btn" onClick={signOut}>
              <IconLogout size={16} /> Sign out
            </button>
          </div>
        </section>
      </div>
    </>
  );
}
