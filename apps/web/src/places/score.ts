/**
 * FitMax Score for a home: how well its surroundings support the user's goal.
 * Inputs are point and line features around the home (OpenStreetMap today; CoStar
 * amenities and Vexcel-detected courts/pools later). Weights come from the profile.
 */
import type { Goal } from '../state/profile';

export type LngLat = [number, number];
export interface Poi {
  id: string;
  name: string | null;
  lon: number;
  lat: number;
}
export interface Home extends Poi {
  addr?: string | null;
  levels?: number | null;
}
export interface PlacesData {
  id: string;
  name: string;
  bbox: [number, number, number, number];
  center: LngLat;
  fetchedAt?: string;
  source?: string;
  gyms: Poi[];
  groceries: Poi[];
  parks: Poi[];
  outdoor: Poi[];
  physio: Poi[];
  cycleways: LngLat[][];
  trails: LngLat[][];
  homes: Home[];
}

export type Category = 'strength' | 'cardio' | 'outdoor' | 'nutrition' | 'recovery';
export const CATEGORY_LABEL: Record<Category, string> = {
  strength: 'Gyms & studios',
  cardio: 'Run & ride routes',
  outdoor: 'Parks & outdoor',
  nutrition: 'Healthy groceries',
  recovery: 'Physio & recovery',
};

export interface ScoreInput {
  goal: Goal;
  injuries: string[];
  diet: string[];
}

export interface CategoryScore {
  score: number; // 0..100
  weight: number; // 0..1
  reason: string;
}

export interface HomeScore {
  total: number;
  categories: Record<Category, CategoryScore>;
  nearby: { gyms: Poi[]; groceries: Poi[]; parks: Poi[]; outdoor: Poi[]; physio: Poi[]; cycleways: number[]; trails: number[] };
  weighting: string;
}

/** Metres between two points (equirectangular; accurate to <0.5% at city scale). */
export function distM(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const k = Math.PI / 180;
  const x = (bLon - aLon) * k * Math.cos(((aLat + bLat) / 2) * k);
  const y = (bLat - aLat) * k;
  return Math.hypot(x, y) * 6_371_000;
}

/** 1 at or under `near`, 0 at or beyond `far`, linear between. */
export const decay = (d: number, near: number, far: number) => (d <= near ? 1 : d >= far ? 0 : 1 - (d - near) / (far - near));

const BASE_WEIGHTS: Record<Goal, Record<Category, number>> = {
  build_muscle: { strength: 0.35, nutrition: 0.25, cardio: 0.12, outdoor: 0.15, recovery: 0.13 },
  hypertrophy: { strength: 0.38, nutrition: 0.25, cardio: 0.1, outdoor: 0.14, recovery: 0.13 },
  shred: { cardio: 0.28, nutrition: 0.25, strength: 0.2, outdoor: 0.17, recovery: 0.1 },
  endurance: { cardio: 0.4, outdoor: 0.22, nutrition: 0.18, strength: 0.1, recovery: 0.1 },
  general: { strength: 0.22, cardio: 0.22, outdoor: 0.22, nutrition: 0.22, recovery: 0.12 },
  mobility: { outdoor: 0.28, recovery: 0.25, strength: 0.17, cardio: 0.15, nutrition: 0.15 },
};

const JOINT = ['Knee', 'Ankle', 'Hip'];

export function weightsFor(input: ScoreInput, missing: Category[] = []): { w: Record<Category, number>; bikeShare: number; label: string } {
  const w = { ...BASE_WEIGHTS[input.goal] };
  const notes: string[] = [];
  let bikeShare = 0.6;
  if (input.injuries.length && !missing.includes('recovery')) {
    w.recovery += 0.08;
    notes.push('more weight on physio');
  }
  if (input.injuries.some((i) => JOINT.includes(i))) {
    bikeShare = 0.85; // cycling is lower-impact than running for lower-limb joints
    notes.push('cycling over running for your joints');
  }
  // Categories with no map data in this area are left out rather than scored as zero.
  for (const c of missing) w[c] = 0;
  const sum = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  (Object.keys(w) as Category[]).forEach((k) => (w[k] = w[k] / sum));
  return { w, bikeShare, label: notes.join(', ') };
}

interface Seg {
  lineIdx: number;
  mid: LngLat;
  len: number;
}

/** Precomputes segment midpoints/lengths so scoring many homes stays fast. */
export function indexLines(lines: LngLat[][]): Seg[] {
  const segs: Seg[] = [];
  lines.forEach((line, lineIdx) => {
    for (let i = 1; i < line.length; i++) {
      const [x1, y1] = line[i - 1], [x2, y2] = line[i];
      segs.push({ lineIdx, mid: [(x1 + x2) / 2, (y1 + y2) / 2], len: distM(x1, y1, x2, y2) });
    }
  });
  return segs;
}

export interface Indexed {
  data: PlacesData;
  bikeSegs: Seg[];
  trailSegs: Seg[];
}
export const indexPlaces = (data: PlacesData): Indexed => ({ data, bikeSegs: indexLines(data.cycleways), trailSegs: indexLines(data.trails) });

function nearbyPois(pois: Poi[], lon: number, lat: number, radius: number) {
  return pois
    .map((p) => ({ p, d: distM(lon, lat, p.lon, p.lat) }))
    .filter((x) => x.d <= radius)
    .sort((a, b) => a.d - b.d);
}

function lengthWithin(segs: Seg[], lon: number, lat: number, radius: number) {
  let len = 0;
  const lines = new Set<number>();
  for (const s of segs) {
    if (distM(lon, lat, s.mid[0], s.mid[1]) <= radius) {
      len += s.len;
      lines.add(s.lineIdx);
    }
  }
  return { len, lines: [...lines] };
}

const fmtD = (d: number) => (d < 1000 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(1)} km`);
const label = (p: Poi, fallback: string) => p.name ?? fallback;

export const NEAR_RADIUS = 1200;

export function scoreHome(home: Poi, idx: Indexed, input: ScoreInput): HomeScore {
  const { data } = idx;
  const { lon, lat } = home;
  const missing: Category[] = data.physio.length === 0 ? ['recovery'] : [];
  const { w, bikeShare, label: weighting } = weightsFor(input, missing);

  const gyms = nearbyPois(data.gyms, lon, lat, 2500);
  const groceries = nearbyPois(data.groceries, lon, lat, 2500);
  const parks = nearbyPois(data.parks, lon, lat, 2000);
  const outdoor = nearbyPois(data.outdoor, lon, lat, NEAR_RADIUS);
  const physio = nearbyPois(data.physio, lon, lat, 3500);
  const bike = lengthWithin(idx.bikeSegs, lon, lat, 1000);
  const trail = lengthWithin(idx.trailSegs, lon, lat, 1000);

  const within = (arr: { d: number }[], r: number) => arr.filter((x) => x.d <= r).length;

  // Strength: nearest gym + variety within 1 km.
  const gNear = gyms[0];
  const strength = gNear ? 100 * (0.75 * decay(gNear.d, 250, 2000) + 0.25 * Math.min(within(gyms, 1000) / 5, 1)) : 0;
  const strengthWhy = gNear
    ? `${label(gNear.p, 'A gym')} ${fmtD(gNear.d)} away · ${within(gyms, 1000)} within 1 km`
    : 'No gyms within 2.5 km';

  // Cardio: bike lanes + named trails within 1 km.
  const bikeScore = Math.min(bike.len / 5000, 1);
  const trailScore = Math.min(trail.len / 3000, 1);
  const cardio = 100 * (bikeShare * bikeScore + (1 - bikeShare) * trailScore);
  const cardioWhy = `${(bike.len / 1000).toFixed(1)} km of bike lanes and ${(trail.len / 1000).toFixed(1)} km of trails within 1 km`;

  // Outdoor: nearest park + courts, tracks, pools, outdoor gyms.
  const pNear = parks[0];
  const outdoorScore = 100 * (0.6 * (pNear ? decay(pNear.d, 150, 1200) : 0) + 0.4 * Math.min(outdoor.length / 8, 1));
  const outdoorWhy = pNear
    ? `${label(pNear.p, 'A park')} ${fmtD(pNear.d)} away · ${outdoor.length} courts, tracks or pools nearby`
    : `${outdoor.length} courts, tracks or pools nearby`;

  // Nutrition: nearest grocery + choice within 1.5 km.
  const fNear = groceries[0];
  const nutrition = fNear ? 100 * (0.7 * decay(fNear.d, 300, 2000) + 0.3 * Math.min(within(groceries, 1500) / 5, 1)) : 0;
  const restrictive = input.diet.filter((d) => d !== 'Low sodium').length > 0;
  const nutritionWhy = fNear
    ? `${label(fNear.p, 'A grocery')} ${fmtD(fNear.d)} away · ${within(groceries, 1500)} within 1.5 km${restrictive ? ' (more choice helps with your diet)' : ''}`
    : 'No grocery stores within 2.5 km';

  // Recovery: physio within reach.
  const rNear = physio[0];
  const recovery = rNear ? 100 * decay(rNear.d, 500, 3500) : 0;
  const recoveryWhy = missing.includes('recovery')
    ? 'No physio listings in this area’s map data yet: not counted'
    : rNear
      ? `${label(rNear.p, 'Physiotherapy')} ${fmtD(rNear.d)} away`
      : 'No physiotherapy listed within 3.5 km';

  const categories: Record<Category, CategoryScore> = {
    strength: { score: Math.round(strength), weight: w.strength, reason: strengthWhy },
    cardio: { score: Math.round(cardio), weight: w.cardio, reason: cardioWhy },
    outdoor: { score: Math.round(outdoorScore), weight: w.outdoor, reason: outdoorWhy },
    nutrition: { score: Math.round(nutrition), weight: w.nutrition, reason: nutritionWhy },
    recovery: { score: Math.round(recovery), weight: w.recovery, reason: recoveryWhy },
  };
  const total = Math.round((Object.values(categories) as CategoryScore[]).reduce((s, c) => s + c.score * c.weight, 0));

  return {
    total,
    categories,
    weighting,
    nearby: {
      gyms: within(gyms, NEAR_RADIUS) ? gyms.filter((x) => x.d <= NEAR_RADIUS).map((x) => x.p) : gyms.slice(0, 1).map((x) => x.p),
      groceries: groceries.filter((x) => x.d <= NEAR_RADIUS).map((x) => x.p).concat(fNear && fNear.d > NEAR_RADIUS ? [fNear.p] : []),
      parks: parks.filter((x) => x.d <= NEAR_RADIUS).map((x) => x.p),
      outdoor: outdoor.map((x) => x.p),
      physio: physio.filter((x) => x.d <= 2000).map((x) => x.p),
      cycleways: bike.lines,
      trails: trail.lines,
    },
  };
}

export const scoreTone = (s: number) => (s >= 75 ? 'good' : s >= 50 ? 'ok' : 'low');
