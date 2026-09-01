import { validSession, type Env } from "./_auth";
// GET  /api/progress -> { done[], inProgress[], stage, stagesDone[], updated }
// POST /api/progress <- { done[], inProgress[], stage, stagesDone[] }
//
// Faithful reimplementation of the original endpoint, rebuilt from the client's
// own contract after the source directory was lost. It reads and writes the
// SAME KV namespace and the SAME "state" key the original used, so existing
// progress carries over untouched.
//
// `updated` is load-bearing: the page treats updated > 0 as "the server has
// real data". If it is 0/absent and the device has local progress, the client
// seeds the server from localStorage. So a fresh/empty store must NOT return a
// bogus timestamp.

const KEY = "state";
// The page ships this key in its own JavaScript, so it is a light gate against
// drive-by writes, not a secret. An env override wins when one is configured.

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


const EMPTY = { done: [], inProgress: [], stage: 0, stagesDone: [], updated: 0 };

export const onRequestOptions: PagesFunction<Env> = () => json({ ok: true });

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const raw = await env.PROGRESS.get(KEY);
  if (!raw) return json(EMPTY);
  try { return json(JSON.parse(raw)); } catch { return json(EMPTY); }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!(await validSession(request, env))) return json({ error: "Sign in to make changes." }, 401);
  let body: any;
  try { body = await request.json(); } catch { return json({ error: "invalid json" }, 400); }

  const arr = (v: unknown) => (Array.isArray(v) ? v.map(String).slice(0, 2000) : []);
  const stageRaw = Number(body?.stage);
  const state = {
    done: arr(body?.done),
    inProgress: arr(body?.inProgress),
    stage: Number.isFinite(stageRaw) ? Math.max(0, Math.min(4, Math.round(stageRaw))) : 0,
    stagesDone: arr(body?.stagesDone).map(Number).filter((n) => Number.isFinite(n)),
    updated: Date.now(),
  };
  await env.PROGRESS.put(KEY, JSON.stringify(state));
  return json(state);
};
