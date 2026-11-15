// FitMax AI proxy: keeps the NVIDIA key on the server and turns photos into structured JSON.
// Used by the Vite dev/preview server (vite.config.ts) and the Vercel function (api/ai.mjs).
// Env: NVIDIA_API_KEY (required), NIM_VISION_MODEL, NIM_TEXT_MODEL (optional).

const NIM_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
// Fast vision models raced in parallel (first valid JSON wins); the big Llama is only a last resort.
const VISION = () => (process.env.NIM_VISION_MODEL ? [process.env.NIM_VISION_MODEL] : ['google/gemma-3-12b-it', 'google/gemma-4-31b-it']);
const VISION_FALLBACK = 'meta/llama-3.2-90b-vision-instruct';
const TEXT = () => (process.env.NIM_TEXT_MODEL ? [process.env.NIM_TEXT_MODEL] : ['google/gemma-3-12b-it', 'google/gemma-4-31b-it']);

const SCHEMAS = {
  meal: `{"items":[{"name":string,"grams":number,"kcal":number,"protein":number,"carbs":number,"fat":number}],"notes":string}`,
  fridge: `{"ingredients":[string],"recipes":[{"title":string,"minutes":number,"kcal":number,"protein":number,"carbs":number,"fat":number,"uses":[string],"missing":[string],"steps":[string]}]}`,
  shopping: `{"sections":[{"title":string,"items":[{"name":string,"qty":string,"why":string}]}],"tip":string}`,
};

function profileLine(p = {}, t = {}) {
  const diet = p.diet?.length ? p.diet.join(', ') : 'none';
  const inj = p.injuries?.length ? p.injuries.join(', ') : 'none';
  return `Goal: ${p.goal ?? 'general'}. Daily targets: ${t.kcal ?? '?'} kcal, ${t.proteinG ?? '?'} g protein, ${t.carbsG ?? '?'} g carbs, ${t.fatG ?? '?'} g fat. Dietary restrictions: ${diet}. Injuries: ${inj}.`;
}

function buildMessages(body) {
  const { task, image, profile, targets, context } = body;
  const who = profileLine(profile, targets);
  if (task === 'meal') {
    return {
      models: VISION(),
      vision: true,
      messages: [
        { role: 'system', content: 'You are a sports nutritionist. Estimate food portions from photos conservatively. Reply with JSON only.' },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Identify each food in this meal photo, estimate grams and macros per item (at most 8 items). ${who} Return only minified JSON (no markdown, no comments) exactly matching: ${SCHEMAS.meal}. In notes, give one sentence on how this meal fits the goal.` },
            { type: 'image_url', image_url: { url: image } },
          ],
        },
      ],
    };
  }
  if (task === 'fridge') {
    return {
      models: VISION(),
      vision: true,
      messages: [
        { role: 'system', content: 'You are a chef and sports nutritionist. Only suggest recipes that respect every dietary restriction. Reply with JSON only.' },
        {
          role: 'user',
          content: [
            { type: 'text', text: `List the ingredients you can see in this fridge/pantry photo, then suggest 3 quick recipes that hit the goal, mostly from those ingredients. ${who} Return only minified JSON (no markdown, no comments) exactly matching: ${SCHEMAS.fridge}. Macros per serving. Keep it short: at most 15 ingredients, each recipe at most 4 steps of under 15 words, no extra text.` },
            { type: 'image_url', image_url: { url: image } },
          ],
        },
      ],
    };
  }
  if (task === 'shopping') {
    return {
      models: TEXT(),
      vision: false,
      messages: [
        { role: 'system', content: 'You are a sports nutritionist. Build practical, budget-aware weekly grocery lists. Respect every dietary restriction. Reply with JSON only.' },
        { role: 'user', content: `Build a 7-day grocery list for this person. ${who} ${context ?? ''} Group by store section, at most 6 sections and 8 items each, short reasons. Return only minified JSON (no markdown, no comments) exactly matching: ${SCHEMAS.shopping}.` },
      ],
    };
  }
  throw Object.assign(new Error(`Unknown task: ${task}`), { status: 400 });
}

/** Parse model output as JSON, repairing the usual slips: code fences, prose around it,
 * trailing commas, smart quotes, and replies cut off mid-way (closes open strings/brackets). */
export function extractJson(text) {
  let t = String(text ?? '');
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)(```|$)/);
  if (fenced) t = fenced[1];
  const start = t.indexOf('{');
  if (start < 0) throw new Error('no JSON object');
  t = t.slice(start).replace(/[“”]/g, '"');
  try {
    return JSON.parse(t.slice(0, t.lastIndexOf('}') + 1));
  } catch {
    /* repair below */
  }
  // Walk the text, tracking strings and open brackets; stop at the last complete value.
  const stack = [];
  let inStr = false, esc = false, lastSafe = 0;
  for (let k = 0; k < t.length; k++) {
    const c = t[k];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') {
      stack.pop();
      if (!stack.length) {
        lastSafe = k + 1;
        break;
      }
    }
    if (c === ',' || c === '}' || c === ']') lastSafe = k;
  }
  let body = stack.length ? t.slice(0, lastSafe) : t.slice(0, lastSafe || t.length);
  body = body.replace(/,\s*$/, '').replace(/,\s*([}\]])/g, '$1');
  // re-count what's still open in the kept part and close it
  const open = [];
  inStr = false;
  esc = false;
  for (const c of body) {
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') open.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') open.pop();
  }
  if (inStr) body += '"';
  body = body.replace(/,\s*$/, '').replace(/:\s*$/, ': null');
  return JSON.parse(body + open.reverse().join(''));
}

async function callModel(key, model, messages, timeoutMs) {
  const res = await fetch(NIM_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ model, messages, temperature: 0.1, max_tokens: 1800 }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw Object.assign(new Error(`${model}: NVIDIA API ${res.status}: ${(await res.text()).slice(0, 200)}`), { status: 502 });
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? '';
  try {
    return { model, result: extractJson(text) };
  } catch {
    throw Object.assign(new Error(`${model}: did not return valid JSON`), { status: 502, raw: text.slice(0, 500) });
  }
}

export async function runAi(body) {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) throw Object.assign(new Error('NVIDIA_API_KEY is not set on the server'), { status: 503 });
  const { models, messages, vision } = buildMessages(body);
  const t0 = Date.now();
  try {
    // Race the fast models; first valid JSON wins.
    const out = await Promise.any(models.map((m) => callModel(key, m, messages, 35_000)));
    return { ...out, ms: Date.now() - t0 };
  } catch (agg) {
    const errs = agg.errors ?? [agg];
    console.warn('[ai] fast models failed:', errs.map((e) => e.message).join(' | '));
    if (!vision && !process.env.NIM_TEXT_MODEL) throw errs[0];
    try {
      const out = await callModel(key, VISION_FALLBACK, messages, 60_000);
      return { ...out, ms: Date.now() - t0 };
    } catch (e) {
      throw Object.assign(new Error(`AI failed: ${[...errs, e].map((x) => x.message).join(' | ')}`), { status: 502, raw: e.raw });
    }
  }
}

/** Node-style handler shared by Vite middleware and Vercel. */
export async function handleAi(req, res) {
  const send = (status, obj) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(obj));
  };
  if (req.method === 'GET') return send(200, { ok: true, configured: !!process.env.NVIDIA_API_KEY });
  if (req.method !== 'POST') return send(405, { error: 'POST only' });
  try {
    let body = req.body;
    if (!body || typeof body !== 'object') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    }
    send(200, await runAi(body));
  } catch (e) {
    send(e.status ?? 500, { error: e.message, raw: e.raw });
  }
}
