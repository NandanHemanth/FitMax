/**
 * Keeps the placeholder sign-in and profile on the laptop (apps/web/.data/me.json), so you sign in
 * once and every browser that opens this dev server (laptop, iPhone via QR) starts signed in.
 * Demo only: no passwords, no tokens, nothing leaves the laptop.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const FILE = path.resolve(process.cwd(), '.data/me.json');

const send = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

export async function handleProfile(req, res) {
  if (req.method === 'GET') {
    try {
      return send(res, 200, JSON.parse(readFileSync(FILE, 'utf8')));
    } catch {
      return send(res, 200, {});
    }
  }
  if (req.method === 'PUT' || req.method === 'POST') {
    let raw = '';
    for await (const c of req) {
      raw += c;
      if (raw.length > 100_000) return send(res, 413, { error: 'too large' });
    }
    try {
      const body = JSON.parse(raw || '{}');
      const keep = { session: body.session ?? null, profile: body.profile ?? null };
      mkdirSync(path.dirname(FILE), { recursive: true });
      writeFileSync(FILE, JSON.stringify(keep, null, 2));
      return send(res, 200, { ok: true });
    } catch {
      return send(res, 400, { error: 'bad json' });
    }
  }
  return send(res, 405, { error: 'method not allowed' });
}
