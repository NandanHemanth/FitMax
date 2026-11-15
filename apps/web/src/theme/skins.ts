/** The six FitMax skins. Each works in light and dark mode. */
export type Skin = 'studio' | 'doodle' | 'retro' | 'glass' | 'editorial' | 'swiss';
export type Mode = 'light' | 'dark';

export const SKINS: { id: Skin; name: string; blurb: string; swatch: [string, string, string]; font: string }[] = [
  { id: 'studio', name: 'Studio', blurb: 'Quiet, modern, one accent', swatch: ['#131316', '#f4f4f5', '#ff6a2b'], font: 'var(--font)' },
  { id: 'doodle', name: 'Doodle', blurb: 'Sketchbook ink and marker', swatch: ['#fffdf5', '#1f1d1a', '#ff5d73'], font: "'Caveat', cursive" },
  { id: 'retro', name: 'Retro', blurb: '1984 desktop / green terminal', swatch: ['#050805', '#39ff88', '#e9e4d6'], font: "'VT323', monospace" },
  { id: 'glass', name: 'Glass', blurb: 'Aurora light, frosted panels', swatch: ['#0b0b1a', '#8b7bff', '#6cc6ff'], font: 'var(--font)' },
  { id: 'editorial', name: 'Editorial', blurb: 'Warm paper, serif numbers', swatch: ['#f4efe6', '#1d1a16', '#b3261e'], font: "'Fraunces Variable', serif" },
  { id: 'swiss', name: 'Swiss', blurb: 'Grid, black, white, red', swatch: ['#ffffff', '#111111', '#e30613'], font: "'Inter Variable', sans-serif" },
];

const SK = 'fitmax.skin';
const MK = 'fitmax.theme';
export const loadSkin = (): Skin => {
  try {
    const s = localStorage.getItem(SK) as Skin | null;
    return SKINS.some((x) => x.id === s) ? (s as Skin) : 'studio';
  } catch {
    return 'studio';
  }
};
export function applyTheme(skin: Skin, mode: Mode) {
  const el = document.documentElement;
  el.dataset.skin = skin;
  el.dataset.theme = mode;
  try {
    localStorage.setItem(SK, skin);
    localStorage.setItem(MK, mode);
  } catch {
    /* private mode */
  }
  const bg = getComputedStyle(el).getPropertyValue('--bg').trim();
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', bg || (mode === 'dark' ? '#09090b' : '#f7f7f8'));
}
