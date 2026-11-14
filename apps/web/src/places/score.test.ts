import { describe, expect, it } from 'vitest';
import { decay, distM, indexPlaces, scoreHome, weightsFor, type PlacesData } from './score';

const base: PlacesData = {
  id: 't', name: 'Test', bbox: [0, 0, 1, 1], center: [-95.4, 29.75],
  gyms: [], groceries: [], parks: [], outdoor: [], physio: [], cycleways: [], trails: [], homes: [],
};
const at = (dx: number, dy: number) => ({ lon: -95.4 + dx / 96_500, lat: 29.75 + dy / 111_200 });
const home = { id: 'h', name: 'Home', ...at(0, 0) };

describe('score', () => {
  it('measures distance in metres', () => {
    const p = at(1000, 0);
    expect(distM(home.lon, home.lat, p.lon, p.lat)).toBeGreaterThan(980);
    expect(distM(home.lon, home.lat, p.lon, p.lat)).toBeLessThan(1020);
  });

  it('decays linearly', () => {
    expect(decay(100, 250, 2000)).toBe(1);
    expect(decay(2000, 250, 2000)).toBe(0);
    expect(decay(1125, 250, 2000)).toBeCloseTo(0.5);
  });

  it('weights sum to 1 and shift for knee injuries', () => {
    const w = weightsFor({ goal: 'endurance', injuries: ['Knee'], diet: [] });
    expect(Object.values(w.w).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(w.bikeShare).toBeGreaterThan(0.8);
  });

  it('a home next to everything beats an isolated one', () => {
    const rich: PlacesData = {
      ...base,
      gyms: [{ id: 'g', name: 'Iron Gym', ...at(200, 0) }],
      groceries: [{ id: 'f', name: 'Fresh Market', ...at(0, 250) }],
      parks: [{ id: 'p', name: 'Buffalo Bayou Park', ...at(-100, 0) }],
      physio: [{ id: 'r', name: 'Rehab Co', ...at(400, 0) }],
      cycleways: [[[at(-500, 50).lon, at(-500, 50).lat], [at(500, 50).lon, at(500, 50).lat]]],
    };
    const good = scoreHome(home, indexPlaces(rich), { goal: 'hypertrophy', injuries: [], diet: [] });
    const bad = scoreHome(home, indexPlaces(base), { goal: 'hypertrophy', injuries: [], diet: [] });
    expect(good.total).toBeGreaterThan(60);
    expect(bad.total).toBe(0);
    expect(bad.categories.recovery.weight).toBe(0);
    expect(good.categories.strength.reason).toMatch(/Iron Gym 200 m/);
    expect(good.nearby.cycleways).toEqual([0]);
  });

  it('goal changes the score', () => {
    const gymOnly: PlacesData = { ...base, gyms: [{ id: 'g', name: 'G', ...at(100, 0) }] };
    const idx = indexPlaces(gymOnly);
    const lift = scoreHome(home, idx, { goal: 'hypertrophy', injuries: [], diet: [] }).total;
    const run = scoreHome(home, idx, { goal: 'endurance', injuries: [], diet: [] }).total;
    expect(lift).toBeGreaterThan(run);
  });
});
