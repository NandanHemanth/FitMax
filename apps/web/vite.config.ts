import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
// @ts-expect-error plain JS module shared with the Vercel function
import { handleAi } from './server/ai-core.mjs';
// @ts-expect-error plain JS module
import { handleRuview } from './server/ruview-core.mjs';
// @ts-expect-error plain JS module
import { handleVexcel } from './server/vexcel-core.mjs';
// @ts-expect-error plain JS module
import { handlePresence } from './server/presence-core.mjs';
// @ts-expect-error plain JS module
import { handleMatterport } from './server/matterport-core.mjs';
// @ts-expect-error plain JS module
import { startAgent, agentStatus } from './server/agent.mjs';
// @ts-expect-error plain JS module
import { handleProfile } from './server/profile-core.mjs';

/** Serves POST /api/ai locally (dev + preview) with the key from .env, never shipped to the browser. */
function aiApi(): Plugin {
  // Must return nothing: Vite treats a returned function as a post-middleware hook.
  const mount = (server: { middlewares: { use: (path: string, fn: (req: unknown, res: unknown) => void) => void } }): void => {
    server.middlewares.use('/api/ai', (req, res) => void handleAi(req, res));
    server.middlewares.use('/api/ruview', (req, res) => void handleRuview(req, res));
    server.middlewares.use('/api/vexcel', (req, res) => void handleVexcel(req, res));
    server.middlewares.use('/api/me', (req, res) => void handlePresence(req, res));
    server.middlewares.use('/api/matterport', (req, res) => void handleMatterport(req, res));
    server.middlewares.use('/api/profile', (req, res) => void handleProfile(req, res));
    server.middlewares.use('/api/agent', (_req, res) => {
      const r = res as { setHeader: (k: string, v: string) => void; end: (s: string) => void };
      r.setHeader('Content-Type', 'application/json');
      r.end(JSON.stringify(agentStatus));
    });
  };
  return {
    name: 'fitmax-ai-api',
    configureServer: (server) => {
      mount(server);
      startAgent((l: string) => server.config.logger.info(l));
    },
    configurePreviewServer: mount,
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  for (const k of ['NVIDIA_API_KEY', 'NIM_VISION_MODEL', 'NIM_TEXT_MODEL', 'RUVIEW_URL', 'RUVIEW_API_TOKEN', 'VEXCEL_USERNAME', 'VEXCEL_PASSWORD', 'VEXCEL_TOKEN', 'VEXCEL_API_KEY', 'VEXCEL_BASE_URL', 'MATTERPORT_SDK_KEY', 'MATTERPORT_TOKEN_ID', 'MATTERPORT_TOKEN_SECRET', 'MATTERPORT_API_KEY', 'MATTERPORT_API_TOKEN', 'ME_PHONE_IP', 'ME_PHONE_MAC', 'ME_GRACE_MIN', 'FITMAX_AGENT', 'FITMAX_AGENT_NAME', 'FITMAX_BLE_PEER']) if (env[k]) process.env[k] = env[k];
  return {
    plugins: [react(), aiApi()],
    server: { host: true },
    preview: { host: true },
    build: { chunkSizeWarningLimit: 1200 },
    test: { environment: 'node' },
  } as never;
});
