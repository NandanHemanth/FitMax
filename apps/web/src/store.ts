import type { Rep, SetSummary, Side } from './engine/curl';

export interface SavedSet {
  id: string;
  exercise: 'bicep-curl';
  at: string;
  side: Side;
  summary: SetSummary;
  reps: Rep[];
}

export interface Settings {
  side: 'auto' | Side;
  countAloud: boolean;
  voice: boolean;
  ghost: boolean;
  camera: 'user' | 'environment';
}

const SETS = 'fitmax.sets';
const SETTINGS = 'fitmax.settings';

export const DEFAULT_SETTINGS: Settings = { side: 'auto', countAloud: true, voice: true, ghost: true, camera: 'user' };

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage can be unavailable (private mode); the app still works */
  }
}

export const loadSets = (): SavedSet[] => read<SavedSet[]>(SETS, []);
export const saveSet = (s: SavedSet): void => write(SETS, [s, ...loadSets()].slice(0, 100));
export const loadSettings = (): Settings => ({ ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(SETTINGS, {}) });
export const saveSettings = (s: Settings): void => write(SETTINGS, s);
