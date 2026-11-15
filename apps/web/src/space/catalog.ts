import type { Goal } from '../state/profile';

/** What an item lets you train; goals are scored by which roles a layout covers. */
export type Role = 'squat' | 'bench' | 'pull' | 'dumbbell' | 'hinge' | 'cardio' | 'conditioning' | 'mobility' | 'recovery' | 'form';

export type Shape = 'rack' | 'bench' | 'box' | 'treadmill' | 'bike' | 'rower' | 'platform' | 'mat' | 'mirror' | 'cable' | 'bar';

export interface ItemDef {
  key: string;
  name: string;
  w: number; // width across, metres (local x)
  d: number; // depth, metres (local z; front = +z)
  h: number; // height, metres
  /** Free space needed around the item while training (metres). Back 0 = fine against a wall. */
  clear: { front: number; back: number; side: number };
  minCeiling?: number; // metres of ceiling the exercise needs
  price: number; // USD, typical new price
  roles: Role[];
  avoidFor?: string[]; // injuries from the profile that make this a poor pick
  wall?: boolean; // happiest with its back to a wall
  shape: Shape;
  color: string;
  custom?: boolean;
}

/**
 * Typical home-gym equipment. Sizes and prices are representative retail figures; clearances follow
 * common guidance (e.g. ~2 m behind a treadmill, ~0.6–0.9 m around free-weight stations). Approximate.
 */
export const CATALOG: ItemDef[] = [
  { key: 'rack', name: 'Power rack', w: 1.25, d: 1.45, h: 2.3, clear: { front: 0.9, back: 0, side: 0.6 }, minCeiling: 2.35, price: 700, roles: ['squat', 'pull'], wall: true, shape: 'rack', color: '#3b3f4a' },
  { key: 'bench', name: 'Adjustable bench', w: 0.65, d: 1.45, h: 0.5, clear: { front: 0.6, back: 0.4, side: 0.6 }, price: 250, roles: ['bench'], shape: 'bench', color: '#1f2937' },
  { key: 'dumbbells', name: 'Adjustable dumbbells + stand', w: 0.7, d: 0.6, h: 0.9, clear: { front: 0.9, back: 0, side: 0.3 }, price: 400, roles: ['dumbbell'], wall: true, shape: 'box', color: '#52525b' },
  { key: 'platform', name: 'Lifting platform + barbell', w: 2.4, d: 1.8, h: 0.05, clear: { front: 0.6, back: 0.6, side: 0.6 }, price: 550, roles: ['hinge', 'squat'], avoidFor: ['Lower back'], shape: 'platform', color: '#6b4f2a' },
  { key: 'cable', name: 'Functional trainer (cables)', w: 1.6, d: 1.0, h: 2.1, clear: { front: 1.5, back: 0, side: 0.3 }, minCeiling: 2.2, price: 1500, roles: ['pull', 'bench', 'mobility'], wall: true, shape: 'cable', color: '#334155' },
  { key: 'treadmill', name: 'Treadmill', w: 0.9, d: 2.0, h: 1.4, clear: { front: 0.3, back: 2.0, side: 0.5 }, price: 1200, roles: ['cardio'], avoidFor: ['Knee', 'Ankle'], shape: 'treadmill', color: '#27272a' },
  { key: 'bike', name: 'Spin bike', w: 0.55, d: 1.2, h: 1.1, clear: { front: 0.5, back: 0.5, side: 0.5 }, price: 600, roles: ['cardio'], shape: 'bike', color: '#ff6b2c' },
  { key: 'rower', name: 'Rowing machine', w: 0.55, d: 2.45, h: 0.55, clear: { front: 0.5, back: 0.5, side: 0.5 }, price: 900, roles: ['cardio', 'conditioning'], avoidFor: ['Lower back'], shape: 'rower', color: '#3b82f6' },
  { key: 'pullup', name: 'Wall pull-up bar', w: 1.2, d: 0.6, h: 2.25, clear: { front: 0.9, back: 0, side: 0.3 }, minCeiling: 2.3, price: 120, roles: ['pull'], avoidFor: ['Shoulder'], wall: true, shape: 'bar', color: '#9ca3af' },
  { key: 'kettlebells', name: 'Kettlebells + rack', w: 0.9, d: 0.4, h: 0.6, clear: { front: 1.2, back: 0, side: 0.3 }, price: 250, roles: ['conditioning', 'hinge'], wall: true, shape: 'box', color: '#111827' },
  { key: 'mat', name: 'Mobility / yoga mat zone', w: 0.8, d: 1.9, h: 0.02, clear: { front: 0.4, back: 0.4, side: 0.5 }, price: 40, roles: ['mobility'], shape: 'mat', color: '#22c55e' },
  { key: 'recovery', name: 'Recovery corner (roller, bands)', w: 1.0, d: 1.0, h: 0.15, clear: { front: 0.3, back: 0, side: 0.2 }, price: 80, roles: ['recovery', 'mobility'], wall: true, shape: 'mat', color: '#14b8a6' },
  { key: 'mirror', name: 'Wall mirror', w: 1.8, d: 0.05, h: 1.8, clear: { front: 1.2, back: 0, side: 0 }, price: 150, roles: ['form'], wall: true, shape: 'mirror', color: '#bfdbfe' },
  { key: 'plyo', name: 'Plyo box', w: 0.75, d: 0.6, h: 0.6, clear: { front: 0.9, back: 0.9, side: 0.6 }, minCeiling: 2.5, price: 120, roles: ['conditioning'], avoidFor: ['Knee', 'Ankle'], shape: 'box', color: '#a16207' },
];

export const byKey = (key: string, custom: ItemDef[] = []) => CATALOG.find((c) => c.key === key) ?? custom.find((c) => c.key === key);

/** How much each role matters for a goal (weights sum to 1). */
export const GOAL_ROLES: Record<Goal, Partial<Record<Role, number>>> = {
  build_muscle: { squat: 0.25, bench: 0.2, pull: 0.2, dumbbell: 0.2, cardio: 0.1, mobility: 0.05 },
  hypertrophy: { dumbbell: 0.25, pull: 0.2, bench: 0.2, squat: 0.2, cardio: 0.1, mobility: 0.05 },
  shred: { cardio: 0.3, conditioning: 0.2, dumbbell: 0.2, squat: 0.15, mobility: 0.15 },
  endurance: { cardio: 0.5, mobility: 0.2, conditioning: 0.15, pull: 0.15 },
  general: { cardio: 0.25, dumbbell: 0.25, mobility: 0.2, pull: 0.15, conditioning: 0.15 },
  mobility: { mobility: 0.45, recovery: 0.25, cardio: 0.15, pull: 0.15 },
};

/** Recommended picks per goal, most important first. */
export const GOAL_PICKS: Record<Goal, string[]> = {
  build_muscle: ['rack', 'bench', 'dumbbells', 'bike', 'mat', 'mirror'],
  hypertrophy: ['rack', 'bench', 'dumbbells', 'cable', 'mirror', 'mat'],
  shred: ['kettlebells', 'dumbbells', 'bike', 'rower', 'mat', 'bench'],
  endurance: ['treadmill', 'bike', 'rower', 'mat', 'pullup', 'recovery'],
  general: ['dumbbells', 'bench', 'bike', 'mat', 'pullup', 'kettlebells'],
  mobility: ['mat', 'recovery', 'bike', 'mirror', 'cable'],
};

/** Joint-friendly swaps when an injury rules an item out. */
export const SWAPS: Record<string, string> = { treadmill: 'bike', plyo: 'kettlebells', platform: 'cable', rower: 'bike', pullup: 'cable' };

export const ROLE_LABEL: Record<Role, string> = {
  squat: 'Squat',
  bench: 'Press',
  pull: 'Pull',
  dumbbell: 'Dumbbells',
  hinge: 'Hinge',
  cardio: 'Cardio',
  conditioning: 'Conditioning',
  mobility: 'Mobility',
  recovery: 'Recovery',
  form: 'Form check',
};

export interface RoomPreset {
  id: string;
  name: string;
  w: number;
  l: number;
  h: number;
}
export const ROOMS: RoomPreset[] = [
  { id: 'garage2', name: '2-car garage', w: 6.0, l: 6.0, h: 2.6 },
  { id: 'garage1', name: '1-car garage', w: 3.6, l: 6.0, h: 2.6 },
  { id: 'basement', name: 'Basement', w: 6.0, l: 4.5, h: 2.3 },
  { id: 'spare', name: 'Spare bedroom', w: 3.6, l: 3.3, h: 2.4 },
  { id: 'corner', name: 'Living-room corner', w: 3.0, l: 2.6, h: 2.6 },
  { id: 'yard', name: 'Backyard / patio', w: 6.0, l: 5.0, h: 6.0 },
];
