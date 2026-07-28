// POST /api/v1/applications/bulk   { jobUuids: [...] }
//   Queue many applications at once. Rows are created as status 'queued' and a
//   worker chain prepares them ONE at a time (autopilot is sequential on
//   purpose: it keeps token spend visible and the budget gate effective).
// POST /api/v1/applications/process-next
//   Claim and prepare the oldest queued application. Called by the chain and
//   polled by the UI as a backstop, so the queue drains even if a chain link
//   is lost. Claiming flips status queued->preparing atomically, so concurrent
//   calls can't double-prepare one application.
import { json, err, currentUser, type Env, type CtxUser } from "../../_lib";
import { prepare } from "./index";
import { BudgetExceeded, spentTodayUsd, DAILY_BUDGET_USD } from "../../_ai";

const MAX_BULK = 25;

export const onRequestPost: PagesFunction<Env, string, { user?: CtxUser }> = async (context) => {
  const { request, env, data } = context;
  const user = currentUser(data);

  let body: any;
  try { body = await request.json(); } catch { return err(400, "Invalid JSON body."); }
  const jobUuids: string[] = Array.isArray(body?.jobUuids) ? body.jobUuids.map(String).slice(0, MAX_BULK) : [];
  if (!jobUuids.length) return err(400, "jobUuids is required.");

  const now = new Date().toISOString();
  let queued = 0;
  for (const jobUuid of jobUuids) {
    const job = await env.DB.prepare("SELECT uuid FROM jobs WHERE uuid = ?").bind(jobUuid).first();
    if (!job) continue;
    const dup = await env.DB.prepare("SELECT uuid FROM applications_v2 WHERE user_id = ? AND job_uuid = ?")
      .bind(user.id, jobUuid).first();
    if (dup) continue;
    const match = await env.DB.prepare("SELECT total_score FROM matches WHERE user_id = ? AND job_uuid = ?")
      .bind(user.id, jobUuid).first<{ total_score: number }>();
    await env.DB.prepare(
      `INSERT INTO applications_v2 (uuid, user_id, job_uuid, status, match_score, created_at, updated_at)
       VALUES (?, ?, ?, 'queued', ?, ?, ?)`
    ).bind(crypto.randomUUID(), user.id, jobUuid, match?.total_score ?? null, now, now).run();
    await env.DB.prepare("UPDATE matches SET status = 'applied' WHERE user_id = ? AND job_uuid = ?")
      .bind(user.id, jobUuid).run();
    queued++;
  }

  // kick the chain without blocking the response
  if (queued) context.waitUntil(drainOne(env, user).catch(() => {}));

  const spent = await spentTodayUsd(env, user.id);
  return json({ queued, budget: { spentUsd: Math.round(spent * 100) / 100, capUsd: DAILY_BUDGET_USD } });
};

// Claim exactly one queued row, prepare it, then chain to the next.
export async function drainOne(env: Env, user: CtxUser): Promise<{ processed: string | null; remaining: number; paused?: string }> {
  const remaining = async () => {
    const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM applications_v2 WHERE user_id = ? AND status = 'queued'")
      .bind(user.id).first<{ n: number }>();
    return r?.n ?? 0;
  };

  // budget check up front so an exhausted day doesn't half-prepare anything
  if (await spentTodayUsd(env, user.id) >= DAILY_BUDGET_USD) {
    return { processed: null, remaining: await remaining(), paused: "Daily AI budget reached. The queue resumes automatically tomorrow." };
  }

  const next = await env.DB.prepare(
    "SELECT uuid, job_uuid FROM applications_v2 WHERE user_id = ? AND status = 'queued' ORDER BY created_at LIMIT 1"
  ).bind(user.id).first<{ uuid: string; job_uuid: string }>();
  if (!next) return { processed: null, remaining: 0 };

  // atomic claim: only one worker wins this row
  const claim = await env.DB.prepare(
    "UPDATE applications_v2 SET status = 'preparing', updated_at = ? WHERE uuid = ? AND status = 'queued'"
  ).bind(new Date().toISOString(), next.uuid).run();
  if (!claim.meta?.changes) return { processed: null, remaining: await remaining() };

  const job = await env.DB.prepare(
    "SELECT uuid, title, company_name, description, url, apply_url, source FROM jobs WHERE uuid = ?"
  ).bind(next.job_uuid).first<any>();

  try {
    await prepare(env, user, next.uuid, job, { skipOnReject: true });
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 400);
    const paused = e instanceof BudgetExceeded || /budget/i.test(msg);
    await env.DB.prepare("UPDATE applications_v2 SET status = ?, prepare_error = ?, updated_at = ? WHERE uuid = ?")
      .bind(paused ? "queued" : "failed", paused ? null : msg, new Date().toISOString(), next.uuid).run();
    if (paused) return { processed: null, remaining: await remaining(), paused: msg };
  }
  return { processed: next.uuid, remaining: await remaining() };
}
