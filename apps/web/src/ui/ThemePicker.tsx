import { useApp } from '../state/app';
import { SKINS } from '../theme/skins';
import { Sheet } from './widgets';

/** Pick a skin and light/dark. Each card previews the skin in its own colours and type. */
export function ThemePicker({ onClose }: { onClose: () => void }) {
  const { skin, setSkin, theme, setMode } = useApp();
  return (
    <Sheet title="Look" onClose={onClose}>
      <div className="segmented" style={{ marginBottom: 14 }}>
        {(['light', 'dark'] as const).map((m) => (
          <button key={m} className={theme === m ? 'on' : ''} onClick={() => setMode(m)}>
            {m === 'light' ? 'Light' : 'Dark'}
          </button>
        ))}
      </div>
      <div className="skin-grid">
        {SKINS.map((s) => (
          <button key={s.id} className={`skin-card ${skin === s.id ? 'on' : ''}`} onClick={() => setSkin(s.id)} aria-pressed={skin === s.id}>
            <span className="skin-prev" style={{ background: s.swatch[0], color: s.swatch[1], fontFamily: s.font }}>
              <b>12</b>
              <i style={{ background: s.swatch[2] }} />
            </span>
            <strong>{s.name}</strong>
            <small>{s.blurb}</small>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
