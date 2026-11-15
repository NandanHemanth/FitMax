/**
 * Camera vitals shared across the app, so the webcam keeps measuring in the background
 * (a small floating preview) while you use any tab. Tiny subscribe/get store for useSyncExternalStore.
 */
import type { HrResult } from './rppg';

export interface Vitals {
  on: boolean;
  hr: HrResult | null; // live
  last: { bpm: number; at: number; conf: number } | null; // last confident heart rate
  breath: { bpm: number | null; confidence: number; why: string | null; at: number } | null; // camera breathing
}
// Off only if you stopped it yourself; otherwise it starts on its own when you open Monitor.
const KEY = 'fitmax.vitals.stopped';
const stoppedByYou = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};
let state: Vitals = { on: false, hr: null, last: null, breath: null };
const subs = new Set<() => void>();

export const vitals = {
  get: () => state,
  subscribe: (f: () => void) => {
    subs.add(f);
    return () => subs.delete(f);
  },
  set(p: Partial<Vitals>) {
    state = { ...state, ...p };
    if ('on' in p) {
      try {
        localStorage.setItem(KEY, p.on ? '0' : '1');
      } catch {
        /* ignore */
      }
    }
    subs.forEach((f) => f());
  },
  /** Called when Monitor opens: start the camera unless you turned it off. */
  autoStart() {
    if (!state.on && !stoppedByYou()) {
      state = { ...state, on: true };
      subs.forEach((f) => f());
    }
  },
};
