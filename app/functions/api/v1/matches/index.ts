// GET   /api/v1/matches            -> this user's ranked matches (with the job)
// PATCH /api/v1/matches            -> { jobUuid, status } to skip/hide/mark applied
//
// Scores are stored 0..1 and surfaced 0..100 with the explanation band, so the
// UI can always say WHY a job scored the way it did.
import { json, err, currentUser, type Env, type CtxUser } from "../../_lib";

const VALID_STATUS = new Set(["matched", "skipped", "applied", "hidden", "queued"]);

interface Row {
  job_uuid: string; total_score: number; skills: number; experience: number;
  compensation: number; terms: number; company: number; comp_flag: string | null;
  missing_json: string | null; status: string; created_at: string;
  title: string; company_name: string | null; location: string | null; remote: number;
  salary_min: number | null; salary_max: number | null; salary_currency: string | null;
  url: string; apply_url: string | null; board: string | null; source: string;
  posted_at: string | null; description: string | null;
}

const pct = (n: number | null) => Math.round((n ?? 0) * 100);

export const onRequestGet: PagesFunction<Env, string, { user?: CtxUser }> = async ({ request, env, data }) => {
  const user = currentUser(data);
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "matched";
  // origin: "all", one origin, or a comma list ("cowork,auto"). A list keeps
  // Cowork suggestions and the site's own sweep in one Jobs-For-You view.
  const originParam = url.searchParams.get("origin") || "all";
  const origins = originParam === "all" ? null : originParam.split(",").map((s) => s.trim()).filter(Boolean);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 50));

  const originClause = origins ? `AND m.origin IN (${origins.map(() => "?").join(",")})` : "";
  const rows = await env.DB.prepare(
    `SELECT m.job_uuid, m.total_score, m.skills, m.experience, m.compensation, m.terms, m.company,
            m.comp_flag, m.missing_json, m.status, m.created_at, m.origin, m.note,
            j.title, j.company_name, j.location, j.remote, j.salary_min, j.salary_max, j.salary_currency,
            j.url, j.apply_url, j.board, j.source, j.posted_at, j.description, j.auto_apply, j.job_id, j.experience, j.skills_json, j.arrangement, j.created_at AS job_created_at
       FROM matches m JOIN jobs j ON j.uuid = m.job_uuid
      WHERE m.user_id = ? AND (? = 'all' OR m.status = ?) ${originClause}
      ORDER BY m.total_score DESC
      LIMIT ?`
  ).bind(user.id, status, status, ...(origins ?? []), limit).all<Row>();

  const out = (rows.results ?? []).map((r) => ({
    jobUuid: r.job_uuid,
    status: r.status,
    totalScore: pct(r.total_score),
    rankers: {
      skills: pct(r.skills), experience: pct(r.experience), compensation: pct(r.compensation),
      terms: pct(r.terms), company: pct(r.company),
    },
    compFlag: r.comp_flag,
    origin: (r as any).origin,
    note: (r as any).note || null,
    missing: (() => { try { return JSON.parse(r.missing_json || "[]"); } catch { return []; } })(),
    job: {
      title: r.title, company: r.company_name, location: r.location, remote: !!r.remote,
      salaryMin: r.salary_min, salaryMax: r.salary_max, currency: r.salary_currency,
      url: r.url, applyUrl: r.apply_url || r.url, board: r.board, source: r.source,
      postedAt: r.posted_at, jobId: (r as any).job_id || null,
      experience: (r as any).experience || null,
      skills: (() => { try { return JSON.parse((r as any).skills_json || "[]"); } catch { return []; } })(),
      arrangement: (r as any).arrangement || (r.remote ? "remote" : null),
      snippet: (r.description || "").slice(0, 320),
      // null = capability not resolved yet; true = autopilot can file it directly
      autoApply: (r as any).auto_apply == null ? null : !!(r as any).auto_apply,
      firstSeenAt: (r as any).job_created_at || null,
    },
    matchedAt: r.created_at,
  }));

  const counts = await env.DB.prepare(
    "SELECT status, COUNT(*) AS n FROM matches WHERE user_id = ? GROUP BY status"
  ).bind(user.id).all<{ status: string; n: number }>();
  const byStatus: Record<string, number> = {};
  for (const c of counts.results ?? []) byStatus[c.status] = c.n;

  return json({ matches: out, counts: byStatus }, { totalRecords: out.length });
};

async function patch(request: Request, env: Env, user: CtxUser): Promise<Response> {
  let body: any;
  try { body = await request.json(); } catch { return err(400, "Invalid JSON body."); }
  const jobUuid = String(body.jobUuid || "");
  const status = String(body.status || "");
  if (!jobUuid) return err(400, "jobUuid is required.");
  if (!VALID_STATUS.has(status)) return err(400, `status must be one of: ${[...VALID_STATUS].join(", ")}`);

  const res = await env.DB.prepare("UPDATE matches SET status = ? WHERE user_id = ? AND job_uuid = ?")
    .bind(status, user.id, jobUuid).run();
  if (!res.meta?.changes) return err(404, "No such match for this user.");
  return json({ jobUuid, status });
}

export const onRequestPatch: PagesFunction<Env, string, { user?: CtxUser }> = ({ request, env, data }) =>
  patch(request, env, currentUser(data));
export const onRequestPost: PagesFunction<Env, string, { user?: CtxUser }> = ({ request, env, data }) =>
  patch(request, env, currentUser(data));
