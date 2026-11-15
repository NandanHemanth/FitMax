/** User profile, sign-in session and derived targets. Everything is stored on the device. */

export type Sex = 'male' | 'female' | 'other';
export type Goal = 'build_muscle' | 'hypertrophy' | 'shred' | 'endurance' | 'general' | 'mobility';
export type Intensity = 'light' | 'moderate' | 'hard';
export type Units = 'metric' | 'imperial';

export interface Profile {
  name: string;
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  targetWeightKg: number | null;
  units: Units;
  goal: Goal;
  /** Training experience in years, in half-year steps (0 = under 6 months, 5 = 5+). */
  experienceYears: number;
  intensity: Intensity;
  daysPerWeek: number;
  injuries: string[];
  injuryNotes: string;
  diet: string[];
  createdAt: string;
}

export type HealthSource = 'google' | 'apple';
export type HealthPermission = 'steps' | 'heart' | 'workouts' | 'sleep' | 'nutrition' | 'weight';

export interface Session {
  provider: HealthSource;
  displayName: string;
  permissions: Record<HealthPermission, boolean>;
  signedInAt: string;
}

export const GOALS: { id: Goal; label: string; blurb: string }[] = [
  { id: 'build_muscle', label: 'Build muscle', blurb: 'Get stronger and add lean mass' },
  { id: 'hypertrophy', label: 'Hypertrophy', blurb: 'Maximise muscle size with volume' },
  { id: 'shred', label: 'Shred / lose fat', blurb: 'Lose fat, keep muscle' },
  { id: 'endurance', label: 'Endurance', blurb: 'Run, ride and last longer' },
  { id: 'general', label: 'General fitness', blurb: 'Feel better, move more' },
  { id: 'mobility', label: 'Mobility & recovery', blurb: 'Move freely, train around pain' },
];

export const INJURIES = ['Knee', 'Lower back', 'Shoulder', 'Elbow', 'Wrist', 'Ankle', 'Hip', 'Neck'];
export const DIETS = [
  'Vegetarian',
  'Vegan',
  'Pescatarian',
  'Halal',
  'Kosher',
  'Gluten-free',
  'Lactose-free',
  'Nut allergy',
  'Low sodium',
  'Keto / low carb',
];

/** 0, 0.5, 1 … 5 (5 = 5+ years). */
export const EXPERIENCE_STEPS = Array.from({ length: 11 }, (_, i) => i / 2);
export function experienceLabel(y: number): string {
  if (y === 0) return 'Under 6 months';
  if (y >= 5) return '5+ years';
  const fmt = (n: number) => (Number.isInteger(n) ? `${n}` : n.toFixed(1));
  return `${fmt(y)} – ${fmt(y + 0.5)} years`;
}

export const goalLabel = (g: Goal) => GOALS.find((x) => x.id === g)?.label ?? g;

const KEYS = { profile: 'fitmax.profile', session: 'fitmax.session' };

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, v: unknown) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

export const loadProfile = () => read<Profile>(KEYS.profile);
export const saveProfile = (p: Profile | null) => write(KEYS.profile, p);
export const loadSession = () => read<Session>(KEYS.session);
export const saveSession = (s: Session | null) => write(KEYS.session, s);

// ---------- units ----------
export const kgToLb = (kg: number) => kg * 2.20462;
export const lbToKg = (lb: number) => lb / 2.20462;
export const cmToFtIn = (cm: number) => {
  const totalIn = cm / 2.54;
  return { ft: Math.floor(totalIn / 12), inch: Math.round(totalIn % 12) };
};
export const ftInToCm = (ft: number, inch: number) => (ft * 12 + inch) * 2.54;
export function fmtWeight(kg: number, units: Units): string {
  return units === 'imperial' ? `${Math.round(kgToLb(kg))} lb` : `${Math.round(kg * 10) / 10} kg`;
}

// ---------- nutrition targets ----------
export interface Targets {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  proteinPerKg: number;
  bmr: number;
  tdee: number;
}

/**
 * Mifflin–St Jeor BMR × activity factor, adjusted for the goal.
 * Protein: 1.6 g/kg where gains plateau on average (Morton et al. 2018), up to 2.2 g/kg
 * (the upper confidence bound) when cutting or chasing hypertrophy.
 */
export function computeTargets(p: Profile): Targets {
  const s = p.sex === 'male' ? 5 : p.sex === 'female' ? -161 : -78;
  const bmr = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + s;
  const activity = 1.2 + Math.min(p.daysPerWeek, 7) * 0.05 + (p.intensity === 'hard' ? 0.1 : p.intensity === 'moderate' ? 0.05 : 0);
  const tdee = bmr * activity;
  const adjust: Record<Goal, number> = {
    build_muscle: 1.1,
    hypertrophy: 1.1,
    shred: 0.8,
    endurance: 1.05,
    general: 1,
    mobility: 1,
  };
  const kcal = Math.round((tdee * adjust[p.goal]) / 10) * 10;
  const proteinPerKg = p.goal === 'shred' || p.goal === 'hypertrophy' ? 2.2 : p.goal === 'build_muscle' ? 2.0 : 1.6;
  const proteinG = Math.round(proteinPerKg * p.weightKg);
  const keto = p.diet.includes('Keto / low carb');
  const fatG = Math.round((keto ? 0.6 : 0.25) * kcal / 9);
  const carbsG = Math.max(0, Math.round((kcal - proteinG * 4 - fatG * 9) / 4));
  return { kcal, proteinG, carbsG, fatG, proteinPerKg, bmr: Math.round(bmr), tdee: Math.round(tdee) };
}

export const bmi = (p: Profile) => p.weightKg / (p.heightCm / 100) ** 2;


// ---------- placeholder sign-in ----------
/** One-tap demo sign-in: everything shared, no permission screen. */
export function quickSession(provider: HealthSource): Session {
  return {
    provider,
    displayName: '',
    permissions: { steps: true, heart: true, workouts: true, sleep: true, weight: true, nutrition: true },
    signedInAt: new Date().toISOString(),
  };
}

/** A sensible starting profile so nobody has to fill a form to see the app. Editable in Profile. */
export function defaultProfile(name = 'Nandan'): Profile {
  return {
    name,
    sex: 'male',
    age: 24,
    heightCm: 178,
    weightKg: 75,
    targetWeightKg: 72,
    units: 'imperial',
    goal: 'build_muscle',
    experienceYears: 2,
    intensity: 'moderate',
    daysPerWeek: 4,
    injuries: [],
    injuryNotes: '',
    diet: [],
    createdAt: new Date().toISOString(),
  };
}

/** Mirror sign-in + profile to the laptop (dev server) so every browser starts signed in. */
export async function syncMe(session: Session | null, profile: Profile | null) {
  try {
    await fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session, profile }) });
  } catch {
    /* offline or static build: localStorage still has it */
  }
}
export async function fetchMe(): Promise<{ session?: Session | null; profile?: Profile | null }> {
  try {
    const r = await fetch('/api/profile', { cache: 'no-store' });
    return r.ok ? await r.json() : {};
  } catch {
    return {};
  }
}
