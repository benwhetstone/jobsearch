// GET  /api/v1/last-run  -> { lastRunAt, newEmployers }
// POST /api/v1/last-run  -> stamp completion. Body optional:
//   { lastRunAt?: ISO8601 (defaults to now), newEmployers?: number }
//   -> { lastRunAt, newEmployers }
//
// Cowork windows each board query off elapsed-since-last-run (not a fixed 24h,
// which double-reads same-day reruns and skips gaps). newEmployers is the
// per-run count of employers newly added to the Layer-1 ATS maps — the
// "are we still discovering?" signal.
import { json, err, currentUser, type Env, type CtxUser } from "../../_lib";

export const onRequestGet: PagesFunction<Env, string, { user?: CtxUser }> = async ({ env, data }) => {
  const user = currentUser(data);
  const row = await env.DB.prepare("SELECT last_run_at, new_employers FROM cowork_state WHERE user_id = ?")
    .bind(user.id).first<{ last_run_at: string | null; new_employers: number | null }>();
  return json({ lastRunAt: row?.last_run_at ?? null, newEmployers: row?.new_employers ?? 0 });
};

export const onRequestPost: PagesFunction<Env, string, { user?: CtxUser }> = async ({ request, env, data }) => {
  const user = currentUser(data);
  let body: any = {};
  try { body = await request.json(); } catch { /* empty body allowed */ }
  const now = new Date().toISOString();
  const at = (typeof body?.lastRunAt === "string" && !Number.isNaN(Date.parse(body.lastRunAt))) ? body.lastRunAt : now;
  const newEmployers = Number.isFinite(Number(body?.newEmployers)) ? Math.max(0, Math.round(Number(body.newEmployers))) : 0;
  await env.DB.prepare(
    `INSERT INTO cowork_state (user_id, last_run_at, new_employers, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET last_run_at = excluded.last_run_at,
       new_employers = excluded.new_employers, updated_at = excluded.updated_at`
  ).bind(user.id, at, newEmployers, now).run();
  return json({ lastRunAt: at, newEmployers });
};
