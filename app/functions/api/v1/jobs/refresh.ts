// POST /api/v1/jobs/refresh
// The engine. Builds the user's query, hits every configured source in parallel,
// dedupes across sources, scores each job against the user's profile, and stores
// the results as this user's matches. This is what "populate matches on first
// login of the day" calls. It never applies to anything — it only surfaces work.
import { json, err, currentUser, type Env, type CtxUser } from "../../_lib";
import { fetchAllSources, dedupeKey, scamScore, boardFrom, type RawJob, type SearchQuery } from "../../_jobs";
import { buildProfileForMatch, scoreJob, type JobForMatch } from "../../_match";

const MAX_MATCHES = 60;   // cap stored matches per refresh so the list stays useful

interface PrefRow { keywords: string | null; location: string | null; remote_only: number; salary_min: number | null; radius_mi: number | null; country: string | null; }

export const onRequestPost: PagesFunction<Env, string, { user?: CtxUser }> = async ({ env, data }) => {
  const user = currentUser(data);

  // ---- build the query from saved prefs, falling back to profile titles ----
  const prefs = await env.DB.prepare(
    "SELECT keywords, location, remote_only, salary_min, radius_mi, country FROM search_prefs WHERE user_id = ?"
  ).bind(user.id).first<PrefRow>();

  const values = await env.DB.prepare("SELECT field_key, value_json FROM profile_values WHERE user_id = ?")
    .bind(user.id).all<{ field_key: string; value_json: string | null }>();
  const valueMap: Record<string, string | null> = {};
  for (const v of values.results ?? []) valueMap[v.field_key] = v.value_json;

  let keywords = (prefs?.keywords || "").trim();
  if (!keywords) {
    try {
      const titles = JSON.parse(valueMap.st_jobTitles || "[]") as any[];
      keywords = titles.map((x) => x?.name).filter(Boolean).slice(0, 3).join(" ");
    } catch { /* ignore */ }
  }
  if (!keywords) return err(400, "Set what you're searching for first (a job title or keywords).");

  // Location comes from two free-text profile fields (city + state); the search
  // pref can override with a single "City, ST" string.
  const str = (k: string) => { const v = valueMap[k]; if (v == null) return null; try { const p = JSON.parse(v); return typeof p === "string" ? p : null; } catch { return v; } };
  const profileCity = str("city");
  const profileLoc = [profileCity, str("state")].filter(Boolean).join(", ");

  const q: SearchQuery = {
    keywords,
    location: prefs?.location || profileLoc || undefined,
    remoteOnly: !!prefs?.remote_only,
    salaryMin: prefs?.salary_min ?? null,
    radiusMi: prefs?.radius_mi ?? null,
    country: prefs?.country || "us",
  };

  // ---- fan out to every source ----
  const { jobs: raw, sources } = await fetchAllSources(env, q);

  // ---- dedupe across sources (collapse same company+title+city to one) ----
  const bySource: Record<string, number> = { ...sources };
  const canonical = new Map<string, RawJob>();
  const better = (a: RawJob, b: RawJob) =>
    ((b.salaryMax ? 1 : 0) - (a.salaryMax ? 1 : 0)) ||
    ((b.description?.length || 0) - (a.description?.length || 0));
  for (const j of raw) {
    const key = dedupeKey(j.company, j.title, j.location);
    const cur = canonical.get(key);
    if (!cur || better(cur, j) < 0) canonical.set(key, j);
  }
  const deduped = [...canonical.values()];

  // ---- score every job against the profile ----
  const profile = buildProfileForMatch(valueMap, {
    remoteOnly: !!prefs?.remote_only,
    salaryMin: prefs?.salary_min ?? null,
    locationCity: profileCity,
  });

  const now = new Date().toISOString();
  const scored = deduped.map((j) => {
    const jm: JobForMatch = {
      title: j.title, company: j.company, location: j.location, remote: j.remote,
      salaryMin: j.salaryMin, salaryMax: j.salaryMax, description: j.description || null,
      postedAt: j.postedAt || null,
    };
    return { job: j, uuid: `${j.source}:${j.externalId}`, scam: scamScore(j), match: scoreJob(profile, jm) };
  });

  // keep the strongest, drop obvious scams and hard pay-floor rejects
  const keep = scored
    .filter((s) => s.scam < 2 && s.match.compFlag !== "dropped")
    .sort((a, b) => b.match.total - a.match.total)
    .slice(0, MAX_MATCHES);

  // ---- persist: upsert jobs, then this user's matches ----
  const stmts: D1PreparedStatement[] = [];
  for (const s of keep) {
    const j = s.job;
    stmts.push(env.DB.prepare(
      `INSERT INTO jobs (uuid, source, external_id, title, company_name, location, remote,
         salary_min, salary_max, salary_currency, url, apply_url, board, category, description,
         posted_at, scam_score, dedupe_key, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(uuid) DO UPDATE SET
         title=excluded.title, company_name=excluded.company_name, location=excluded.location,
         remote=excluded.remote, salary_min=excluded.salary_min, salary_max=excluded.salary_max,
         salary_currency=excluded.salary_currency, url=excluded.url, apply_url=excluded.apply_url,
         board=excluded.board, category=excluded.category, description=excluded.description,
         posted_at=excluded.posted_at, scam_score=excluded.scam_score, dedupe_key=excluded.dedupe_key`
    ).bind(
      s.uuid, j.source, j.externalId, j.title, j.company, j.location, j.remote ? 1 : 0,
      j.salaryMin, j.salaryMax, j.currency, j.url, j.applyUrl || j.url, boardFrom(j.applyUrl || j.url),
      j.category || null, j.description || null, j.postedAt || null, s.scam,
      dedupeKey(j.company, j.title, j.location), now
    ));
    const m = s.match;
    stmts.push(env.DB.prepare(
      `INSERT INTO matches (user_id, job_uuid, total_score, skills, experience, compensation, terms, company,
         comp_flag, missing_json, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?, 'matched', ?)
       ON CONFLICT(user_id, job_uuid) DO UPDATE SET
         total_score=excluded.total_score, skills=excluded.skills, experience=excluded.experience,
         compensation=excluded.compensation, terms=excluded.terms, company=excluded.company,
         comp_flag=excluded.comp_flag, missing_json=excluded.missing_json,
         status=CASE WHEN matches.status IN ('applied','hidden','skipped') THEN matches.status ELSE 'matched' END`
    ).bind(
      user.id, s.uuid, m.total, m.skills, m.experience, m.compensation, m.terms, m.company,
      m.compFlag, JSON.stringify(m.missing), now
    ));
  }
  // D1 batch has a statement cap; chunk to be safe.
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));

  return json({
    query: { keywords, location: q.location || null, remoteOnly: q.remoteOnly, country: q.country },
    sources: bySource,
    fetched: raw.length,
    deduped: deduped.length,
    matched: keep.length,
    refreshedAt: now,
  });
};
