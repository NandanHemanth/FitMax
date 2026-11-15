import { describe, expect, it } from 'vitest';
import homes from '../../public/data/homes.json';
import { check, recommend, roomBox, score, type Mode } from './engine';
import { makePlan, squarify, trainingCandidates, type Home } from './floorplan';

const H = homes as unknown as Home[];

describe('floor plans from CoStar listings', () => {
  it('squarify tiles a rectangle exactly', () => {
    const rs = squarify([6, 6, 4, 3, 2, 2, 1], { x: 0, z: 0, w: 6, d: 4 });
    const area = rs.reduce((s, r) => s + r.w * r.d, 0);
    expect(area).toBeCloseTo(24, 6);
    for (const r of rs) expect(Math.max(r.w / r.d, r.d / r.w)).toBeLessThan(4);
  });

  it('every listing gets a plan whose rooms match beds and fit the footprint', () => {
    let habitable = 0;
    let tight = 0;
    for (const h of H) {
      const p = makePlan(h);
      const beds = p.rooms.filter((r) => r.type === 'bed' || r.type === 'primary').length;
      expect(beds).toBe(Math.max(1, Math.min(7, Math.round(h.beds || 0))));
      for (const r of p.rooms.filter((x) => x.type !== 'garage')) {
        expect(r.x).toBeGreaterThanOrEqual(-0.01);
        expect(r.x + r.w).toBeLessThanOrEqual(p.w + 0.02);
        expect(r.z + r.d).toBeLessThanOrEqual(p.d + 0.02);
        const service = r.type === 'hall' || r.type === 'bath' || r.type === 'laundry';
        const m = Math.min(r.w, r.d);
        expect(m, `${h.addr} ${r.name}`).toBeGreaterThanOrEqual(service ? 0.7 : 1.0);
        if (!service) {
          habitable++;
          if (m < 2.2) tight++;
        }
      }
    }
    expect(tight / habitable).toBeLessThan(0.03); // fewer than 3% of rooms narrower than 2.2 m
  }, 60_000);

  it('suggests a training room', () => {
    const h = H.find((x) => x.beds >= 3 && x.garage)!;
    const c = trainingCandidates(makePlan(h));
    expect(c[0].type).toBe('garage');
  });
});

describe('recommendations', () => {
  const modes: Mode[] = ['space', 'fitness', 'modern'];
  it('produce error-free layouts in real rooms of 40 homes', () => {
    let rooms = 0;
    for (const h of H.filter((_, i) => i % 44 === 0)) {
      for (const r of makePlan(h).rooms.filter((x) => ['living', 'primary', 'bed', 'office', 'garage', 'gym', 'family'].includes(x.type))) {
        const box = roomBox(r);
        for (const m of modes) {
          const rec = recommend(box, m, 'build_muscle', []);
          const errors = check(box, rec.items).filter((i) => i.level === 'error');
          expect(errors, `${h.addr} ${r.name} ${m}: ${errors.map((e) => e.text).join('; ')}`).toEqual([]);
        }
        rooms++;
      }
    }
    expect(rooms).toBeGreaterThan(80);
  }, 120_000);

  it('each mode wins on its own score', () => {
    const box = { w: 4.2, l: 3.8, h: 2.6, type: 'primary' as const, door: { wall: 'n' as const, at: 0.5 }, windows: ['s' as const] };
    const s = Object.fromEntries(modes.map((m) => [m, score(box, recommend(box, m, 'general').items, 'general').scores])) as Record<Mode, ReturnType<typeof score>['scores']>;
    expect(s.space.space).toBeGreaterThanOrEqual(s.modern.space);
    expect(s.fitness.fitness).toBeGreaterThan(s.space.fitness);
    expect(s.modern.modern).toBeGreaterThan(s.fitness.modern);
  });

  it('treadmill always gets its 2 m run-off', () => {
    const box = { w: 6, l: 6, h: 2.8, type: 'garage' as const, door: { wall: 'w' as const, at: 0.3 }, windows: ['n' as const] };
    const rec = recommend(box, 'fitness', 'endurance');
    expect(rec.items.some((i) => i.key === 'treadmill')).toBe(true);
    expect(check(box, rec.items).filter((i) => i.text.includes('Treadmill') && i.level === 'error')).toEqual([]);
  });

  it('flags metal on a sensing line', () => {
    const box = { w: 4, l: 4, h: 2.6, type: 'gym' as const, door: { wall: 'n' as const, at: 0.5 }, windows: [] };
    const items = [{ uid: 'a', key: 'rack', x: 2, z: 2, rot: 0 as const }];
    const { scores, issues } = score(box, items, 'general', [], [[[0, 2], [4, 2]]]);
    expect(scores.sensing).toBeLessThan(100);
    expect(issues.some((i) => i.text.includes('sensing line'))).toBe(true);
  });
});

describe('WiFi-aware placement', () => {
  it('fitness layouts keep metal off the sensing triangle more often than not', () => {
    const box = { w: 6, l: 6.5, h: 2.8, type: 'garage' as const, door: { wall: 'w' as const, at: 0.3 }, windows: ['n' as const] };
    const a: [number, number] = [0.3, 3.25];
    const b: [number, number] = [5.7, 3.25];
    const c: [number, number] = [3, 6.2];
    const links: [[number, number], [number, number]][] = [[a, b], [c, b], [c, a]];
    const blind = score(box, recommend(box, 'fitness', 'build_muscle').items, 'build_muscle', [], links).scores.sensing;
    const aware = score(box, recommend(box, 'fitness', 'build_muscle', [], links).items, 'build_muscle', [], links).scores.sensing;
    expect(aware).toBeGreaterThan(blind);
  });
});
