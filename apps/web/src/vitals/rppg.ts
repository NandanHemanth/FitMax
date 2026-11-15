/**
 * Heart rate from a webcam (remote photoplethysmography, rPPG).
 * Each heartbeat pushes blood into the skin of the face, which changes how much green light it
 * absorbs by a fraction of a percent. Averaging the skin pixels every frame gives a tiny pulse
 * wave. This file turns those per-frame RGB averages into beats per minute with the POS method
 * (Plane-Orthogonal-to-Skin; Wang, den Brinker, Stuijk & de Haan, IEEE TBME 2017):
 *   1. resample to an even 30 Hz;
 *   2. in sliding 1.6 s windows, normalise each colour by its mean and project onto the plane
 *      orthogonal to skin tone (cancels lighting changes and most motion), overlap-add;
 *   3. detrend + band-limit to 42-180 bpm, find the strongest frequency (with sub-bin refinement);
 *   4. confidence = how much the peak stands out from the rest of the band (SNR).
 * Pure functions, no DOM: unit-tested on synthetic video signals.
 */

export interface Sample { t: number; r: number; g: number; b: number } // t in seconds

export const FS = 30;
const LO = 0.7; // Hz = 42 bpm
const HI = 3.0; // Hz = 180 bpm

/** Linear resample onto an even grid at `fs` Hz. */
export function resample(s: Sample[], fs = FS): Sample[] {
  if (s.length < 2) return [];
  const out: Sample[] = [];
  let j = 0;
  for (let t = s[0].t; t <= s[s.length - 1].t; t += 1 / fs) {
    while (j < s.length - 2 && s[j + 1].t < t) j++;
    const a = s[j];
    const b = s[j + 1];
    const u = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
    out.push({ t, r: a.r + (b.r - a.r) * u, g: a.g + (b.g - a.g) * u, b: a.b + (b.b - a.b) * u });
  }
  return out;
}

/** POS pulse signal (one value per input sample). */
export function pos(s: Sample[], fs = FS): number[] {
  const n = s.length;
  const L = Math.round(1.6 * fs);
  const h = new Array<number>(n).fill(0);
  if (n < L) return h;
  for (let i = 0; i + L <= n; i++) {
    let mr = 0;
    let mg = 0;
    let mb = 0;
    for (let k = i; k < i + L; k++) {
      mr += s[k].r;
      mg += s[k].g;
      mb += s[k].b;
    }
    mr /= L;
    mg /= L;
    mb /= L;
    if (mr <= 0 || mg <= 0 || mb <= 0) continue;
    const s1: number[] = [];
    const s2: number[] = [];
    for (let k = i; k < i + L; k++) {
      const r = s[k].r / mr;
      const g = s[k].g / mg;
      const b = s[k].b / mb;
      s1.push(g - b);
      s2.push(-2 * r + g + b);
    }
    const sd = (x: number[]) => {
      const m = x.reduce((a, b) => a + b, 0) / x.length;
      return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / x.length);
    };
    const alpha = sd(s1) / (sd(s2) || 1e-9);
    const p = s1.map((v, k) => v + alpha * s2[k]);
    const pm = p.reduce((a, b) => a + b, 0) / L;
    for (let k = 0; k < L; k++) h[i + k] += p[k] - pm;
  }
  return h;
}

/** Remove slow drift with a centred moving average (~1 s) and smooth with a short one. */
export function bandish(x: number[], fs = FS): number[] {
  const ma = (v: number[], w: number) => {
    const out = new Array<number>(v.length);
    let acc = 0;
    const half = Math.floor(w / 2);
    const pre: number[] = [0];
    for (const a of v) pre.push((acc += a));
    for (let i = 0; i < v.length; i++) {
      const a = Math.max(0, i - half);
      const b = Math.min(v.length, i + half + 1);
      out[i] = (pre[b] - pre[a]) / (b - a);
    }
    return out;
  };
  const trend = ma(x, Math.round(fs * 1.0));
  const hp = x.map((v, i) => v - trend[i]);
  return ma(hp, 3);
}

/** Strongest frequency in [LO, HI] Hz with a Hann window; returns bpm and SNR. */
export function peakBpm(x: number[], fs = FS): { bpm: number; snr: number; spectrum: [number, number][] } {
  const n = x.length;
  const w = x.map((v, i) => v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))));
  const spec: [number, number][] = [];
  for (let f = LO; f <= HI + 1e-9; f += 1 / 120) {
    let c = 0;
    let s = 0;
    const k = (2 * Math.PI * f) / fs;
    for (let i = 0; i < n; i++) {
      c += w[i] * Math.cos(k * i);
      s += w[i] * Math.sin(k * i);
    }
    spec.push([f, c * c + s * s]);
  }
  let bi = 0;
  for (let i = 1; i < spec.length; i++) if (spec[i][1] > spec[bi][1]) bi = i;
  // parabolic refinement between neighbouring bins
  let f = spec[bi][0];
  if (bi > 0 && bi < spec.length - 1) {
    const [a, b, c] = [spec[bi - 1][1], spec[bi][1], spec[bi + 1][1]];
    const d = (a - c) / (2 * (a - 2 * b + c) || 1e-12);
    f += Math.max(-0.5, Math.min(0.5, d)) * (1 / 120);
  }
  // SNR: power within ±0.1 Hz of the peak (and its harmonic) vs. the rest of the band
  let sig = 0;
  let noise = 0;
  for (const [ff, p] of spec) {
    if (Math.abs(ff - f) <= 0.1 || Math.abs(ff - 2 * f) <= 0.1) sig += p;
    else noise += p;
  }
  return { bpm: f * 60, snr: 10 * Math.log10(sig / (noise || 1e-12)), spectrum: spec };
}

export interface HrResult {
  bpm: number | null;
  confidence: number; // 0..1
  snr: number;
  wave: number[]; // last few seconds of the pulse wave, for display
  why: string | null;
}

/** Heart rate from the last `seconds` of samples. Needs ~8 s of steady face video. */
export function estimate(samples: Sample[], seconds = 12): HrResult {
  const now = samples.length ? samples[samples.length - 1].t : 0;
  const win = samples.filter((s) => s.t >= now - seconds);
  if (win.length < 2 || now - win[0].t < 7) return { bpm: null, confidence: 0, snr: -99, wave: [], why: 'hold still, measuring…' };
  const even = resample(win);
  const fps = win.length / (now - win[0].t);
  if (fps < 12) return { bpm: null, confidence: 0, snr: -99, wave: [], why: 'camera too slow (needs 12+ fps)' };
  const p = bandish(pos(even));
  const { bpm, snr } = peakBpm(p);
  const confidence = Math.max(0, Math.min(1, (snr + 6) / 10)); // -6 dB → 0, +4 dB → 1
  return {
    bpm: confidence >= 0.35 ? Math.round(bpm) : null,
    confidence,
    snr,
    wave: p.slice(-FS * 6),
    why: confidence >= 0.35 ? null : 'signal too weak: face the light, keep still',
  };
}

// ---------------------------------------------------------------- breathing from the camera
export interface MotionSample { t: number; y: number } // shoulder-line height (normalised image y)

/**
 * Breathing rate from how the shoulders rise and fall (seen by the pose model). Sitting still
 * facing the camera, each breath lifts the shoulders a few millimetres: a slow 9-36 per minute
 * wave in their mean height. Resampled to 5 Hz over the last 30 s, detrended, then the
 * strongest frequency in 0.15-0.6 Hz with a peak-to-median confidence.
 */
export function breathFromMotion(s: MotionSample[], seconds = 30): { bpm: number | null; confidence: number; why: string | null } {
  const now = s.length ? s[s.length - 1].t : 0;
  const win = s.filter((x) => x.t >= now - seconds);
  if (win.length < 20 || now - win[0].t < 15) return { bpm: null, confidence: 0, why: 'sit still facing the camera, ~15 s' };
  const fs = 5;
  const even: number[] = [];
  let j = 0;
  for (let t = win[0].t; t <= now; t += 1 / fs) {
    while (j < win.length - 2 && win[j + 1].t < t) j++;
    const a = win[j];
    const b = win[Math.min(j + 1, win.length - 1)];
    const u = b.t === a.t ? 0 : Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t)));
    even.push(a.y + (b.y - a.y) * u);
  }
  const n = even.length;
  const m = even.reduce((x, y) => x + y, 0) / n;
  const tm = (n - 1) / 2;
  let sxy = 0;
  let sxx = 0;
  even.forEach((v, i) => {
    sxy += (i - tm) * (v - m);
    sxx += (i - tm) ** 2;
  });
  const slope = sxx ? sxy / sxx : 0;
  const x = even.map((v, i) => (v - m - slope * (i - tm)) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))));
  const spec: [number, number][] = [];
  for (let f = 0.15; f <= 0.6 + 1e-9; f += 0.005) {
    let c = 0;
    let sn = 0;
    const k = (2 * Math.PI * f) / fs;
    for (let i = 0; i < n; i++) {
      c += x[i] * Math.cos(k * i);
      sn += x[i] * Math.sin(k * i);
    }
    spec.push([f, c * c + sn * sn]);
  }
  let bi = 0;
  for (let i = 1; i < spec.length; i++) if (spec[i][1] > spec[bi][1]) bi = i;
  const sorted = spec.map((p) => p[1]).sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)] || 1e-12;
  const prom = spec[bi][1] / med;
  let conf = Math.max(0, Math.min(0.95, (Math.log10(prom) - 0.6) / 1.2));
  if (bi < 3 || bi > spec.length - 4) conf = Math.min(conf, 0.2); // band edge = drift, not breath
  const bpm = spec[bi][0] * 60;
  return conf >= 0.4 ? { bpm: Math.round(bpm), confidence: conf, why: null } : { bpm: null, confidence: conf, why: 'no clear breathing rhythm: sit still, shoulders in view' };
}
