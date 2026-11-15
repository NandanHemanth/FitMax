import { describe, expect, it } from 'vitest';
import { byKey } from './catalog';
import { pickFootprint, pointInPolygon, polygonArea } from './home';
import { bodyRect, clearRect, recommend, scoreSpace, validate, type Placed, type Room } from './layout';

const garage: Room = { w: 6, l: 6, h: 2.6 };
const tm = byKey('treadmill')!;

describe('geometry', () => {
  it('rotates clearance with the item (treadmill needs 2 m behind)', () => {
    const p: Placed = { uid: 'a', key: 'treadmill', x: 3, z: 3, rot: 0 };
    expect(clearRect(p, tm)).toEqual({ x0: 2.05, z0: 0, x1: 3.95, z1: 4.3 });
    const r = clearRect({ ...p, rot: 90 }, tm);
    expect(r.x1 - r.x0).toBeCloseTo(2.0 + 2.0 + 0.3);
    expect(bodyRect({ ...p, rot: 90 }, tm).x1 - bodyRect({ ...p, rot: 90 }, tm).x0).toBeCloseTo(2.0);
  });
});

describe('validate', () => {
  it('flags overlaps, blocked safety zones, low ceilings and injuries', () => {
    const items: Placed[] = [
      { uid: 'a', key: 'treadmill', x: 3, z: 3.5, rot: 0 }, // needs z 0.5–2.5 free behind it
      { uid: 'b', key: 'bench', x: 3, z: 1.5, rot: 0 }, // parked in that run-off zone
    ];
    const issues = validate({ w: 6, l: 6, h: 2.2 }, items, byKey, ['Knee']);
    const texts = issues.map((i) => `${i.severity}:${i.text}`);
    expect(texts.some((t) => t.startsWith('warn:') && t.includes('safety zone'))).toBe(true);
    expect(texts.some((t) => t.startsWith('info:') && t.includes('knee'))).toBe(true);
    const low = validate({ w: 6, l: 6, h: 2.2 }, [{ uid: 'r', key: 'rack', x: 1, z: 1, rot: 0 }], byKey);
    expect(low.some((i) => i.text.includes('ceiling'))).toBe(true);
  });
});

describe('recommend', () => {
  it('builds a safe strength layout in a 2-car garage', () => {
    const rec = recommend(garage, 'build_muscle', 3000, []);
    expect(rec.items.map((i) => i.key)).toEqual(expect.arrayContaining(['rack', 'bench', 'dumbbells']));
    const issues = validate(garage, rec.items, byKey);
    expect(issues.filter((i) => i.severity !== 'info')).toEqual([]);
    const s = scoreSpace(garage, rec.items, byKey, 'build_muscle', 3000, issues);
    expect(s.total).toBeGreaterThanOrEqual(85);
    expect(s.budgetOk).toBe(true);
  });
  it('swaps the treadmill for a bike with a knee injury, and respects a low ceiling', () => {
    const rec = recommend({ w: 6, l: 4.5, h: 2.2 }, 'endurance', 5000, ['Knee']);
    expect(rec.swapped).toContainEqual({ from: 'treadmill', to: 'bike', injury: 'Knee' });
    expect(rec.items.some((i) => i.key === 'treadmill')).toBe(false);
    expect(rec.skipped.some((s) => s.key === 'pullup' && s.why.includes('ceiling'))).toBe(true);
  });
  it('stays within budget', () => {
    const rec = recommend(garage, 'hypertrophy', 1000, []);
    const cost = rec.items.reduce((s, i) => s + byKey(i.key)!.price, 0);
    expect(cost).toBeLessThanOrEqual(1000);
  });
});

describe('home footprint', () => {
  it('picks the building containing the point and computes area', () => {
    const sq = (lat: number, lng: number, d: number) => [
      { lat: lat - d, lon: lng - d }, { lat: lat - d, lon: lng + d }, { lat: lat + d, lon: lng + d }, { lat: lat + d, lon: lng - d }, { lat: lat - d, lon: lng - d },
    ];
    const f = pickFootprint(40.35, -74.66, [
      { id: 1, geometry: sq(40.3503, -74.66, 0.00005), tags: {} },
      { id: 2, geometry: sq(40.35, -74.66, 0.0001), tags: { 'building:levels': '3' } },
    ])!;
    expect(f.osmId).toBe(2);
    expect(f.height).toBe(9);
    expect(pointInPolygon(0, 0, f.points)).toBe(true);
    expect(polygonArea(f.points)).toBeGreaterThan(300);
  });
});
