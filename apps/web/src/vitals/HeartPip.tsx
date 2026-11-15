import { useSyncExternalStore } from 'react';
import { HeartCam } from './HeartCam';
import { vitals } from './store';

/** The always-on webcam vitals: runs invisibly in the background on every tab while it's on (no preview). */
export function HeartPip() {
  const v = useSyncExternalStore(vitals.subscribe, vitals.get);
  if (!v.on) return null;
  return (
    <div className="pip-hidden" aria-hidden="true">
      <HeartCam
        compact
        onReading={(r) => vitals.set({ hr: r, ...(r.bpm ? { last: { bpm: r.bpm, at: Date.now(), conf: r.confidence } } : {}) })}
        onBreath={(b) => vitals.set({ breath: { ...b, at: Date.now() } })}
      />
    </div>
  );
}
