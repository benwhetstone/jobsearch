// The "To Apply" queue — a durable worklist so the apply step is never
// forgotten. Cowork fills this first, then works it one by one.
//
// GET   /api/v1/apply-queue?status=pending   -> the worklist (default pending)
// POST  /api/v1/apply-queue                  -> add one or many items
//         { company, title, url?, location?, notes?, source?, priority? }
//         or { items: [ ...same... ] }
// PATCH /api/v1/apply-queue                  -> { id, action }
//         action "applied" -> promote into applications_v2 (status 'applied')
//                             and mark the queue row applied
//         action "skipped" -> mark the queue row skipped
//         action "reset"   -> back to pending
import { json, err, currentUser, type Env, type CtxUser } from "../../_lib";
import { scoringProfile, scoreJob } from "../../_match";

const uuid = () => crypto.randomUUID();

export const onRequestGet: PagesFunction<Env, string, { user?: CtxUser }> = async ({ request, env, data }) => {
  const user = currentUser(data);
  const status = new URL(request.url).searchParams.get("status") || "pending";
  const rows = await env.DB.prepare(
    `SELECT id, company, title, url, location, notes, source, priority, status, application_uuid,
            match_score, created_at, applied_at
       FROM apply_queue WHERE user_id = ? AND (? = 'all' OR status = ?)
      ORDER BY priority DESC, match_score DESC, created_at ASC`
  ).bind(user.id, status, status).all<any>();
  const counts = await env.DB.prepare(
    "SELECT status, COUNT(*) n FROM apply_queue WHERE user_id = ? GROUP BY status"
  ).bind(user.id).all<any>();
  const byStatus: Record<string, number> = {};
  for (const c of counts.results ?? []) byStatus[c.status] = c.n;
  return json({ queue: rows.results ?? [], counts: byStatus });
};

export const onRequestPost: PagesFunction<Env, string, { user?: CtxUser }> = async ({ request, env, data }) => {
  const user = currentUser(data);
  let body: any;
  try { body = await request.json(); } catch { return err(400, "Invalid JSON body."); }
  const items = Array.isArray(body?.items) ? body.items : [body];
  const now = new Date().toISOString();
  // Score every item with the SAME engine as the feed (profile + résumé), so
  // the queue carries the authoritative match % no matter who added it.
  const profile = await scoringProfile(env, user.id);
  let added = 0;
  const stmts = [];
  for (const it of items) {
    const company = String(it?.company || "").trim();
    const title = String(it?.title || "").trim();
    if (!company || !title) continue;
    const m = scoreJob(profile, {
      title, company, location: it?.location || null, remote: !!it?.remote,
      salaryMin: it?.salaryMin ?? null, salaryMax: it?.salaryMax ?? null,
      description: it?.description || null, postedAt: it?.postedAt || null,
    });
    const score = Math.round(m.total * 100);
    stmts.push(env.DB.prepare(
      `INSERT INTO apply_queue (id, user_id, company, title, url, location, notes, source, priority, match_score, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?, 'pending', ?)
       ON CONFLICT(user_id, company, title) DO UPDATE SET
         url=COALESCE(excluded.url, apply_queue.url),
         notes=COALESCE(excluded.notes, apply_queue.notes),
         location=COALESCE(excluded.location, apply_queue.location),
         source=COALESCE(excluded.source, apply_queue.source),
         match_score=excluded.match_score,
         priority=excluded.priority`
    ).bind(uuid(), user.id, company, title, String(it?.url || "").trim() || null,
           String(it?.location || "").trim() || null, String(it?.notes || "").trim() || null,
           String(it?.source || "").trim() || null, Number(it?.priority) || 0, score, now));
    added++;
  }
  if (!added) return err(400, "Each item needs at least company and title.");
  for (let i = 0; i < stmts.length; i += 30) await env.DB.batch(stmts.slice(i, i + 30));
  return json({ ok: true, added });
};

export const onRequestPatch: PagesFunction<Env, string, { user?: CtxUser }> = async ({ request, env, data }) => {
  const user = currentUser(data);
  let body: any;
  try { body = await request.json(); } catch { return err(400, "Invalid JSON body."); }
  const id = String(body?.id || "");
  const action = String(body?.action || "");
  if (!id) return err(400, "id required.");
  const row = await env.DB.prepare("SELECT * FROM apply_queue WHERE id = ? AND user_id = ?")
    .bind(id, user.id).first<any>();
  if (!row) return err(404, "No such queue item.");
  const now = new Date().toISOString();

  if (action === "skipped" || action === "reset") {
    await env.DB.prepare("UPDATE apply_queue SET status = ? WHERE id = ?")
      .bind(action === "reset" ? "pending" : "skipped", id).run();
    return json({ ok: true, id, status: action === "reset" ? "pending" : "skipped" });
  }

  if (action === "applied") {
    // Promote into the live tracker: create a job + application (status 'applied')
    // exactly like a manually-logged application, and link it back.
    const jobUuid = "queue:" + uuid();
    const appUuid = uuid();
    await env.DB.prepare(
      `INSERT INTO jobs (uuid, source, external_id, title, company_name, location, remote, url, apply_url, description, created_at)
       VALUES (?, 'queue', ?, ?, ?, ?, 0, ?, ?, ?, ?)`
    ).bind(jobUuid, id, row.title, row.company, row.location, row.url || "", row.url || null,
           row.notes ? `From To-Apply queue. ${row.notes}` : "From To-Apply queue.", now).run();
    await env.DB.prepare(
      `INSERT INTO applications_v2 (uuid, user_id, job_uuid, status, need_manual_apply, submitted_at, created_at, updated_at)
       VALUES (?, ?, ?, 'applied', 0, ?, ?, ?)`
    ).bind(appUuid, user.id, jobUuid, now, now, now).run();
    await env.DB.prepare("UPDATE apply_queue SET status = 'applied', application_uuid = ?, applied_at = ? WHERE id = ?")
      .bind(appUuid, now, id).run();
    return json({ ok: true, id, status: "applied", applicationUuid: appUuid });
  }

  return err(400, "action must be one of: applied, skipped, reset.");
};
