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
import { json, err, currentUser, logActivity, nowEastern, type Env, type CtxUser } from "../../_lib";
import { canonicalJobId } from "../../_jobid";

const uuid = () => crypto.randomUUID();

// Why a row left the worklist. `gated` is the one worth reviving in bulk: the
// posting is live and submittable, it just needs Ben signed in first.
const SKIP_REASONS = new Set([
  "dead",          // posting removed / 404 / req pulled            -> not revivable
  "closed",        // exists but no longer accepting applications   -> not revivable
  "gated",         // blocked on account creation / sign-in / captcha -> REVIVABLE
  "screened_out",  // conflicts with a stated constraint            -> maybe
  "off_target",    // outside the stated search targets             -> maybe
  "duplicate",     // same req already applied to elsewhere         -> not revivable
]);

// Why the tool is parking a row Ben already put on his list. A hold is NOT a
// skip: the row stays in To-Apply, visibly flagged, and only Ben clears it.
// Every hold needs a reason AND a concrete detail — "on hold" with no argument
// is just a silent skip wearing a different hat.
const HOLD_REASONS = new Set([
  "closed",           // no longer accepting applications
  "pay_below_floor",  // posted band sits entirely under the $77K floor
  "location",         // on-site / geography conflict
  "clearance",        // requires a clearance Ben does not hold
  "experience_gap",   // hard requirement he does not meet
  "duplicate",        // same req already in the funnel
  "employer_flag",    // BPO / gig / staffing mill / never-surface category
  "gated",            // needs Ben signed in at the keyboard
  "other",            // anything else — detail carries the weight
]);

export const onRequestGet: PagesFunction<Env, string, { user?: CtxUser }> = async ({ request, env, data }) => {
  const user = currentUser(data);
  const q = new URL(request.url).searchParams;
  const status = q.get("status") || "pending";
  // ?reason=gated narrows skipped rows to the revivable ones, so a backlog can
  // be reopened in one pass after a sign-in session.
  const reason = (q.get("reason") || "all").trim().toLowerCase();
  // status accepts one value, "all", or a comma list ("pending,hold") so the
  // To-Apply view can pull the worklist and its held rows in a single call.
  const wanted = status === "all" ? null : status.split(",").map((x) => x.trim()).filter(Boolean);
  const statusClause = wanted ? `AND status IN (${wanted.map(() => "?").join(",")})` : "";
  const rows = await env.DB.prepare(
    `SELECT id, company, title, url, location, notes, source, priority, status, application_uuid,
            match_score, salary_min, salary_max, resume_url, cover_url, job_id, experience, skills_json, arrangement, created_at, applied_at,
            skip_reason, skip_detail, skipped_by, skipped_at,
            hold_reason, hold_detail, held_by, held_at
       FROM apply_queue WHERE user_id = ? ${statusClause} AND (? = 'all' OR skip_reason = ?)
      ORDER BY priority DESC, match_score DESC, created_at ASC`
  ).bind(user.id, ...(wanted ?? []), reason, reason).all<any>();
  const counts = await env.DB.prepare(
    "SELECT status, COUNT(*) n FROM apply_queue WHERE user_id = ? GROUP BY status"
  ).bind(user.id).all<any>();
  const byStatus: Record<string, number> = {};
  for (const c of counts.results ?? []) byStatus[c.status] = c.n;
  // Breakdown of why things were skipped — lets a client see the gated backlog
  // without fetching every row.
  const rs = await env.DB.prepare(
    "SELECT skip_reason, COUNT(*) n FROM apply_queue WHERE user_id = ? AND status = 'skipped' AND skip_reason IS NOT NULL GROUP BY skip_reason"
  ).bind(user.id).all<any>();
  const byReason: Record<string, number> = {};
  for (const c of rs.results ?? []) byReason[c.skip_reason] = c.n;
  return json({ queue: rows.results ?? [], counts: byStatus, skipReasons: byReason });
};

export const onRequestPost: PagesFunction<Env, string, { user?: CtxUser }> = async ({ request, env, data }) => {
  const user = currentUser(data);
  let body: any;
  try { body = await request.json(); } catch { return err(400, "Invalid JSON body."); }
  // The To-Apply list is Ben's alone. Automated clients kept writing to it
  // anyway — he would dismiss roles in Jobs For You and find fresh ones from the
  // same employers sitting on his worklist minutes later. The rule has been
  // stated repeatedly and not held, so it is enforced here: only a real user
  // action may add. Machines surface candidates via POST /api/v1/suggestions,
  // which lands them in Jobs For You for him to accept or dismiss.
  if (String(body?.actor || "") !== "user") {
    return err(409, "Only the user can add to To-Apply. This is Ben's worklist — " +
      "post candidates to /api/v1/suggestions instead and they appear in Jobs For You " +
      "for him to add himself.");
  }
  const items = Array.isArray(body?.items) ? body.items : [body];
  const now = new Date().toISOString();
  // Scores are retired — Ben reads the standard card facts and judges for
  // himself. A caller may still pass matchScore and we'll store it, but we no
  // longer load the profile/résumé to compute one, which makes this call fast.
  let added = 0;
  const stmts = [];
  const wanted: { company: string; title: string; jobId: string }[] = [];
  for (const it of items) {
    const company = String(it?.company || "").trim();
    const title = String(it?.title || "").trim();
    if (!company || !title) continue;
    const sMin = it?.salaryMin ?? null, sMax = it?.salaryMax ?? null;
    const desc = it?.description ? String(it.description).slice(0, 8000) : null;
    const resumeUrl = String(it?.resumeUrl || "").trim() || null;
    const coverUrl = String(it?.coverUrl || "").trim() || null;
    // Standard card facts, carried from the suggestion so the To-Apply card
    // shows the same four things the Jobs For You card did.
    const experience = it?.experience ? String(it.experience).trim().slice(0, 60) : null;
    const skillsJson = Array.isArray(it?.skills)
      ? JSON.stringify(it.skills.map((x: any) => String(x).trim()).filter(Boolean).slice(0, 12))
      : (typeof it?.skills === "string" && it.skills.trim()
          ? JSON.stringify(it.skills.split(",").map((x: string) => x.trim()).filter(Boolean).slice(0, 12))
          : null);
    const arrangement = (() => {
      const a = String(it?.arrangement || "").trim().toLowerCase().replace("on-site", "onsite");
      if (["remote", "hybrid", "onsite"].includes(a)) return a;
      return it?.remote ? "remote" : null;
    })();
    // Canonical identity so a queued job matches the same posting in the feed
    // and, later, the application. Caller may pass jobId (from POST /job-id);
    // otherwise derive it from the same fields the endpoint would.
    const jobId = String(it?.jobId || "").trim() || canonicalJobId({
      company, title, location: it?.location || null, remote: it?.remote,
      url: it?.url || null, applyUrl: it?.applyUrl || null,
    });
    // Use the caller's authoritative match % if provided (e.g. the feed's
    // already-scored value); otherwise score here — but scoring a bare title
    // with no posting text is weak, so a passed score always wins.
    const score = it?.matchScore != null && Number.isFinite(Number(it.matchScore))
      ? Math.round(Number(it.matchScore)) : null;
    stmts.push(env.DB.prepare(
      `INSERT INTO apply_queue (id, user_id, company, title, url, location, notes, source, priority, match_score, salary_min, salary_max, description, resume_url, cover_url, job_id, experience, skills_json, arrangement, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending', ?)
       ON CONFLICT(user_id, company, title) DO UPDATE SET
         url=COALESCE(excluded.url, apply_queue.url),
         notes=COALESCE(excluded.notes, apply_queue.notes),
         location=COALESCE(excluded.location, apply_queue.location),
         source=COALESCE(excluded.source, apply_queue.source),
         match_score=excluded.match_score,
         salary_min=COALESCE(excluded.salary_min, apply_queue.salary_min),
         salary_max=COALESCE(excluded.salary_max, apply_queue.salary_max),
         description=COALESCE(excluded.description, apply_queue.description),
         resume_url=COALESCE(excluded.resume_url, apply_queue.resume_url),
         cover_url=COALESCE(excluded.cover_url, apply_queue.cover_url),
         job_id=excluded.job_id,
         experience=COALESCE(excluded.experience, apply_queue.experience),
         skills_json=COALESCE(excluded.skills_json, apply_queue.skills_json),
         arrangement=COALESCE(excluded.arrangement, apply_queue.arrangement),
         priority=excluded.priority,
         -- Re-adding is a deliberate "put this back on my list". Without this,
         -- an upsert onto a previously-skipped row updated the fields but left
         -- status='skipped' — so the job silently never appeared in To-Apply
         -- while its card still left Jobs For You. A row that has already been
         -- APPLIED is left alone; re-adding must never un-apply anything.
         status=CASE WHEN apply_queue.status = 'applied' THEN 'applied' ELSE 'pending' END,
         skip_reason=CASE WHEN apply_queue.status = 'applied' THEN apply_queue.skip_reason ELSE NULL END,
         skip_detail=CASE WHEN apply_queue.status = 'applied' THEN apply_queue.skip_detail ELSE NULL END,
         skipped_by=CASE WHEN apply_queue.status = 'applied' THEN apply_queue.skipped_by ELSE NULL END,
         skipped_at=CASE WHEN apply_queue.status = 'applied' THEN apply_queue.skipped_at ELSE NULL END,
         hold_reason=CASE WHEN apply_queue.status = 'applied' THEN apply_queue.hold_reason ELSE NULL END,
         hold_detail=CASE WHEN apply_queue.status = 'applied' THEN apply_queue.hold_detail ELSE NULL END,
         held_by=CASE WHEN apply_queue.status = 'applied' THEN apply_queue.held_by ELSE NULL END,
         held_at=CASE WHEN apply_queue.status = 'applied' THEN apply_queue.held_at ELSE NULL END`
    ).bind(uuid(), user.id, company, title, String(it?.url || "").trim() || null,
           String(it?.location || "").trim() || null, String(it?.notes || "").trim() || null,
           String(it?.source || "").trim() || null, Number(it?.priority) || 0, score,
           sMin, sMax, desc, resumeUrl, coverUrl, jobId, experience, skillsJson, arrangement, now));
    added++;
    wanted.push({ company, title, jobId });
    await logActivity(env, user.id, { company, title, kind: "queued",
      message: `Added to To-Apply (${score}% match)${it?.source ? ` from ${it.source}` : ""}.` });
  }
  if (!added) return err(400, "Each item needs at least company and title.");
  for (let i = 0; i < stmts.length; i += 30) await env.DB.batch(stmts.slice(i, i + 30));

  // Read back what ACTUALLY landed. Previously this returned {ok:true} without
  // checking, and the client removed the card on that alone — so if a row ended
  // up in any non-pending state the job vanished from both lists. The caller now
  // gets each row's real status and can refuse to drop the card unless it is
  // genuinely on the worklist.
  const results: { company: string; title: string; jobId: string; status: string; onList: boolean }[] = [];
  for (const w of wanted) {
    const row = await env.DB.prepare(
      "SELECT status FROM apply_queue WHERE user_id = ? AND company = ? AND title = ?"
    ).bind(user.id, w.company, w.title).first<{ status: string }>();
    const status = row?.status ?? "missing";
    results.push({ ...w, status, onList: status === "pending" });
  }

  // Take the job out of Jobs For You HERE, server-side, and only for rows that
  // really made it onto the worklist. This used to be a separate client PATCH
  // whose failure was swallowed, which let the two lists disagree.
  const onList = results.filter((r) => r.onList).map((r) => r.jobId).filter(Boolean);
  if (onList.length) {
    const marks = onList.map(() => "?").join(",");
    await env.DB.prepare(
      `UPDATE matches SET status = 'queued'
        WHERE user_id = ? AND status = 'matched'
          AND job_uuid IN (SELECT uuid FROM jobs WHERE job_id IN (${marks}))`
    ).bind(user.id, ...onList).run().catch(() => {});
  }

  const queued = results.filter((r) => r.onList).length;
  return json({ ok: queued > 0, added: queued, results });
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

  if (action === "skipped") {
    // The queue is Ben's worklist, and an automated client once bulk-skipped 13
    // rows in a minute with no explanation. So a skip is never silent:
    //   - the user's own Skip button sends actor:"user" and needs no reason;
    //   - anyone else MUST name a reason from the enum plus a real detail.
    // That keeps the audit trail and, more importantly, keeps `gated` rows
    // (blocked only on a sign-in) distinguishable from genuinely dead ones.
    const byUser = String(body?.actor || "") === "user";
    const reason = String(body?.reason || "").trim().toLowerCase();
    const detail = String(body?.detail || "").trim();
    if (!byUser) {
      if (!SKIP_REASONS.has(reason)) {
        return err(400, `A skip needs reason: one of ${[...SKIP_REASONS].join(", ")}. ` +
          "Send { id, action:\"skipped\", reason, detail } — a bare skip is refused so nothing " +
          "leaves the worklist unexplained.");
      }
      if (detail.length < 20) {
        return err(400, "detail is required with a skip (at least 20 characters): say concretely what blocked it.");
      }
    }
    const note = String(body?.notes || "").trim();
    const merged = note ? (row.notes ? `${row.notes}\n${note}` : note) : row.notes;   // append, never replace
    await env.DB.prepare(
      `UPDATE apply_queue SET status = 'skipped', skip_reason = ?, skip_detail = ?,
         skipped_by = ?, skipped_at = ?, notes = ? WHERE id = ?`
    ).bind(reason || null, detail || null, byUser ? "user" : "agent", now, merged, id).run();
    await logActivity(env, user.id, { queueId: id, company: row.company, title: row.title,
      kind: "status",
      message: byUser ? "Skipped in To-Apply (by user)."
                      : `Skipped in To-Apply (agent, ${reason}): ${detail.slice(0, 200)}`,
      meta: { reason: reason || null, by: byUser ? "user" : "agent" } });
    return json({ ok: true, id, status: "skipped", skipReason: reason || null,
                  skippedBy: byUser ? "user" : "agent", skippedAt: now });
  }

  if (action === "hold") {
    // The tool found a reason not to apply to something ALREADY on the list.
    // It may flag, it may not remove: the row stays in To-Apply as 'hold' with
    // the reason on the card, and Ben releases it or skips it himself.
    const byUser = String(body?.actor || "") === "user";
    const reason = String(body?.reason || "").trim().toLowerCase();
    const detail = String(body?.detail || "").trim();
    if (!byUser) {
      if (!HOLD_REASONS.has(reason)) {
        return err(400, `A hold needs reason: one of ${[...HOLD_REASONS].join(", ")}. ` +
          "Send { id, action:\"hold\", reason, detail }.");
      }
      if (detail.length < 20) {
        return err(400, "detail is required with a hold (at least 20 characters): say concretely what you found, " +
          "including where you found it, so the row can be judged without re-reading the posting.");
      }
    }
    if (row.status === "applied") {
      return err(409, "That one is already applied — a hold cannot un-apply it. Change the application's status instead.");
    }
    await env.DB.prepare(
      `UPDATE apply_queue SET status = 'hold', hold_reason = ?, hold_detail = ?,
         held_by = ?, held_at = ? WHERE id = ?`
    ).bind(reason || null, detail || null, byUser ? "user" : "agent", now, id).run();
    await logActivity(env, user.id, { queueId: id, company: row.company, title: row.title,
      kind: "status",
      message: byUser ? `Put on hold (by user)${reason ? ` — ${reason}` : ""}.`
                      : `Put on hold (agent, ${reason}): ${detail.slice(0, 200)}`,
      meta: { reason: reason || null, by: byUser ? "user" : "agent" } });
    return json({ ok: true, id, status: "hold", holdReason: reason || null,
                  holdDetail: detail || null, heldBy: byUser ? "user" : "agent", heldAt: now });
  }

  if (action === "release") {
    // Ben overruled the hold: back on the worklist, hold record cleared.
    await env.DB.prepare(
      "UPDATE apply_queue SET status = 'pending', hold_reason = NULL, hold_detail = NULL, held_by = NULL, held_at = NULL WHERE id = ?"
    ).bind(id).run();
    await logActivity(env, user.id, { queueId: id, company: row.company, title: row.title,
      kind: "note", message: "Hold released — back on the To-Apply list." });
    return json({ ok: true, id, status: "pending" });
  }

  if (action === "reset") {
    // Restore to the worklist and clear the skip record — a revived row should
    // carry no stale "why it was dropped" state.
    await env.DB.prepare(
      "UPDATE apply_queue SET status = 'pending', skip_reason = NULL, skip_detail = NULL, skipped_by = NULL, skipped_at = NULL, " +
      "hold_reason = NULL, hold_detail = NULL, held_by = NULL, held_at = NULL WHERE id = ?"
    ).bind(id).run();
    await logActivity(env, user.id, { queueId: id, company: row.company, title: row.title,
      kind: "note", message: "Moved back to pending in To-Apply." });
    return json({ ok: true, id, status: "pending" });
  }

  // ---- correct a queue row's fields (fix a placeholder title/location/url, add
  //      notes or docs) without deleting and re-adding. Company + title are the
  //      identity, but a role queued before its title was known needs fixing.
  if (action === "update") {
    const set: string[] = [], vals: any[] = [];
    const put = (col: string, v: any, max: number) => {
      if (v !== undefined) { set.push(`${col} = ?`); vals.push(v === null ? null : String(v).trim().slice(0, max) || null); }
    };
    put("title", body.title, 300); put("location", body.location, 200); put("url", body.url, 1000);
    put("notes", body.notes, 2000); put("resume_url", body.resumeUrl, 1000); put("cover_url", body.coverUrl, 1000);
    if (body.priority !== undefined) { set.push("priority = ?"); vals.push(Number(body.priority) || 0); }
    if (!set.length) return err(400, "Provide at least one of: title, location, url, notes, resumeUrl, coverUrl, priority.");
    vals.push(id);
    await env.DB.prepare(`UPDATE apply_queue SET ${set.join(", ")} WHERE id = ?`).bind(...vals).run();
    await logActivity(env, user.id, { queueId: id, company: row.company, title: body.title ?? row.title,
      kind: "note", message: `Updated ${set.map((s) => s.split(" = ")[0]).join(", ")} in To-Apply.` });
    return json({ ok: true, id, updated: set.map((s) => s.split(" = ")[0]) });
  }

  if (action === "applied") {
    // Promote into the live tracker: create a job + application (status 'applied')
    // exactly like a manually-logged application, and link it back.
    const at = (typeof body.appliedAt === "string" && body.appliedAt.length <= 40 && !Number.isNaN(Date.parse(body.appliedAt)))
      ? body.appliedAt : nowEastern();   // caller's stamp verbatim, else Eastern-offset now
    const jobUuid = "queue:" + uuid();
    const appUuid = uuid();
    const jobId = row.job_id || canonicalJobId({ company: row.company, title: row.title, location: row.location, url: row.url });
    await env.DB.prepare(
      `INSERT INTO jobs (uuid, source, external_id, title, company_name, location, remote, url, apply_url, description, job_id, created_at)
       VALUES (?, 'queue', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`
    ).bind(jobUuid, id, row.title, row.company, row.location, row.url || "", row.url || null,
           row.notes ? `From To-Apply queue. ${row.notes}` : "From To-Apply queue.", jobId, now).run();
    await env.DB.prepare(
      `INSERT INTO applications_v2 (uuid, user_id, job_uuid, status, need_manual_apply, match_score, resume_url, cover_url, job_id, submitted_at, created_at, updated_at)
       VALUES (?, ?, ?, 'applied', 0, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(appUuid, user.id, jobUuid, row.match_score == null ? null : row.match_score / 100,
           row.resume_url || null, row.cover_url || null, jobId, at, now, now).run();
    await env.DB.prepare("UPDATE apply_queue SET status = 'applied', application_uuid = ?, applied_at = ? WHERE id = ?")
      .bind(appUuid, at, id).run();
    // Carry the queue's timeline onto the application, then log the promotion.
    await env.DB.prepare("UPDATE activity_log SET application_uuid = ? WHERE queue_id = ? AND user_id = ?")
      .bind(appUuid, id, user.id).run().catch(() => {});
    await logActivity(env, user.id, { applicationUuid: appUuid, queueId: id, company: row.company, title: row.title,
      kind: "applied", message: "Marked applied — promoted from To-Apply into Applications." });
    return json({ ok: true, id, status: "applied", applicationUuid: appUuid });
  }

  return err(400, `Unknown action "${action}". Valid actions: applied, skipped, reset, update.`);
};
