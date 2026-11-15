/**
 * "Is my phone home?" for the Monitor's Only-me mode.
 *   GET /api/me → { configured, home, lastSeen }
 * Checks the phone at ME_PHONE_IP (give it a fixed IP in your router) two ways, from this laptop:
 *   1. a TCP connect to 62078, the port iPhones listen on over WiFi (a refusal also proves it's there);
 *   2. the laptop's neighbour (ARP) table, if `ip` is available (Linux).
 * iPhones sleep their WiFi, so "home" means seen within ME_GRACE_MIN minutes (default 15).
 */
import { execFile } from 'node:child_process';
import net from 'node:net';

let lastSeen = 0;
let lastCheck = 0;

const tcpProbe = (ip, port = 62078, ms = 1500) =>
  new Promise((resolve) => {
    const s = net.connect({ host: ip, port });
    const done = (ok) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(ms, () => done(false));
    s.on('connect', () => done(true));
    s.on('error', (e) => done(e.code === 'ECONNREFUSED')); // refused = the device answered
  });

const arpProbe = (ip, mac) =>
  new Promise((resolve) => {
    execFile('ip', ['neigh', 'show', ip], { timeout: 1500 }, (err, out) => {
      if (err || !out) return resolve(false);
      const line = out.toLowerCase();
      if (mac && !line.includes(mac.toLowerCase())) return resolve(false);
      resolve(/reachable|delay|probe/.test(line));
    });
  });

export async function handlePresence(req, res) {
  const ip = process.env.ME_PHONE_IP || '';
  const mac = process.env.ME_PHONE_MAC || '';
  const grace = (Number(process.env.ME_GRACE_MIN) || 15) * 60_000;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  if (!ip || !/^[\d.]+$/.test(ip)) return res.end(JSON.stringify({ configured: false, home: null, lastSeen: null }));
  if (Date.now() - lastCheck > 10_000) {
    lastCheck = Date.now();
    const [tcp, arp] = await Promise.all([tcpProbe(ip), arpProbe(ip, mac)]);
    if (tcp || arp) lastSeen = Date.now();
  }
  res.end(JSON.stringify({ configured: true, home: lastSeen > 0 && Date.now() - lastSeen < grace, lastSeen: lastSeen || null }));
}
