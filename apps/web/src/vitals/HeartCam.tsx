import { useEffect, useRef, useState } from 'react';
import { loadPose, startCamera, stopCamera } from '../ui/pose';
import { Spark } from '../ui/widgets';
import { breathFromMotion, estimate, type HrResult, type MotionSample, type Sample } from './rppg';

/**
 * Live webcam heart rate. The face is found with the pose model already bundled for the Train
 * coach (nose, eyes, ears), refreshed a few times a second; every frame the forehead and cheek
 * skin pixels are averaged, and rppg.ts turns those averages into beats per minute.
 * Video never leaves the device; only three numbers per frame are kept, for 20 s.
 */
export function HeartCam({
  onReading,
  onBreath,
  compact,
}: {
  onReading: (r: HrResult) => void;
  onBreath?: (b: ReturnType<typeof breathFromMotion>) => void;
  compact?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'starting' | 'running' | 'error'>('starting');
  const [err, setErr] = useState('');
  const [res, setRes] = useState<HrResult | null>(null);
  const cb = useRef(onReading);
  cb.current = onReading;
  const cbB = useRef(onBreath);
  cbB.current = onBreath;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let alive = true;
    const samples: Sample[] = [];
    const shoulders: MotionSample[] = [];
    let lastBreath = 0;
    const work = document.createElement('canvas');
    const ctx = work.getContext('2d', { willReadFrequently: true })!;
    let roi: { x: number; y: number; w: number; h: number }[] | null = null;
    let frame = 0;
    let lastEst = 0;
    void (async () => {
      try {
        const v = video.current!;
        stream = await startCamera(v, 'user');
        const pose = await loadPose().catch(() => null);
        if (!alive) return;
        setState('running');
        const loop = () => {
          if (!alive) return;
          raf = requestAnimationFrame(loop);
          if (v.readyState < 2) return;
          const W = 320;
          const H = Math.round((W * v.videoHeight) / v.videoWidth) || 240;
          work.width = W;
          work.height = H;
          ctx.drawImage(v, 0, 0, W, H);
          // Pose every 3rd frame: face ROI (forehead + both cheeks) and the shoulder line for breathing
          if (pose && frame % 3 === 0) {
            const lm = pose.detectForVideo(v, performance.now()).landmarks?.[0];
            if (lm && (lm[11].visibility ?? 0) > 0.6 && (lm[12].visibility ?? 0) > 0.6) {
              shoulders.push({ t: performance.now() / 1000, y: (lm[11].y + lm[12].y) / 2 });
              while (shoulders.length && shoulders[0].t < performance.now() / 1000 - 40) shoulders.shift();
            }
            if (lm && lm[0].visibility !== undefined) {
              const nose = lm[0];
              const le = lm[2];
              const re = lm[5];
              const eyeY = (le.y + re.y) / 2;
              const eyeW = Math.abs(le.x - re.x) || 0.08;
              const dy = Math.max(0.02, nose.y - eyeY);
              const cx = (le.x + re.x) / 2;
              roi = [
                { x: cx - eyeW * 0.7, y: eyeY - dy * 2.2, w: eyeW * 1.4, h: dy * 1.3 }, // forehead
                { x: le.x - eyeW * 0.05, y: eyeY + dy * 0.45, w: eyeW * 0.55, h: dy * 0.9 }, // cheek
                { x: re.x - eyeW * 0.5, y: eyeY + dy * 0.45, w: eyeW * 0.55, h: dy * 0.9 }, // cheek
              ].map((r) => (r.w < 0 ? { ...r, x: r.x + r.w, w: -r.w } : r));
            }
          }
          frame++;
          const boxes = roi ?? [{ x: 0.4, y: 0.25, w: 0.2, h: 0.12 }]; // no face found: centre-top guess
          let r = 0;
          let g = 0;
          let b = 0;
          let n = 0;
          for (const bx of boxes) {
            const x0 = Math.max(0, Math.round(bx.x * W));
            const y0 = Math.max(0, Math.round(bx.y * H));
            const w = Math.min(W - x0, Math.max(2, Math.round(bx.w * W)));
            const h = Math.min(H - y0, Math.max(2, Math.round(bx.h * H)));
            if (w <= 0 || h <= 0) continue;
            const px = ctx.getImageData(x0, y0, w, h).data;
            for (let i = 0; i < px.length; i += 4) {
              // keep skin-ish pixels only (drops hair, eyebrows, glasses glare)
              const R = px[i];
              const G = px[i + 1];
              const B = px[i + 2];
              if (R > 60 && R > G && R > B && R - Math.min(G, B) > 12 && R < 250) {
                r += R;
                g += G;
                b += B;
                n++;
              }
            }
          }
          if (n > 30) samples.push({ t: performance.now() / 1000, r: r / n, g: g / n, b: b / n });
          while (samples.length && samples[0].t < performance.now() / 1000 - 20) samples.shift();
          // draw the ROI so you can see what it's reading
          const ov = overlay.current;
          if (ov) {
            ov.width = v.clientWidth;
            ov.height = v.clientHeight;
            const o = ov.getContext('2d')!;
            o.clearRect(0, 0, ov.width, ov.height);
            o.strokeStyle = roi ? '#3ddc84' : '#ffbf3c';
            o.lineWidth = 2;
            for (const bx of boxes) o.strokeRect((1 - bx.x - bx.w) * ov.width, bx.y * ov.height, bx.w * ov.width, bx.h * ov.height); // mirrored preview
          }
          const now = performance.now();
          if (now - lastBreath > 2000) {
            lastBreath = now;
            cbB.current?.(breathFromMotion(shoulders));
          }
          if (now - lastEst > 1000) {
            lastEst = now;
            const e = estimate(samples);
            setRes(e);
            cb.current(e);
          }
        };
        loop();
      } catch (e) {
        setState('error');
        setErr(String((e as Error)?.message ?? e));
      }
    })();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      stopCamera(stream);
    };
  }, []);

  if (compact)
    return (
      <div className="heartcam-pip">
        <video ref={video} playsInline muted />
        <canvas ref={overlay} />
        <span className="pip-bpm">{state === 'error' ? 'no camera' : res?.bpm ? `${res.bpm} bpm` : '…'}</span>
      </div>
    );
  return (
    <div className="heartcam">
      <div className="heartcam-video">
        <video ref={video} playsInline muted />
        <canvas ref={overlay} />
        {state === 'starting' && <span className="heartcam-msg">Starting camera…</span>}
        {state === 'error' && <span className="heartcam-msg">{err || 'Camera blocked'}</span>}
      </div>
      <div className="heartcam-read">
        <div className="w-value num" style={{ color: 'var(--danger)' }}>
          {res?.bpm ?? '—'}
          <span className="w-unit">bpm</span>
        </div>
        <div className="w-sub">{res?.bpm ? `${Math.round(res.confidence * 100)}% sure · SNR ${res.snr.toFixed(1)} dB` : res?.why ?? 'Face the camera in even light'}</div>
        <Spark data={res?.wave ?? []} color="var(--danger)" height={46} fill={false} />
        <p className="tiny muted">Sit still, face the camera, front-lit (a window or lamp in front of you). Green boxes = the skin being read. About 10 s to lock on. Not a medical device.</p>
      </div>
    </div>
  );
}
