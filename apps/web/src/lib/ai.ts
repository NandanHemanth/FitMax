import type { Profile, Targets } from '../state/profile';

export type AiTask = 'meal' | 'fridge' | 'shopping';

export interface MealResult {
  items: { name: string; grams: number; kcal: number; protein: number; carbs: number; fat: number }[];
  notes?: string;
}
export interface FridgeResult {
  ingredients: string[];
  recipes: { title: string; minutes: number; kcal: number; protein: number; carbs: number; fat: number; uses: string[]; missing: string[]; steps: string[] }[];
}
export interface ShoppingResult {
  sections: { title: string; items: { name: string; qty: string; why: string }[] }[];
  tip?: string;
}

export class AiUnavailable extends Error {}

let configured: boolean | null = null;
export async function aiConfigured(): Promise<boolean> {
  if (configured !== null) return configured;
  try {
    const r = await fetch('/api/ai');
    configured = r.ok && (await r.json()).configured === true;
  } catch {
    configured = false;
  }
  return configured;
}

export async function askAi<T>(task: AiTask, payload: { image?: string; profile: Profile; targets: Targets; context?: string }): Promise<T> {
  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 503 || res.status === 404) throw new AiUnavailable(data.error ?? 'AI is not configured');
  if (!res.ok) throw new Error(data.error ?? `AI request failed (${res.status})`);
  return data.result as T;
}

/** Reads an image file and downsizes it to a JPEG data URL (max 768 px) to keep requests small. */
export async function fileToDataUrl(file: File, max = 768): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.82);
}
