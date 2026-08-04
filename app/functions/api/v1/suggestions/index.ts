// POST /api/v1/suggestions  -> Cowork's post-sweep picks, written straight into
// Jobs For You (matches, origin='cowork') so Ben evaluates them in the app's
// card format — score, salary, job_id, original-posting link, why-it-fits — and
// clicks "Add to To-Apply". This is how Cowork hands off suggestions; it does
// NOT put anything on the To-Apply worklist itself (that needs Ben's click).
//
//   { jobs: [ { company, title, url, applyUrl?, location?, remote?, salaryMin?,
//               salaryMax?, description?, postedAt?, source?, score?, note? } ] }
//   -> { ok, added, jobIds: [...] }
//
// score (0-100) is Cowork's; omitted -> the site scores it with the same engine
// as the feed. note is the one-line "why it fits" shown on the card.
import { json, err, currentUser, type Env, type CtxUser } from "../../_lib";
import { scoringProfile, scoreJob } from "../../_match";
import { canonicalJobId } from "../../_jobid";

const uuid = () => crypto.randomUUID();

export const onRequestPost: PagesFunction<Env, string, { user?: CtxUser }> = async ({ request, env, data }) => {
  const user = currentUser(data);
  let body: any;
  try { body = await request.json(); } catch { return err(400, "Invalid JSON body."); }
  const items = Array.isArray(body?.jobs) ? body.jobs : (body?.company || body?.title ? [body] : []);
  if (!items.length) return err(400, "Provide jobs[] (each with at least company + title).");

  const profile = await scoringProfile(env, user.id);
  const now = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];
  const jobIds: string[] = [];
  let added = 0;

  for (const it of items) {
    const company = String(it?.company || "").trim();
    const title = String(it?.title || "").trim();
    if (!company || !title) continue;
    const url = String(it?.url || it?.applyUrl || "").trim();
    const applyUrl = String(it?.applyUrl || it?.url || "").trim();
    const location = String(it?.location || "").trim() || null;
    const remote = it?.remote ? 1 : 0;
    const sMin = it?.salaryMin ?? null, sMax = it?.salaryMax ?? null;
    const desc = it?.description ? String(it.description).slice(0, 8000) : null;
    const note = it?.note ? String(it.note).slice(0, 500) : null;
    const jobId = String(it?.jobId || "").trim() || canonicalJobId({ company, title, location, remote, url, applyUrl });
    jobIds.push(jobId);

    // Skip anything Ben already dismissed / queued / applied — same job_id rule
    // as the sweep, so a suggestion can't resurrect something he killed.
    const acted = await env.DB.prepare(
      `SELECT 1 FROM matches m JOIN jobs j ON j.uuid = m.job_uuid
        WHERE m.user_id = ? AND j.job_id = ? AND m.status IN ('skipped','hidden','applied','queued') LIMIT 1`
    ).bind(user.id, jobId).first();
    if (acted) continue;

    const score = it?.score != null && Number.isFinite(Number(it.score))
      ? Math.max(0, Math.min(1, Number(it.score) / 100))
      : scoreJob(profile, { title, company, location, remote: !!remote, salaryMin: sMin, salaryMax: sMax, description: desc, postedAt: it?.postedAt || null }).total;

    // Stable job uuid per suggestion so re-posting the same pick updates in place.
    const jobUuid = "cowork:" + jobId;
    stmts.push(env.DB.prepare(
      `INSERT INTO jobs (uuid, source, external_id, title, company_name, location, remote,
         salary_min, salary_max, url, apply_url, description, posted_at, job_id, created_at)
       VALUES (?, 'cowork', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(uuid) DO UPDATE SET
         title=excluded.title, company_name=excluded.company_name, location=excluded.location,
         remote=excluded.remote, salary_min=excluded.salary_min, salary_max=excluded.salary_max,
         url=excluded.url, apply_url=excluded.apply_url, description=excluded.description,
         posted_at=excluded.posted_at, job_id=excluded.job_id`
    ).bind(jobUuid, jobId, title, company, location, remote, sMin, sMax, url || "", applyUrl || url || null,
           desc, it?.postedAt || null, jobId, now));
    stmts.push(env.DB.prepare(
      `INSERT INTO matches (user_id, job_uuid, total_score, skills, experience, compensation, terms, company,
         comp_flag, missing_json, status, origin, note, created_at)
       VALUES (?, ?, ?, 0, 0, 0, 0, 0, 'ok', '[]', 'matched', 'cowork', ?, ?)
       ON CONFLICT(user_id, job_uuid) DO UPDATE SET
         total_score=excluded.total_score, note=excluded.note, origin='cowork',
         status=CASE WHEN matches.status IN ('applied','hidden','skipped','queued') THEN matches.status ELSE 'matched' END`
    ).bind(user.id, jobUuid, score, note, now));
    added++;
  }
  if (!added) return err(400, "Nothing to add (each job needs company + title; already-dismissed jobs are skipped).");
  for (let i = 0; i < stmts.length; i += 40) await env.DB.batch(stmts.slice(i, i + 40));
  return json({ ok: true, added, jobIds });
};
