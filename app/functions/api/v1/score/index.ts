// POST /api/v1/score  { jobs: [ {title, company, location, remote, salaryMin,
//   salaryMax, description, postedAt} ] }  (or { job: {...} } for one)
// -> { scores: [ { title, company, score (0-100), onField, breakdown, compFlag,
//      missing } ] } using the SAME engine as Jobs For You. Lets Cowork show
// the authoritative match % before deciding what to queue.
import { json, err, currentUser, type Env, type CtxUser } from "../../_lib";
import { scoringProfile, scoreJob, type JobForMatch } from "../../_match";

export const onRequestPost: PagesFunction<Env, string, { user?: CtxUser }> = async ({ request, env, data }) => {
  const user = currentUser(data);
  let body: any;
  try { body = await request.json(); } catch { return err(400, "Invalid JSON body."); }
  const jobs: any[] = Array.isArray(body?.jobs) ? body.jobs : (body?.job ? [body.job] : []);
  if (!jobs.length) return err(400, "Provide jobs[] (or a single job).");

  const profile = await scoringProfile(env, user.id);

  const scores = jobs.slice(0, 200).map((j) => {
    const jm: JobForMatch = {
      title: String(j.title || ""), company: j.company || null, location: j.location || null,
      remote: !!j.remote, salaryMin: j.salaryMin ?? null, salaryMax: j.salaryMax ?? null,
      description: j.description || null, postedAt: j.postedAt || null,
    };
    const m = scoreJob(profile, jm);
    return {
      title: jm.title, company: jm.company,
      score: Math.round(m.total * 100), onField: m.onField,
      breakdown: { skills: Math.round(m.skills * 100), experience: Math.round(m.experience * 100), compensation: Math.round(m.compensation * 100) },
      compFlag: m.compFlag, missing: m.missing,
    };
  });
  return json({ scores });
};
