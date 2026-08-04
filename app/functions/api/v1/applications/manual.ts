// POST /api/v1/applications/manual
//   { company, title, url?, location?, status?, appliedAt? }
// Log an application you submitted yourself, off-platform (straight on the
// employer's site). Creates a minimal 'manual' job row and an application
// already in the given stage (default 'applied'), so your own applications
// live in the same funnel as the autopiloted ones.
import { json, err, currentUser, logActivity, type Env, type CtxUser } from "../../_lib";
import { canonicalJobId } from "../../_jobid";

const uuid = () => crypto.randomUUID();
const STAGES = ["applied", "interview", "offer", "rejected"];

export const onRequestPost: PagesFunction<Env, string, { user?: CtxUser }> = async ({ request, env, data }) => {
  const user = currentUser(data);
  let body: any;
  try { body = await request.json(); } catch { return err(400, "Invalid JSON body."); }

  const company = String(body?.company || "").trim();
  const title = String(body?.title || "").trim();
  if (!company || !title) return err(400, "Company and job title are required.");

  const url = String(body?.url || "").trim();
  const location = String(body?.location || "").trim() || null;
  const status = STAGES.includes(body?.status) ? body.status : "applied";
  // Store the caller's timestamp VERBATIM when it's valid ISO (keeps its offset
  // so an evening-Eastern submit doesn't roll to the next UTC day); else now.
  const appliedAt = (typeof body?.appliedAt === "string" && body.appliedAt.length <= 40 && !Number.isNaN(Date.parse(body.appliedAt)))
    ? body.appliedAt : new Date().toISOString();
  const now = new Date().toISOString();

  const jobUuid = "manual:" + uuid();
  const appUuid = uuid();
  const jobId = String(body?.jobId || "").trim() || canonicalJobId({ company, title, location, url });

  await env.DB.prepare(
    `INSERT INTO jobs (uuid, source, external_id, title, company_name, location, remote, url, apply_url, description, job_id, created_at)
     VALUES (?, 'manual', ?, ?, ?, ?, 0, ?, ?, 'Logged manually — applied off-platform.', ?, ?)`
  ).bind(jobUuid, appUuid, title, company, location, url || "", url || null, jobId, now).run();

  const resumeUrl = String(body?.resumeUrl || "").trim() || null;
  const coverUrl = String(body?.coverUrl || "").trim() || null;
  await env.DB.prepare(
    `INSERT INTO applications_v2 (uuid, user_id, job_uuid, status, need_manual_apply, resume_url, cover_url, job_id, submitted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`
  ).bind(appUuid, user.id, jobUuid, status, resumeUrl, coverUrl, jobId, appliedAt, appliedAt, now).run();

  await logActivity(env, user.id, { applicationUuid: appUuid, company, title, kind: "applied",
    message: `Logged manually as “${status}”${body?.notes ? ` — ${String(body.notes).slice(0, 200)}` : ""}.` });
  return json({ uuid: appUuid, status });
};
