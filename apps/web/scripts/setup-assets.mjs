// Copies the MediaPipe wasm runtime into public/ and downloads the pose model,
// so the app never depends on a CDN at runtime. Runs on `npm install`.
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const wasmDst = join(root, 'public/mediapipe/wasm');
const modelDst = join(root, 'public/models/pose_landmarker_lite.task');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

mkdirSync(wasmDst, { recursive: true });
cpSync(wasmSrc, wasmDst, { recursive: true });
console.log('[fitmax] copied MediaPipe wasm');

if (!existsSync(modelDst)) {
  mkdirSync(dirname(modelDst), { recursive: true });
  try {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(modelDst, Buffer.from(await res.arrayBuffer()));
    console.log('[fitmax] downloaded pose model');
  } catch (err) {
    console.warn(`[fitmax] could not download pose model (${err.message}); the app will fetch it from Google at runtime`);
  }
}
