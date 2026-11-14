/**
 * Simulated Google Fit / Apple Health data for the demo. Sign-in and permissions are
 * stubs; these numbers are generated on the device (stable per day) and always labelled
 * "demo data" in the UI. Swap `readHealth()` for HealthKit / Health Connect later.
 */
import type { Profile, Session } from './profile';

export interface DayHealth {
  date: string; // YYYY-MM-DD
  steps: number;
  activeMinutes: number;
  restingHr: number;
  sleepHours: number;
}

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function readHealth(session: Session | null, profile: Profile | null, days = 7): DayHealth[] {
  if (!session) return [];
  const fitness = profile ? Math.min(1, profile.experienceYears / 5) : 0.3;
  const out: DayHealth[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const day = isoDay(d);
    const rnd = seeded([...day].reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    out.push({
      date: day,
      steps: Math.round(5200 + rnd() * 6200 + (weekend ? 1500 : 0)),
      activeMinutes: Math.round(14 + rnd() * 38 + fitness * 10),
      restingHr: Math.round(68 - fitness * 9 + rnd() * 5),
      sleepHours: Math.round((6.1 + rnd() * 1.9) * 10) / 10,
    });
  }
  return out;
}
