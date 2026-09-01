import { validSession, type Env } from "./_auth";
// GET  /api/salaries -> { salaries: { "0": {min,max,plus,label}, ... }, updated }
// POST /api/salaries <- { stage, min, max, plus? }   (one stage at a time)
//                    or { salaries: { "0": {...}, ... } }  (bulk)
//
// The bands were hard-coded in the page, so they could only be changed by
// editing and redeploying. They're the numbers most likely to move — a posted
// range is a guess until you've actually talked to people — so they now live in
// KV and are editable in the browser.
//
// Stored beside progress in the same namespace under key "salaries", which is
// why this needed no migration and no new binding.

const KEY = "salaries";

// What the page shipped with. Serve these until Ben overrides a stage, so an
// empty store renders exactly what he sees today rather than blanks.
const DEFAULTS: Record<string, { min: number; max: number; plus: boolean }> = {
  "0": { min: 0, max: 0, plus: false },           // Transition — not yet hired, so no band at all
  "1": { min: 55000, max: 80000, plus: false },   // Stage 1 — Data Analyst
  "2": { min: 110000, max: 140000, plus: false }, // Stage 2 — Senior Data Analyst
  "3": { min: 130000, max: 160000, plus: false }, // Stage 3 — Analytics Manager
  "4": { min: 180000, max: 250000, plus: true },  // The Goal — Director
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type,x-roadmap-key",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    },
  });


async function load(env: Env): Promise<{ salaries: Record<string, any>; updated: number }> {
  const raw = await env.PROGRESS.get(KEY);
  let saved: Record<string, any> = {}, updated = 0;
  if (raw) { try { const p = JSON.parse(raw); saved = p.salaries || {}; updated = p.updated || 0; } catch { /* fall through to defaults */ } }
  const salaries: Record<string, any> = {};
  for (const k of Object.keys(DEFAULTS)) salaries[k] = { ...DEFAULTS[k], ...(saved[k] || {}) };
  return { salaries, updated };
}

// A band is only meaningful if it's a real number and min <= max.
function clean(v: any, fallback: { min: number; max: number; plus: boolean }) {
  // Zero is meaningful here: the Transition stage has no income yet. Only an
  // empty or non-numeric value falls back to the previous figure.
  const n = (x: any) => {
    const raw = String(x ?? "").replace(/[^0-9.]/g, "");
    if (!raw) return null;
    const y = Number(raw);
    return Number.isFinite(y) && y >= 0 ? Math.round(y) : null;
  };
  let min = n(v?.min) ?? fallback.min;
  let max = n(v?.max) ?? fallback.max;
  if (min > max) [min, max] = [max, min];   // typed backwards; just swap
  return { min, max, plus: !!v?.plus };
}

export const onRequestOptions: PagesFunction<Env> = () => json({ ok: true });

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  return json(await load(env));
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!(await validSession(request, env))) return json({ error: "Sign in to make changes." }, 401);
  let body: any;
  try { body = await request.json(); } catch { return json({ error: "invalid json" }, 400); }

  const cur = (await load(env)).salaries;
  const next: Record<string, any> = { ...cur };

  if (body?.salaries && typeof body.salaries === "object") {
    for (const k of Object.keys(DEFAULTS)) {
      if (body.salaries[k]) next[k] = clean(body.salaries[k], DEFAULTS[k]);
    }
  } else {
    const stage = String(body?.stage ?? "");
    if (!(stage in DEFAULTS)) return json({ error: "stage must be 0-4" }, 400);
    next[stage] = clean(body, DEFAULTS[stage]);
  }

  const payload = { salaries: next, updated: Date.now() };
  await env.PROGRESS.put(KEY, JSON.stringify(payload));
  return json(payload);
};
