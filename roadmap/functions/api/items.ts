import { validSession, type Env } from "./_auth";
// GET  /api/items -> { items: { "<stage>": [ {id,label,url,type}, ... ] }, updated }
// POST /api/items <- { items: {...} }            (whole set)
//                 or { stage, item }             (add or update one)
//                 or { stage, remove:"<id>" }    (delete one)
//                 or { stage, order:["id",...] } (reorder within a stage)
//
// The board's cards used to be hard-coded <a> tags, which meant adding a course
// or fixing a dead link was a redeploy. They live here instead, in the same KV
// namespace as progress and salaries, so the page can edit itself.
//
// Which COLUMN a card sits in is not stored here — that stays in /api/progress
// as done/inProgress id sets, because data.benwhetstone.info reads those to
// decide which certifications to surface. This file owns identity and order.

const KEY = "items";
const TYPES = new Set(["core", "tool", "book", "opt"]);

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: {
    "content-type": "application/json", "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type,x-roadmap-key",
    "access-control-allow-methods": "GET,POST,OPTIONS" } });


async function load(env: Env) {
  const raw = await env.PROGRESS.get(KEY);
  if (!raw) return { items: {} as Record<string, any[]>, updated: 0 };
  try { const p = JSON.parse(raw); return { items: p.items || {}, updated: p.updated || 0 }; }
  catch { return { items: {} as Record<string, any[]>, updated: 0 }; }
}

const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

// A card is only worth storing if it has a label; everything else can be empty.
function clean(it: any) {
  const label = str(it?.label, 120);
  if (!label) return null;
  const type = TYPES.has(String(it?.type)) ? String(it.type) : "tool";
  let url = str(it?.url, 500);
  if (url && !/^https?:\/\//i.test(url)) url = "https://" + url;
  const id = str(it?.id, 160) || null;
  return { id, label, url, type };
}

export const onRequestOptions: PagesFunction<Env> = () => json({ ok: true });

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  return json(await load(env));
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!(await validSession(request, env))) return json({ error: "Sign in to make changes." }, 401);
  let body: any;
  try { body = await request.json(); } catch { return json({ error: "invalid json" }, 400); }

  const cur = await load(env);
  const items: Record<string, any[]> = { ...cur.items };

  if (body?.items && typeof body.items === "object") {
    for (const k of Object.keys(body.items)) {
      const list = Array.isArray(body.items[k]) ? body.items[k] : [];
      items[k] = list.map(clean).filter(Boolean).slice(0, 200);
    }
  } else {
    const stage = str(body?.stage, 4);
    if (!stage) return json({ error: "stage is required" }, 400);
    const list = Array.isArray(items[stage]) ? [...items[stage]] : [];

    if (body?.remove) {
      items[stage] = list.filter((x) => x.id !== str(body.remove, 160));
    } else if (Array.isArray(body?.order)) {
      const by = new Map(list.map((x) => [x.id, x]));
      const sorted = body.order.map((id: string) => by.get(str(id, 160))).filter(Boolean);
      // anything the caller did not mention keeps its place at the end
      for (const x of list) if (!sorted.includes(x)) sorted.push(x);
      items[stage] = sorted;
    } else {
      const it = clean(body?.item);
      if (!it) return json({ error: "item needs a label" }, 400);
      const at = list.findIndex((x) => x.id === it.id);
      if (at >= 0) list[at] = { ...list[at], ...it };
      else list.push(it);
      items[stage] = list.slice(0, 200);
    }
  }

  const payload = { items, updated: Date.now() };
  await env.PROGRESS.put(KEY, JSON.stringify(payload));
  return json(payload);
};
