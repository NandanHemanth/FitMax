/**
 * Starts the laptop's sensing agent next to the dev server, so the laptop becomes the second
 * WiFi sensing link (laptop <-> hotspot) and, optionally, the Bluetooth link to the board.
 * It runs hub/uno-q/rssi_sense.py in "agent" mode, pushing samples to the hub at RUVIEW_URL.
 * Off with FITMAX_AGENT=0. Needs python3 and `iw` (sudo apt install iw).
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
export const AGENT_SCRIPT = path.resolve(here, '../../../hub/uno-q/rssi_sense.py');

let child = null;
export const agentStatus = { running: false, note: 'not started' };

export function startAgent(log = console.log) {
  const hub = process.env.RUVIEW_URL;
  const token = process.env.RUVIEW_API_TOKEN;
  if (process.env.FITMAX_AGENT === '0') return (agentStatus.note = 'disabled (FITMAX_AGENT=0)');
  if (!hub || !token) return (agentStatus.note = 'RUVIEW_URL / RUVIEW_API_TOKEN not set');
  if (!existsSync(AGENT_SCRIPT)) return (agentStatus.note = 'hub/uno-q/rssi_sense.py not found');
  if (spawnSync('python3', ['--version']).status !== 0) return (agentStatus.note = 'python3 not found');
  if (spawnSync('sh', ['-c', 'command -v iw']).status !== 0) {
    log('[fitmax-agent] `iw` not found: sudo apt install iw  (laptop link off)');
    return (agentStatus.note = 'iw not installed');
  }
  const args = [AGENT_SCRIPT, 'agent', '--hub', hub, '--token', token, '--name', process.env.FITMAX_AGENT_NAME || 'laptop'];
  if (process.env.FITMAX_BLE_PEER) args.push('--ble-peer', process.env.FITMAX_BLE_PEER);
  child = spawn('python3', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  agentStatus.running = true;
  agentStatus.note = 'running';
  const pipe = (s) => s.on('data', (d) => String(d).trim().split('\n').forEach((l) => log(`[fitmax-agent] ${l.replaceAll(token, '***')}`)));
  pipe(child.stdout);
  pipe(child.stderr);
  child.on('exit', (code) => {
    agentStatus.running = false;
    agentStatus.note = `exited (${code})`;
  });
  const stop = () => child && !child.killed && child.kill();
  process.once('exit', stop);
  process.once('SIGINT', () => (stop(), process.exit(0)));
  process.once('SIGTERM', () => (stop(), process.exit(0)));
  return agentStatus.note;
}
