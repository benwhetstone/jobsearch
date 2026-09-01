// GET /api/v1/jobs/:uuid — one job in full, for the in-page detail view.
// The match list carries a snippet; this returns the whole stored description
// plus this user's score breakdown so the detail screen never leaves the app.
import { json, err, currentUser, type Env, type CtxUser } from "../../_lib";

export const onRequestGet: PagesFunction<Env, string, { user?: CtxUser }> = async ({ params, env, data }) => {
  const user = currentUser(data);
  const uuid = String(params.uuid);
  const job = await env.DB.prepare(
    `SELECT uuid, source, title, company_name, location, remote, salary_min, salary_max,
            salary_currency, url, apply_url, board, category, description, posted_at
       FROM jobs WHERE uuid = ?`
  ).bind(uuid).first<any>();
  if (!job) return err(404, "No such job.");

  const m = await env.DB.prepare(
    "SELECT total_score, skills, experience, compensation, terms, company, comp_flag, missing_json, status FROM matches WHERE user_id = ? AND job_uuid = ?"
  ).bind(user.id, uuid).first<any>();
  const app = await env.DB.prepare(
    "SELECT uuid, status FROM applications_v2 WHERE user_id = ? AND job_uuid = ?"
  ).bind(user.id, uuid).first<any>();

  const pct = (n: number | null) => Math.round((n ?? 0) * 100);
  return json({
    job: {
      uuid: job.uuid, source: job.source, title: job.title, company: job.company_name,
      location: job.location, remote: !!job.remote,
      salaryMin: job.salary_min, salaryMax: job.salary_max, currency: job.salary_currency,
      url: job.url, applyUrl: job.apply_url || job.url, board: job.board,
      category: job.category, description: job.description || "", postedAt: job.posted_at,
    },
    match: m ? {
      totalScore: pct(m.total_score),
      rankers: { skills: pct(m.skills), experience: pct(m.experience), compensation: pct(m.compensation),
                 terms: pct(m.terms), company: pct(m.company) },
      compFlag: m.comp_flag,
      missing: (() => { try { return JSON.parse(m.missing_json || "[]"); } catch { return []; } })(),
      status: m.status,
    } : null,
    application: app ? { uuid: app.uuid, status: app.status } : null,
  });
};
