/**
 * The real Matterport tour, with your FitMax gym equipment pinned inside it.
 * Uses the Matterport SDK for Embeds (needs MATTERPORT_SDK_KEY; localhost works for development).
 * Each piece is pinned on the floor in front of the camera: walk to the room you want, press "Pin here".
 * Without a key it falls back to the plain tour.
 */
import { useEffect, useRef, useState } from 'react';
import { setupSdk, type MpSdk } from '@matterport/sdk';

export interface TourGear {
  name: string;
  w: number;
  d: number;
  color: string;
  clearance?: string;
}

const hex = (c: string) => {
  const n = parseInt(c.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
};

export function TourStage({ model, sdkKey, gear, onState }: { model: string; sdkKey: string | null; gear: TourGear[]; onState: (s: 'loading' | 'ready' | 'slow' | 'plain', why?: string) => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const sdk = useRef<MpSdk | null>(null);
  const tags = useRef<string[]>([]);
  const [ready, setReady] = useState(false);
  const [pinned, setPinned] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const cbState = useRef(onState);
  cbState.current = onState;

  useEffect(() => {
    if (!sdkKey || !frame.current) return;
    let off = false;
    setReady(false);
    tags.current = [];
    setPinned(0);
    cbState.current('loading');
    const slow = setTimeout(() => !off && !sdk.current && cbState.current('slow'), 25_000);
    setupSdk(sdkKey, { iframe: frame.current, space: model, iframeQueryParams: { qs: 1, play: 1, brand: 0, help: 0 } })
      .then(async (s) => {
        if (off) return;
        sdk.current = s;
        await s.App.state.waitUntil((st) => st.phase === s.App.Phase.PLAYING);
        if (off) return;
        setReady(true);
        cbState.current('ready');
      })
      .catch((e: unknown) => {
        if (off) return;
        console.warn('[tour] SDK did not connect:', e);
        cbState.current('plain', 'The Matterport SDK key was refused for this site, so equipment pins are off. Add this address as an SDK domain in Matterport.');
      });
    return () => {
      off = true;
      clearTimeout(slow);
      sdk.current = null;
    };
  }, [model, sdkKey]);

  /** Pin every piece on the floor across the middle of the current view. */
  const pinHere = async () => {
    const s = sdk.current;
    const f = frame.current;
    if (!s || !f || !gear.length) return;
    setMsg(null);
    if (tags.current.length) await s.Tag.remove(...tags.current).catch(() => {});
    tags.current = [];
    const { width, height } = f.getBoundingClientRect();
    const descs = [];
    for (let i = 0; i < gear.length; i++) {
      const g = gear[i];
      const fx = gear.length === 1 ? 0.5 : 0.2 + (0.6 * i) / (gear.length - 1);
      const row = gear.length > 4 && i % 2 ? 0.66 : 0.8; // two rows when there's a lot
      const hit = await s.Renderer.getWorldPositionData({ x: width * fx, y: height * row }).catch(() => null);
      if (!hit?.position) continue;
      descs.push({
        label: g.name,
        description: `FitMax: ${g.w.toFixed(1)} × ${g.d.toFixed(1)} m footprint${g.clearance ? `, ${g.clearance}` : ''}`,
        anchorPosition: hit.position,
        stemVector: { x: 0, y: 0.5 + (i % 3) * 0.15, z: 0 },
        color: hex(g.color),
      });
    }
    if (!descs.length) {
      setMsg('No floor in view. Look down at an open floor area, then try again.');
      return;
    }
    tags.current = await s.Tag.add(...descs);
    setPinned(tags.current.length);
  };

  const clear = async () => {
    if (sdk.current && tags.current.length) await sdk.current.Tag.remove(...tags.current).catch(() => {});
    tags.current = [];
    setPinned(0);
  };

  if (!sdkKey)
    return (
      <iframe
        className="mp-tour"
        title="Matterport tour"
        src={`https://my.matterport.com/show/?m=${model}&play=1&qs=1&brand=0&help=0`}
        allow="xr-spatial-tracking; fullscreen"
        allowFullScreen
        onLoad={() => cbState.current('plain', 'Add MATTERPORT_SDK_KEY to .env to pin your equipment inside the tour.')}
      />
    );
  return (
    <>
      <iframe ref={frame} className="mp-tour" title="Matterport tour" allow="xr-spatial-tracking; fullscreen" allowFullScreen />
      {ready && (
        <div className="mp-bar">
          <button className="btn btn-primary" onClick={() => void pinHere()} disabled={!gear.length}>
            {pinned ? 'Move pins here' : `Pin ${gear.length} piece${gear.length === 1 ? '' : 's'} here`}
          </button>
          {pinned > 0 && (
            <button className="btn" onClick={() => void clear()}>
              Clear
            </button>
          )}
          <span className="tiny">{msg ?? (gear.length ? 'Walk to the room, look at open floor, then pin.' : 'Add gym equipment in the designer first.')}</span>
        </div>
      )}
    </>
  );
}
