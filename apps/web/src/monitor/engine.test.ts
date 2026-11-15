import { describe, expect, it } from 'vitest';
import { acknowledge, attribute, DEFAULT_WATCH, emptyWatch, normalize, step, type Reading, type WatchState } from './engine';

const T0 = new Date(2026, 10, 14, 9, 0, 0).getTime();
const health = { status: 'ok', source: 'esp32', processing: { state: 'live' } };
const sensing = (level: string, presence = true) => ({ source: 'esp32', classification: { motion_level: level, presence, confidence: 0.8 }, estimated_persons: 1 });

const read = (at: number, level: string, presence = true, extra: Partial<Reading> = {}): Reading => ({ ...normalize(at, health, sensing(level, presence), null, null), ...extra });

function run(readings: Reading[], s = DEFAULT_WATCH) {
  let st: WatchState = emptyWatch(readings[0].at);
  const raised = [];
  for (const r of readings) {
    const o = step(st, r, s);
    st = o.state;
    raised.push(...o.raised);
  }
  return { st, raised };
}

const every = (from: number, mins: number, level: string, presence = true) =>
  Array.from({ length: (mins * 60) / 10 + 1 }, (_, i) => read(from + i * 10_000, level, presence));

describe('normalize', () => {
  it('maps RuView fields and marks simulated data', () => {
    const r = normalize(T0, { source: 'simulated', processing: { state: 'live' } }, { ...sensing('present_moving'), source: 'simulated' }, { authority: 'abstained', abstention_reason: 'needs calibration' }, null);
    expect(r).toMatchObject({ simulated: true, presence: true, motion: 'moving', persons: 1 });
    expect(r.breathing).toEqual({ bpm: null, confidence: null, abstained: 'needs calibration' });
  });
  it('treats stale or missing frames as not live', () => {
    expect(normalize(T0, health, { status: 'stale' }, null, null).live).toBe(false);
    expect(normalize(T0, null, null, null, null).reachable).toBe(false);
  });
});

describe('HomeWatch', () => {
  it('credits active minutes only while moving', () => {
    const { st } = run([...every(T0, 10, 'present_moving'), ...every(T0 + 10 * 60_000 + 10_000, 10, 'present_still')]);
    expect(Math.round(st.activeMs / 60_000)).toBe(10);
    expect(st.timeline.length).toBeGreaterThan(15);
  });

  it('raises one inactivity alert after the threshold, then clears on movement', () => {
    const s = { ...DEFAULT_WATCH, inactivityMin: 20 };
    const still = every(T0, 25, 'present_still');
    const { st, raised } = run([...still, read(T0 + 26 * 60_000, 'present_moving')], s);
    expect(raised.filter((a) => a.kind === 'inactivity')).toHaveLength(1);
    expect(st.open.inactivity).toBeUndefined();
  });

  it('does not run the inactivity clock when nobody is home', () => {
    const { raised } = run(every(T0, 90, 'absent', false));
    expect(raised).toHaveLength(0);
  });

  it('keeps a fall alert open until acknowledged, then can raise again', () => {
    const r = (i: number, fall: boolean) => read(T0 + i * 10_000, 'present_still', true, { fall });
    let { st, raised } = run([r(0, false), r(1, true), r(2, true), r(3, false), r(4, true)]);
    expect(raised.filter((a) => a.kind === 'fall')).toHaveLength(1);
    expect(raised[0].severity).toBe('critical');
    expect(st.open.fall).toBe(raised[0].id); // still open after the flag dropped
    st = acknowledge(st, raised[0].id);
    expect(st.open.fall).toBeUndefined();
    expect(step(st, r(5, true)).raised.map((a) => a.kind)).toEqual(['fall']);
  });

  it('flags confident resting vitals out of range, ignores low-confidence ones', () => {
    const v = (bpm: number, confidence: number) => ({ bpm, confidence, abstained: null });
    const { raised } = run([
      read(T0, 'present_still', true, { breathing: v(32, 0.3) }),
      read(T0 + 10_000, 'present_still', true, { breathing: v(32, 0.9) }),
      read(T0 + 20_000, 'present_still', true, { heart: v(70, 0.9) }),
    ]);
    expect(raised.map((a) => a.kind)).toEqual(['breathing']);
  });

  it('raises hub offline after the grace period', () => {
    const off = (at: number): Reading => ({ ...read(at, 'absent', false), reachable: false, live: false });
    const { raised } = run([read(T0, 'present_still'), off(T0 + 30_000), off(T0 + 120_000)]);
    expect(raised.map((a) => a.kind)).toEqual(['offline']);
  });
});

describe('Only-me mode', () => {
  it('credits metrics only when one person is sensed and the phone is home, but still raises falls', () => {
    const two = { ...read(T0, 'present_moving'), persons: 2 };
    const a = attribute(two, true, { configured: true, home: true });
    expect(a.reason).toBe('2 people sensed');
    expect(a.reading.heart.bpm).toBeNull();
    const away = attribute(read(T0, 'present_moving'), true, { configured: true, home: false });
    expect(away.reason).toBe('your phone isn’t home');
    expect(attribute(read(T0, 'present_moving'), true, { configured: true, home: true }).reason).toBeNull();
    expect(attribute(two, false, null).reason).toBeNull();

    let st = emptyWatch(T0);
    for (let i = 0; i <= 60; i++) st = step(st, attribute({ ...read(T0 + i * 10_000, 'present_moving'), persons: 2 }, true, null).reading).state;
    expect(st.activeMs).toBe(0);
    const fall = step(st, attribute({ ...read(T0 + 700_000, 'present_still'), persons: 2, fall: true }, true, null).reading);
    expect(fall.raised.map((x) => x.kind)).toEqual(['fall']);
  });
});
