// FitMax AI proxy: keeps the NVIDIA key on the server and turns photos into structured JSON.
// Used by the Vite dev/preview server (vite.config.ts) and the Vercel function (api/ai.mjs).
// Env: NVIDIA_API_KEY (required), NIM_VISION_MODEL, NIM_TEXT_MODEL (optional).

const NIM_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const VISION = () => process.env.NIM_VISION_MODEL || 'meta/llama-3.2-90b-vision-instruct';
const TEXT = () => process.env.NIM_TEXT_MODEL || 'meta/llama-3.2-90b-vision-instruct';

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
      model: VISION(),
      messages: [
        { role: 'system', content: 'You are a sports nutritionist. Estimate food portions from photos conservatively. Reply with JSON only.' },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Identify each food in this meal photo, estimate grams and macros per item. ${who} Return JSON exactly matching: ${SCHEMAS.meal}. In notes, give one sentence on how this meal fits the goal.` },
            { type: 'image_url', image_url: { url: image } },
          ],
        },
      ],
    };
  }
  if (task === 'fridge') {
    return {
      model: VISION(),
      messages: [
        { role: 'system', content: 'You are a chef and sports nutritionist. Only suggest recipes that respect every dietary restriction. Reply with JSON only.' },
        {
          role: 'user',
          content: [
            { type: 'text', text: `List the ingredients you can see in this fridge/pantry photo, then suggest 3 quick recipes that hit the goal, mostly from those ingredients. ${who} Return JSON exactly matching: ${SCHEMAS.fridge}. Macros per serving.` },
            { type: 'image_url', image_url: { url: image } },
          ],
        },
      ],
    };
  }
  if (task === 'shopping') {
    return {
      model: TEXT(),
      messages: [
        { role: 'system', content: 'You are a sports nutritionist. Build practical, budget-aware weekly grocery lists. Respect every dietary restriction. Reply with JSON only.' },
        { role: 'user', content: `Build a 7-day grocery list for this person. ${who} ${context ?? ''} Group by store section. Return JSON exactly matching: ${SCHEMAS.shopping}.` },
      ],
    };
  }
  throw Object.assign(new Error(`Unknown task: ${task}`), { status: 400 });
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(raw);
}

export async function runAi(body) {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) throw Object.assign(new Error('NVIDIA_API_KEY is not set on the server'), { status: 503 });
  const { model, messages } = buildMessages(body);
  const res = await fetch(NIM_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: 1400 }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw Object.assign(new Error(`NVIDIA API ${res.status}: ${(await res.text()).slice(0, 300)}`), { status: 502 });
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? '';
  try {
    return { model, result: extractJson(text) };
  } catch {
    throw Object.assign(new Error('Model did not return valid JSON'), { status: 502, raw: text.slice(0, 500) });
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
