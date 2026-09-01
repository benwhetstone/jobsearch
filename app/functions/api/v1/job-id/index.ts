// POST /api/v1/job-id  -> the canonical job_id for a posting.
//   { company, title, location?, remote?, url?, applyUrl?, ats?, atsToken?, atsJobId? }
//   (or { jobs: [ ...same... ] } for a batch)
// -> { jobId } or { jobIds: [...] }
//
// The server owns the identity algorithm (functions/api/_jobid.ts). Cowork and
// any other client MUST call this to get a job's id rather than inventing one,
// so the same posting resolves to the same id at every step (feed, queue,
// apply). ATS-anchored when a requisition is known; a deterministic signature
// otherwise. Same input always yields the same id.
import { json, err, currentUser, type Env, type CtxUser } from "../../_lib";
import { canonicalJobId, type JobIdInput } from "../../_jobid";

const pick = (j: any): JobIdInput => ({
  company: j?.company ?? null, title: j?.title ?? null, location: j?.location ?? null,
  remote: j?.remote ?? null, url: j?.url ?? null, applyUrl: j?.applyUrl ?? j?.apply_url ?? null,
  ats: j?.ats ?? null, atsToken: j?.atsToken ?? j?.ats_token ?? null, atsJobId: j?.atsJobId ?? j?.ats_job_id ?? null,
});

export const onRequestPost: PagesFunction<Env, string, { user?: CtxUser }> = async ({ request, env, data }) => {
  currentUser(data); // auth required (middleware), single-user identity not needed here
  let body: any;
  try { body = await request.json(); } catch { return err(400, "Invalid JSON body."); }
  if (Array.isArray(body?.jobs)) {
    return json({ jobIds: body.jobs.slice(0, 500).map((j: any) => canonicalJobId(pick(j))) });
  }
  if (!body?.company && !body?.title && !body?.url && !body?.applyUrl) {
    return err(400, "Provide at least company+title (or a posting url).");
  }
  return json({ jobId: canonicalJobId(pick(body)) });
};
