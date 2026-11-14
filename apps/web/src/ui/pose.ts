import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

const LOCAL_MODEL = '/models/pose_landmarker_lite.task';
const REMOTE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

let cached: Promise<PoseLandmarker> | null = null;

/** Loads MediaPipe Pose Landmarker once (GPU first, CPU fallback). Runs fully on device. */
export function loadPose(): Promise<PoseLandmarker> {
  if (!cached) {
    cached = (async () => {
      const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
      const modelAssetPath = (await fetch(LOCAL_MODEL, { method: 'HEAD' }).then((r) => r.ok).catch(() => false))
        ? LOCAL_MODEL
        : REMOTE_MODEL;
      const make = (delegate: 'GPU' | 'CPU') =>
        PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath, delegate },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      try {
        return await make('GPU');
      } catch {
        return await make('CPU');
      }
    })();
    cached.catch(() => {
      cached = null;
    });
  }
  return cached;
}

export type Facing = 'user' | 'environment';

export async function startCamera(video: HTMLVideoElement, facing: Facing): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera needs HTTPS (or localhost) and a browser that supports it.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
  });
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  return stream;
}

export function stopCamera(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}

export const POSE_CONNECTIONS = PoseLandmarker.POSE_CONNECTIONS;
