import { useEffect, useRef, useState } from 'react';
import { armFrom, betterSide, CurlCoach, FLAG_LABEL, type Rep, type SetSummary, type Side } from '../engine/curl';
import { idealAngle } from '../engine/ideal';
import type { Settings } from '../store';
import { drawPose, type ArmStatus } from './draw';
import { loadPose, startCamera, stopCamera } from './pose';
import { say } from './voice';

interface Props {
  settings: Settings;
  onDone: (summary: SetSummary, reps: Rep[], side: Side) => void;
  onCancel: () => void;
}

interface Hud {
  visible: boolean;
  angle: number | null;
}

export function LiveSet({ settings, onDone, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const coachRef = useRef(new CurlCoach());
  const sideRef = useRef<Side | null>(settings.side === 'auto' ? null : settings.side);
  const [status, setStatus] = useState<'loading' | 'running' | 'error'>('loading');
  const [error, setError] = useState('');
  const [reps, setReps] = useState(0);
  const [lastRep, setLastRep] = useState<Rep | null>(null);
  const [cue, setCue] = useState('');
  const [hud, setHud] = useState<Hud>({ visible: false, angle: null });
  const [side, setSide] = useState<Side | null>(sideRef.current);
  const mirrored = settings.camera === 'user';

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    let lastVideoTime = -1;
    let lastHud = 0;
    let ghostT0 = performance.now();
    let fixUntil = 0;
    const votes: Side[] = [];
    let wakeLock: { release: () => Promise<void> } | null = null;

    (async () => {
      try {
        const video = videoRef.current!;
        const [landmarker] = await Promise.all([loadPose(), startCamera(video, settings.camera).then((s) => (stream = s))]);
        if (stopped) return;
        try {
          wakeLock = await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen') ?? null;
        } catch {
          /* wake lock is optional */
        }
        setStatus('running');
        say('Turn side-on. Show me your shoulder, elbow, wrist and hip.', settings.voice);
        const canvas = canvasRef.current!;
        const ctx = canvas.getContext('2d')!;

        const loop = () => {
          if (stopped) return;
          if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
            lastVideoTime = video.currentTime;
            const now = performance.now();
            if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
            }
            const res = landmarker.detectForVideo(video, now);
            const lm = res.landmarks[0];
            let visible = false;
            let angle: number | null = null;
            if (lm) {
              if (!sideRef.current) {
                votes.push(betterSide(lm));
                if (votes.length >= 12) {
                  const left = votes.filter((v) => v === 'left').length;
                  sideRef.current = left >= votes.length / 2 ? 'left' : 'right';
                  setSide(sideRef.current);
                }
              }
              if (sideRef.current) {
                const st = coachRef.current.update(armFrom(lm, sideRef.current, now, canvas.width, canvas.height));
                visible = st.visible;
                angle = st.angle;
                if (st.rep) {
                  const rep = st.rep;
                  ghostT0 = now;
                  if (rep.flags.length) fixUntil = now + 1800;
                  setReps(rep.index);
                  setLastRep(rep);
                  setCue(st.cue ?? (rep.flags.length ? '' : 'Clean rep'));
                  const spoken = [settings.countAloud ? `${rep.index}.` : '', st.cue ?? ''].join(' ').trim();
                  say(spoken, settings.voice);
                }
              }
            }
            const armStatus: ArmStatus = !visible ? 'idle' : now < fixUntil ? 'fix' : 'good';
            const ghost = settings.ghost && visible ? idealAngle((now - ghostT0) / 1000).angle : null;
            drawPose(ctx, lm, sideRef.current, armStatus, ghost);
            if (now - lastHud > 120) {
              lastHud = now;
              setHud({ visible, angle });
            }
          }
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      } catch (e) {
        setStatus('error');
        setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stopCamera(stream);
      void wakeLock?.release().catch(() => undefined);
      window.speechSynthesis?.cancel();
    };
  }, [settings]);

  const finish = () => {
    const coach = coachRef.current;
    onDone(coach.summary(), [...coach.reps], sideRef.current ?? 'left');
  };

  const score = lastRep?.score ?? null;
  const scoreClass = score === null ? '' : score >= 85 ? 'good' : score >= 60 ? 'warn' : 'bad';

  return (
    <div className="live">
      <div className={`stage ${mirrored ? 'mirrored' : ''}`}>
        <video ref={videoRef} playsInline muted autoPlay />
        <canvas ref={canvasRef} />
      </div>

      <div className="live-top">
        <button className="chip" onClick={onCancel} aria-label="Back">
          ← Back
        </button>
        <div className="chip">{side ? (side === 'left' ? 'Left arm' : 'Right arm') : 'Finding your arm…'}</div>
      </div>

      {status === 'loading' && <div className="overlay-msg">Starting camera and pose model…</div>}
      {status === 'error' && (
        <div className="overlay-msg error">
          <strong>Camera unavailable.</strong>
          <span>{error}</span>
          <span>Open FitMax over HTTPS and allow camera access.</span>
          <button className="btn" onClick={onCancel}>
            Go back
          </button>
        </div>
      )}
      {status === 'running' && !hud.visible && (
        <div className="overlay-msg hint">Turn side-on. Keep your shoulder, elbow, wrist and hip in view.</div>
      )}

      <div className="live-hud">
        <div className="rep-count" aria-live="polite">
          <span className="n">{reps}</span>
          <span className="label">reps</span>
        </div>
        <div className="hud-right">
          <div className={`score ${scoreClass}`}>
            <div className="score-bar">
              <div style={{ width: `${score ?? 0}%` }} />
            </div>
            <span>{score === null ? 'Form score' : `Form ${score}`}</span>
          </div>
          <div className="cue">{cue}</div>
          <div className="metrics">
            <span>Elbow {hud.angle === null ? '–' : `${Math.round(hud.angle)}°`}</span>
            {lastRep && (
              <>
                <span>ROM {Math.round(lastRep.rom)}°</span>
                <span>
                  ↑{lastRep.upSec.toFixed(1)}s ↓{lastRep.downSec.toFixed(1)}s
                </span>
              </>
            )}
          </div>
          {lastRep && lastRep.flags.length > 0 && (
            <div className="flags">
              {lastRep.flags.map((f) => (
                <span key={f} className="flag">
                  {FLAG_LABEL[f]}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <button className="btn btn-primary end-set" onClick={finish} disabled={status !== 'running'}>
        End set
      </button>
    </div>
  );
}
