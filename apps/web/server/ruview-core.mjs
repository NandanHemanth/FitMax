/**
 * Proxy from the FitMax web app to the sensing hub (FitMax RSSI hub or RuView on the Arduino UNO Q).
 * The bearer token lives only here (from .env); the browser never sees it.
 * Reads: a fixed allowlist of GET endpoints. Writes: only three configuration calls
 * (empty-room calibration, the room layout, and activity labels for recording training data).
 */
const ALLOW = new Set(['health', 'status', 'nodes', 'sensing/latest', 'vital-signs', 'edge-vitals', 'zones', 'rssi/recent', 'layout']);
const ALLOW_POST = new Set(['calibrate/empty', 'layout', 'label']);

async function readBody(req) {
  let raw = '';
  for await (const c of req) {
    raw += c;
    if (raw.length > 50_000) throw new Error('too large');
  }
  return raw || '{}';
}

const cfg = () => ({
  base: (process.env.RUVIEW_URL || '').replace(/\/+$/, ''),
  token: process.env.RUVIEW_API_TOKEN || '',
});

function send(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/** Node-style handler mounted at /api/ruview. req.url is the remainder, e.g. "/sensing/latest". */
export async function handleRuview(req, res) {
  const [rawPath, query] = String(req.url || '/').split('?');
  const path = rawPath.replace(/^\/+|\/+$/g, '');
  const post = req.method === 'POST';
  if (!post && req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
  if (post && !ALLOW_POST.has(path)) return send(res, 405, { error: 'read-only' });
  const { base, token } = cfg();
  if (path === '' || path === 'config') return send(res, 200, { configured: Boolean(base), hub: base ? new URL(base).host : null });
  if (!post && !ALLOW.has(path)) return send(res, 404, { error: 'not allowed' });
  if (!base) return send(res, 503, { error: 'RUVIEW_URL not set', configured: false });

  const qs = path === 'rssi/recent' && query && /^seconds=\d{1,3}$/.test(query) ? `?${query}` : '';
  const url = path === 'health' ? `${base}/health` : `${base}/api/v1/${path}${qs}`;
  try {
    const body = post ? await readBody(req) : undefined;
    const r = await fetch(url, {
      method: post ? 'POST' : 'GET',
      body,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(post ? { 'Content-Type': 'application/json' } : {}) },
      signal: AbortSignal.timeout(3500),
    });
    const text = await r.text();
    res.statusCode = r.status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(text || '{}');
  } catch (e) {
    send(res, 502, { error: 'hub unreachable', detail: String(e?.cause?.code || e?.name || e) });
  }
}
