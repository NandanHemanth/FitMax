/**
 * Matterport config for the 3D builder's tour view.
 *   GET /api/matterport/config → { sdkKey, apiConfigured }
 * The SDK key is a browser key by design: Matterport restricts it to the domains you registered
 * (the "Add an SDK domain" form), so it is safe to hand to the page. The Model API token ID/secret
 * stay on this server and are never sent to the browser.
 */
export function handleMatterport(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  const sdkKey = process.env.MATTERPORT_SDK_KEY || null;
  const apiConfigured = Boolean((process.env.MATTERPORT_TOKEN_ID && process.env.MATTERPORT_TOKEN_SECRET) || process.env.MATTERPORT_API_TOKEN);
  res.end(JSON.stringify({ sdkKey, apiConfigured }));
}
