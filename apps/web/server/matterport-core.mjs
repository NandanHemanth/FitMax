/**
 * Matterport config for the 3D builder's tour view.
 *   GET /api/matterport/config → { sdkKey, apiConfigured }
 * The SDK key is a browser key by design: Matterport restricts it to the domains you registered
 * (the "Add an SDK domain" form), so it is safe to hand to the page. The Model API token ID/secret
 * stay on this server and are never sent to the browser.
 */
const seen = new Map(); // model id -> { ok, status, at }

/** GET /api/matterport/check?m=<id>: is this scan still public on Matterport? (cached 10 min) */
async function check(m) {
  const hit = seen.get(m);
  if (hit && Date.now() - hit.at < 600_000) return hit;
  let out;
  try {
    const r = await fetch(`https://my.matterport.com/api/player/models/${m}/`, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) out = { ok: false, status: `removed (${r.status})` };
    else {
      const d = await r.json();
      const ok = Boolean(d.is_public) && !d.has_public_access_password && ['active', 'copying'].includes(d.status);
      out = { ok, status: ok ? 'public' : d.has_public_access_password ? 'password protected' : d.is_public ? d.status : 'private' };
    }
  } catch {
    out = { ok: null, status: 'could not reach Matterport' };
  }
  out.at = Date.now();
  seen.set(m, out);
  return out;
}

export async function handleMatterport(req, res) {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname.endsWith('/check')) {
    res.setHeader('Content-Type', 'application/json');
    const m = url.searchParams.get('m') ?? '';
    if (!/^[A-Za-z0-9]{11}$/.test(m)) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: 'bad model id' }));
    }
    return res.end(JSON.stringify(await check(m)));
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  const sdkKey = process.env.MATTERPORT_SDK_KEY || null;
  const apiConfigured = Boolean((process.env.MATTERPORT_TOKEN_ID && process.env.MATTERPORT_TOKEN_SECRET) || process.env.MATTERPORT_API_TOKEN);
  res.end(JSON.stringify({ sdkKey, apiConfigured }));
}
