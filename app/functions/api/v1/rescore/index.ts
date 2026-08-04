// POST /api/v1/rescore  -> recompute the STORED match score on every To-Apply
// queue row and every application, using the current engine + profile + résumé.
//
// The feed re-scores itself each sweep, but the queue and applications keep a
// frozen snapshot from when the job was added. After a scoring change those
// snapshots drift stale (a role reading 28% in To-Apply while the feed says
// 88%). This rewrites them in place so every surface agrees. Idempotent.
import { json, currentUser, type Env, type CtxUser } from "../../_lib";
import { scoringProfile, scoreJob, type JobForMatch } from "../../_match";
import { canonicalJobId } from "../../_jobid";

export const onRequestPost: PagesFunction<Env, string, { user?: CtxUser }> = async ({ env, data }) => {
  const user = currentUser(data);
  const profile = await scoringProfile(env, user.id);
  const score = (j: { title: string; company: string | null; location?: string | null; remote?: number | boolean;
                      salaryMin?: number | null; salaryMax?: number | null; description?: string | null }) => {
    const jm: JobForMatch = {
      title: j.title || "", company: j.company || null, location: j.location || null,
      remote: !!j.remote, salaryMin: j.salaryMin ?? null, salaryMax: j.salaryMax ?? null,
      description: j.description || null, postedAt: null,
    };
    return scoreJob(profile, jm).total;   // 0..1
  };

  // ---- To-Apply queue (match_score stored 0..100) ----
  const q = await env.DB.prepare(
    "SELECT id, title, company, location, salary_min, salary_max, description FROM apply_queue WHERE user_id = ? AND status = 'pending'"
  ).bind(user.id).all<any>();
  const qStmts = (q.results ?? []).map((r) =>
    env.DB.prepare("UPDATE apply_queue SET match_score = ? WHERE id = ?")
      .bind(Math.round(score({ ...r, salaryMin: r.salary_min, salaryMax: r.salary_max }) * 100), r.id));

  // ---- applications (match_score stored 0..1) ----
  const a = await env.DB.prepare(
    `SELECT a.uuid, j.title, j.company_name AS company, j.location, j.remote, j.salary_min, j.salary_max, j.description
       FROM applications_v2 a JOIN jobs j ON j.uuid = a.job_uuid
      WHERE a.user_id = ? AND a.status != 'discarded'`
  ).bind(user.id).all<any>();
  const aStmts = (a.results ?? []).map((r) =>
    env.DB.prepare("UPDATE applications_v2 SET match_score = ? WHERE uuid = ?")
      .bind(score({ ...r, salaryMin: r.salary_min, salaryMax: r.salary_max }), r.uuid));

  // ---- backfill canonical job_id everywhere it's still null ----
  const jobRows = await env.DB.prepare(
    "SELECT uuid, title, company_name AS company, location, remote, url, apply_url, ats, ats_token, ats_job_id FROM jobs WHERE job_id IS NULL OR job_id = ''"
  ).all<any>();
  const jStmts = (jobRows.results ?? []).map((r) =>
    env.DB.prepare("UPDATE jobs SET job_id = ? WHERE uuid = ?").bind(canonicalJobId({
      company: r.company, title: r.title, location: r.location, remote: r.remote,
      url: r.url, applyUrl: r.apply_url, ats: r.ats, atsToken: r.ats_token, atsJobId: r.ats_job_id,
    }), r.uuid));
  // queue + applications inherit from their linked job where possible, else derive
  const qidStmts = (q.results ?? []).map((r) =>
    env.DB.prepare("UPDATE apply_queue SET job_id = ? WHERE id = ? AND (job_id IS NULL OR job_id = '')")
      .bind(canonicalJobId({ company: r.company, title: r.title, location: r.location, url: r.url }), r.id));
  const aidStmts = (a.results ?? []).map((r) =>
    env.DB.prepare("UPDATE applications_v2 SET job_id = ? WHERE uuid = ? AND (job_id IS NULL OR job_id = '')")
      .bind(canonicalJobId({ company: r.company, title: r.title, location: r.location, remote: r.remote, url: r.url }), r.uuid));

  const all = [...qStmts, ...aStmts, ...jStmts, ...qidStmts, ...aidStmts];
  for (let i = 0; i < all.length; i += 40) await env.DB.batch(all.slice(i, i + 40));

  return json({ ok: true, queueRescored: qStmts.length, applicationsRescored: aStmts.length,
    jobIdsBackfilled: jStmts.length + qidStmts.length + aidStmts.length });
};
