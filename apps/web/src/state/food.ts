/** Food log (per day) and Open Food Facts lookups. */
import { isoDay } from './health';

export interface FoodItem {
  id: string;
  name: string;
  grams: number | null;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  source: 'barcode' | 'photo' | 'search' | 'manual' | 'recipe';
  at: string;
  meta?: { brand?: string; nutriscore?: string; nova?: number; warnings?: string[]; image?: string };
}

const KEY = 'fitmax.food';
type Log = Record<string, FoodItem[]>;

function readLog(): Log {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Log;
  } catch {
    return {};
  }
}
function writeLog(log: Log) {
  try {
    localStorage.setItem(KEY, JSON.stringify(log));
  } catch {
    /* ignore */
  }
}

export const foodsOn = (day = isoDay(new Date())) => readLog()[day] ?? [];
export function addFood(item: Omit<FoodItem, 'id' | 'at'>, day = isoDay(new Date())): FoodItem {
  const log = readLog();
  const full: FoodItem = { ...item, id: crypto.randomUUID?.() ?? String(Date.now() + Math.random()), at: new Date().toISOString() };
  log[day] = [...(log[day] ?? []), full];
  writeLog(log);
  return full;
}
export function removeFood(id: string, day = isoDay(new Date())) {
  const log = readLog();
  log[day] = (log[day] ?? []).filter((f) => f.id !== id);
  writeLog(log);
}
export function totals(items: FoodItem[]) {
  return items.reduce(
    (t, f) => ({ kcal: t.kcal + f.kcal, protein: t.protein + f.protein, carbs: t.carbs + f.carbs, fat: t.fat + f.fat }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

// ---------------- Open Food Facts ----------------
export interface OffProduct {
  code: string;
  name: string;
  brand?: string;
  image?: string;
  servingG: number | null;
  per100: { kcal: number; protein: number; carbs: number; fat: number; sugar?: number; salt?: number; fiber?: number };
  nutriscore?: string;
  nova?: number;
  allergens: string[];
  analysis: string[];
  labels: string[];
}

const FIELDS =
  'code,product_name,brands,image_front_small_url,serving_quantity,nutriments,nutriscore_grade,nova_group,allergens_tags,ingredients_analysis_tags,labels_tags';

function toProduct(p: Record<string, unknown>): OffProduct | null {
  const n = (p.nutriments ?? {}) as Record<string, number>;
  const name = (p.product_name as string) || '';
  if (!name) return null;
  const kcal = n['energy-kcal_100g'] ?? (n['energy_100g'] ? n['energy_100g'] / 4.184 : 0);
  return {
    code: String(p.code ?? ''),
    name,
    brand: (p.brands as string)?.split(',')[0],
    image: p.image_front_small_url as string | undefined,
    servingG: Number(p.serving_quantity) || null,
    per100: {
      kcal: Math.round(kcal),
      protein: n.proteins_100g ?? 0,
      carbs: n.carbohydrates_100g ?? 0,
      fat: n.fat_100g ?? 0,
      sugar: n.sugars_100g,
      salt: n.salt_100g,
      fiber: n.fiber_100g,
    },
    nutriscore: (p.nutriscore_grade as string) || undefined,
    nova: Number(p.nova_group) || undefined,
    allergens: (p.allergens_tags as string[]) ?? [],
    analysis: (p.ingredients_analysis_tags as string[]) ?? [],
    labels: (p.labels_tags as string[]) ?? [],
  };
}

export async function lookupBarcode(code: string): Promise<OffProduct | null> {
  const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${FIELDS}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { status: number; product?: Record<string, unknown> };
  return data.status === 1 && data.product ? toProduct({ code, ...data.product }) : null;
}

export async function searchFoods(q: string): Promise<OffProduct[]> {
  const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=12&fields=${FIELDS}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = (await res.json()) as { products?: Record<string, unknown>[] };
  return (data.products ?? []).map(toProduct).filter((p): p is OffProduct => !!p && p.per100.kcal > 0);
}

/** Flags conflicts between a product and the user's dietary restrictions. */
export function dietWarnings(p: OffProduct, diet: string[]): string[] {
  const w: string[] = [];
  const has = (arr: string[], tag: string) => arr.includes(tag);
  if (diet.includes('Vegan') && has(p.analysis, 'en:non-vegan')) w.push('Not vegan');
  if (diet.includes('Vegan') && has(p.analysis, 'en:maybe-vegan')) w.push('May not be vegan');
  if (diet.includes('Vegetarian') && has(p.analysis, 'en:non-vegetarian')) w.push('Not vegetarian');
  if (diet.includes('Gluten-free') && has(p.allergens, 'en:gluten')) w.push('Contains gluten');
  if (diet.includes('Lactose-free') && has(p.allergens, 'en:milk')) w.push('Contains milk');
  if (diet.includes('Nut allergy') && (has(p.allergens, 'en:nuts') || has(p.allergens, 'en:peanuts'))) w.push('Contains nuts');
  if (diet.includes('Pescatarian') && has(p.analysis, 'en:non-vegetarian') && !has(p.allergens, 'en:fish')) w.push('May contain meat');
  if (diet.includes('Halal') && !p.labels.some((l) => l.includes('halal'))) w.push('Not labelled halal');
  if (diet.includes('Kosher') && !p.labels.some((l) => l.includes('kosher'))) w.push('Not labelled kosher');
  if (diet.includes('Low sodium') && (p.per100.salt ?? 0) > 1.5) w.push('High salt');
  if (diet.includes('Keto / low carb') && p.per100.carbs > 15) w.push('High carb');
  return w;
}

export function portion(p: OffProduct, grams: number) {
  const f = grams / 100;
  return {
    kcal: Math.round(p.per100.kcal * f),
    protein: Math.round(p.per100.protein * f * 10) / 10,
    carbs: Math.round(p.per100.carbs * f * 10) / 10,
    fat: Math.round(p.per100.fat * f * 10) / 10,
  };
}
