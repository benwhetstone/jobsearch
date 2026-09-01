// The per-job activity timeline.
//
// GET /api/v1/activity?applicationUuid=... | ?queueId=... | ?company=&title=
//     -> { events: [ {id, kind, message, meta, createdAt} ] } newest first.
//     Merges by any identifier you have PLUS the company|title key, so the
//     story is whole even across the queue -> application handoff.
//
// POST /api/v1/activity  -> log one (or many) events. This is how Cowork writes
//     back what it did: "tailored résumé", "passed gate", "submitted on Lever",
//     "note: recruiter replied". Keep messages short and human.
//       { applicationUuid?, queueId?, company?, title?, kind, message, meta? }
//       or { events: [ ...same... ] }
import { json, err, currentUser, logActivity, type Env, type CtxUser } from "../../_lib";

export const onRequestGet: PagesFunction<Env, string, { user?: CtxUser }> = async ({ request, env, data }) => {
  const user = currentUser(data);
  const q = new URL(request.url).searchParams;
  const appUuid = q.get("applicationUuid");
  const queueId = q.get("queueId");
  const company = q.get("company");
  const title = q.get("title");
  const jobKey = company && title ? `${company.toLowerCase().trim()}|${title.toLowerCase().trim()}` : null;
  if (!appUuid && !queueId && !jobKey) return err(400, "Provide applicationUuid, queueId, or company+title.");

  const rows = await env.DB.prepare(
    `SELECT id, kind, message, meta_json, created_at
       FROM activity_log
      WHERE user_id = ?1
        AND ( (?2 IS NOT NULL AND application_uuid = ?2)
           OR (?3 IS NOT NULL AND queue_id = ?3)
           OR (?4 IS NOT NULL AND job_key = ?4) )
      ORDER BY created_at DESC
      LIMIT 200`
  ).bind(user.id, appUuid, queueId, jobKey).all<any>();

  const events = (rows.results ?? []).map((r) => ({
    id: r.id, kind: r.kind, message: r.message,
    meta: r.meta_json ? safeParse(r.meta_json) : null, createdAt: r.created_at,
  }));
  return json({ events });
};

export const onRequestPost: PagesFunction<Env, string, { user?: CtxUser }> = async ({ request, env, data }) => {
  const user = currentUser(data);
  let body: any;
  try { body = await request.json(); } catch { return err(400, "Invalid JSON body."); }
  const items = Array.isArray(body?.events) ? body.events : [body];
  let added = 0;
  for (const it of items) {
    const kind = String(it?.kind || "").trim();
    const message = String(it?.message || "").trim();
    if (!kind || !message) continue;
    await logActivity(env, user.id, {
      applicationUuid: it?.applicationUuid || null, queueId: it?.queueId || null,
      company: it?.company || null, title: it?.title || null, kind, message, meta: it?.meta,
    });
    added++;
  }
  if (!added) return err(400, "Each event needs kind and message.");
  return json({ ok: true, added });
};

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }
