/**
 * Server-side proxy for Vexcel aerial imagery (API 2.0). Credentials live only in .env.
 *   GET /api/vexcel/config                         → { configured }
 *   GET /api/vexcel/ortho?lat=..&lng=..&size=60     → PNG orthophoto centred on the point, size×size metres
 *   GET /api/vexcel/check                           → { configured, ok, status, layer } without exposing the key
 * Auth: VEXCEL_API_KEY or VEXCEL_TOKEN (sent as `token`), or VEXCEL_USERNAME + VEXCEL_PASSWORD (login).
 * Calls are the ones used in Vexcel's own API 2.0 samples (gicapps.azurewebsites.net/static):
 *   POST https://api.vexcelgroup.com/v2/auth/login  (username, password) → { token }   (tokens last 24 h)
 *   GET  https://api.vexcelgroup.com/v2/ortho/extract?layer=urban&wkt=POINT(lon lat)&srid=4326&bands=rgb
 *        &zoom=20&bbox-dimensions=W,H&image-format=png&token=…
 */
const BASE = () => (process.env.VEXCEL_BASE_URL || 'https://api.vexcelgroup.com/v2').replace(/\/+$/, '');
const LAYERS = ['urban', 'wide-area'];

let token = null; // { value, expires }
const cache = new Map(); // key → Buffer (small, per dev session)

const cfg = () => ({
  user: process.env.VEXCEL_USERNAME || '',
  pass: process.env.VEXCEL_PASSWORD || '',
  // A sponsor-issued API key is a long-lived token: API 2.0 takes it as the `token` parameter
  fixed: process.env.VEXCEL_TOKEN || process.env.VEXCEL_API_KEY || '',
});
const configured = () => {
  const c = cfg();
  return Boolean(c.fixed || (c.user && c.pass));
};

async function getToken() {
  const c = cfg();
  if (c.fixed) return c.fixed;
  if (token && token.expires > Date.now()) return token.value;
  const body = new URLSearchParams({ username: c.user, password: c.pass });
  const r = await fetch(`${BASE()}/auth/login`, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(10_000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.token) throw Object.assign(new Error('Vexcel login failed'), { status: 401 });
  token = { value: j.token, expires: Date.now() + 23 * 3600_000 };
  return token.value;
}

function json(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/** Tries each layer; returns the image, or the last HTTP status and a short reason (never the key). */
async function fetchOrtho(lat, lng, size) {
  let tok = await getToken();
  let last = { status: 404, reason: 'no coverage' };
  for (const layer of LAYERS) {
    const q = new URLSearchParams({
      layer,
      wkt: `POINT(${lng} ${lat})`,
      srid: '4326',
      bands: 'rgb',
      zoom: layer === 'urban' ? '20' : '19',
      'bbox-dimensions': `${size},${size}`,
      'image-format': 'png',
      token: tok,
    });
    let r = await fetch(`${BASE()}/ortho/extract?${q}`, { signal: AbortSignal.timeout(20_000) });
    if (r.status === 401 && !cfg().fixed) {
      token = null; // expired: log in again once
      tok = await getToken();
      q.set('token', tok);
      r = await fetch(`${BASE()}/ortho/extract?${q}`, { signal: AbortSignal.timeout(20_000) });
    }
    const type = r.headers.get('content-type') || '';
    if (r.ok && type.startsWith('image/')) return { buf: Buffer.from(await r.arrayBuffer()), layer };
    const text = type.includes('json') || type.includes('text') ? (await r.text()).slice(0, 160) : type;
    last = { status: r.status, reason: text.split(tok).join('***') };
  }
  return last;
}

export async function handleVexcel(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'read-only' });
  const url = new URL(req.url || '/', 'http://x');
  const path = url.pathname.replace(/^\/+|\/+$/g, '');
  if (path === '' || path === 'config') return json(res, 200, { configured: configured() });
  if (!configured()) return json(res, 503, { error: 'Set VEXCEL_API_KEY (or VEXCEL_USERNAME + VEXCEL_PASSWORD) in .env', configured: false });

  if (path === 'check') {
    // Houston test point (inside the CoStar track's area)
    try {
      const r = await fetchOrtho(29.72538, -95.40294, 40);
      return json(res, 200, r.buf ? { configured: true, ok: true, layer: r.layer, bytes: r.buf.length } : { configured: true, ok: false, status: r.status, reason: r.reason });
    } catch (e) {
      return json(res, 200, { configured: true, ok: false, reason: String(e?.message || e) });
    }
  }
  if (path !== 'ortho') return json(res, 404, { error: 'not found' });

  const lat = Number(url.searchParams.get('lat'));
  const lng = Number(url.searchParams.get('lng'));
  const size = Math.min(200, Math.max(20, Number(url.searchParams.get('size')) || 60));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return json(res, 400, { error: 'bad lat/lng' });

  const key = `${lat.toFixed(6)},${lng.toFixed(6)},${size}`;
  const send = (buf) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.end(buf);
  };
  if (cache.has(key)) return send(cache.get(key));
  try {
    const r = await fetchOrtho(lat, lng, size);
    if (!r.buf) return json(res, r.status === 401 || r.status === 403 ? r.status : 404, { error: r.status === 404 ? 'No Vexcel ortho coverage here' : `Vexcel ${r.status}`, reason: r.reason });
    if (cache.size > 50) cache.clear();
    cache.set(key, r.buf);
    return send(r.buf);
  } catch (e) {
    return json(res, e?.status === 401 ? 401 : 502, { error: String(e?.message || e) });
  }
}
