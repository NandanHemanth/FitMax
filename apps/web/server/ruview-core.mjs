/**
 * Read-only proxy from the FitMax web app to a RuView sensing server (e.g. on the Arduino UNO Q hub).
 * The bearer token lives only here (from .env); the browser never sees it.
 * Only a fixed allowlist of GET endpoints is forwarded, so the web app stays "view only".
 */
const ALLOW = new Set(['health', 'status', 'nodes', 'sensing/latest', 'vital-signs', 'edge-vitals', 'zones']);

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
  if (req.method !== 'GET') return send(res, 405, { error: 'read-only' });
  const path = String(req.url || '/').split('?')[0].replace(/^\/+|\/+$/g, '');
  const { base, token } = cfg();
  if (path === '' || path === 'config') return send(res, 200, { configured: Boolean(base), hub: base ? new URL(base).host : null });
  if (!ALLOW.has(path)) return send(res, 404, { error: 'not allowed' });
  if (!base) return send(res, 503, { error: 'RUVIEW_URL not set', configured: false });

  const url = path === 'health' ? `${base}/health` : `${base}/api/v1/${path}`;
  try {
    const r = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
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
