import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
// @ts-expect-error plain JS module shared with the Vercel function
import { handleAi } from './server/ai-core.mjs';
// @ts-expect-error plain JS module
import { handleRuview } from './server/ruview-core.mjs';

/** Serves POST /api/ai locally (dev + preview) with the key from .env, never shipped to the browser. */
function aiApi(): Plugin {
  // Must return nothing: Vite treats a returned function as a post-middleware hook.
  const mount = (server: { middlewares: { use: (path: string, fn: (req: unknown, res: unknown) => void) => void } }): void => {
    server.middlewares.use('/api/ai', (req, res) => void handleAi(req, res));
    server.middlewares.use('/api/ruview', (req, res) => void handleRuview(req, res));
  };
  return { name: 'fitmax-ai-api', configureServer: mount, configurePreviewServer: mount };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  for (const k of ['NVIDIA_API_KEY', 'NIM_VISION_MODEL', 'NIM_TEXT_MODEL', 'RUVIEW_URL', 'RUVIEW_API_TOKEN']) if (env[k]) process.env[k] = env[k];
  return {
    plugins: [react(), aiApi()],
    server: { host: true },
    preview: { host: true },
    build: { chunkSizeWarningLimit: 1200 },
    test: { environment: 'node' },
  } as never;
});
