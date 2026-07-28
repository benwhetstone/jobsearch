// The sweep engine. Builds the user's query, hits every configured source in
// parallel, dedupes across sources, scores each job against the user's profile,
// and stores the results as that user's matches. Called two ways:
//   - POST /api/v1/jobs/refresh (the search bar)
//   - automatically on the first login of the day (auth/me), so opportunities
//     are WAITING when the user arrives. Surfacing is the product; search is
//     just the refinement control.
import type { Env } from "./_lib";
import { fetchAllSources, dedupeKey, scamScore, boardFrom, type RawJob, type SearchQuery } from "./_jobs";
import { buildProfileForMatch, scoreJob, type JobForMatch } from "./_match";

const MAX_MATCHES = 60;   // cap stored matches per refresh so the list stays useful

interface PrefRow { keywords: string | null; location: string | null; remote_only: number; salary_min: number | null; radius_mi: number | null; country: string | null; }

export interface SweepResult {
  ok: boolean; error?: string;
  query?: { keywords: string; location: string | null; remoteOnly: boolean; country: string };
  sources?: Record<string, number>;
  fetched?: number; deduped?: number; matched?: number; refreshedAt?: string;
}

export async function runSweep(env: Env, userId: string, origin: "auto" | "search" = "auto"): Promise<SweepResult> {
  const user = { id: userId };

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
      // One title only: concatenating several ("Data Analyst Operations & Data
      // Analyst Business Analyst") reads as ALL-words-required on Adzuna and
      // Careerjet and returns nothing.
      keywords = String(titles.map((x) => x?.name).filter(Boolean)[0] || "");
    } catch { /* ignore */ }
  }
  if (!keywords) return { ok: false, error: "Set what you're searching for first (a job title or keywords)." };

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

  // keep the strongest, drop obvious scams, hard pay-floor rejects, and
  // on-site roles nowhere near the user (terms <= 0.2 means a geographic
  // impossibility, not a preference mismatch)
  const keep = scored
    .filter((s) => s.scam < 2 && s.match.compFlag !== "dropped" && s.match.terms > 0.2)
    // relevance floor: a job with neither a skills connection nor a title
    // connection is noise, no matter how well it pays
    .filter((s) => s.match.skills >= 0.25 || s.match.experience >= 0.5)
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
         comp_flag, missing_json, status, origin, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?, 'matched', ?, ?)
       ON CONFLICT(user_id, job_uuid) DO UPDATE SET
         origin=excluded.origin,
         total_score=excluded.total_score, skills=excluded.skills, experience=excluded.experience,
         compensation=excluded.compensation, terms=excluded.terms, company=excluded.company,
         comp_flag=excluded.comp_flag, missing_json=excluded.missing_json,
         status=CASE WHEN matches.status IN ('applied','hidden','skipped') THEN matches.status ELSE 'matched' END`
    ).bind(
      user.id, s.uuid, m.total, m.skills, m.experience, m.compensation, m.terms, m.company,
      m.compFlag, JSON.stringify(m.missing), origin, now
    ));
  }
  // D1 batch has a statement cap; chunk to be safe.
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));

  // ---- auto-apply capability, resolved now instead of at click time ----
  // globalwork's model: the feed says up front which jobs autopilot can file
  // directly (hasModernAutoApply). Resolve each new company's board against
  // the supported ATSs; hits and misses both cache in ats_boards.
  await tagAutoApply(env, keep.map((s) => ({ uuid: s.uuid, company: s.job.company })));

  return {
    ok: true,
    query: { keywords, location: q.location || null, remoteOnly: !!q.remoteOnly, country: q.country || "us" },
    sources: bySource,
    fetched: raw.length,
    deduped: deduped.length,
    matched: keep.length,
    refreshedAt: now,
  };
}

// Resolve which of these jobs autopilot can file directly. Bounded: at most
// 20 uncached company lookups per sweep so a big result set can't stall it —
// the rest resolve on the next sweep (ats_boards caches hits AND misses).
async function tagAutoApply(env: Env, jobs: { uuid: string; company: string | null }[]): Promise<void> {
  const { resolveBoard } = await import("./_ats");
  const seen = new Map<string, { ats: string | null; token: string | null }>();
  let lookups = 0;
  const updates: D1PreparedStatement[] = [];
  for (const j of jobs) {
    if (!j.company) continue;
    const key = j.company.toLowerCase();
    let hit = seen.get(key);
    if (!hit) {
      if (lookups >= 20) continue;
      lookups++;
      try {
        const board = await resolveBoard(env, j.company);
        hit = { ats: board?.ats ?? null, token: board?.token ?? null };
      } catch { hit = { ats: null, token: null }; }
      seen.set(key, hit);
    }
    const supported = hit.ats && ["greenhouse", "lever", "ashby"].includes(hit.ats) ? 1 : 0;
    updates.push(env.DB.prepare("UPDATE jobs SET auto_apply = ?, ats = ?, ats_token = ? WHERE uuid = ?")
      .bind(supported, hit.ats, hit.token, j.uuid));
  }
  for (let i = 0; i < updates.length; i += 50) await env.DB.batch(updates.slice(i, i + 50));
}

// Run the daily sweep at most once per user per day. Returns true if a sweep
// was started by this call.
export async function ensureDailySweep(env: Env, userId: string): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  const setting = await env.DB.prepare("SELECT auto_sweep FROM user_settings WHERE user_id = ?")
    .bind(userId).first<{ auto_sweep: number }>().catch(() => null);
  if (setting && !setting.auto_sweep) return false;
  const done = await env.DB.prepare("SELECT 1 AS x FROM daily_sweeps WHERE user_id = ? AND sweep_day = ?")
    .bind(userId, day).first().catch(() => null);
  if (done) return false;
  // claim the day first so concurrent logins don't double-run
  await env.DB.prepare("INSERT OR IGNORE INTO daily_sweeps (user_id, sweep_day, found, ran_at) VALUES (?, ?, 0, ?)")
    .bind(userId, day, new Date().toISOString()).run();
  const res = await runSweep(env, userId, "auto").catch(() => ({ ok: false } as SweepResult));
  if (res.ok) {
    await env.DB.prepare("UPDATE daily_sweeps SET found = ?, ran_at = ? WHERE user_id = ? AND sweep_day = ?")
      .bind(res.matched ?? 0, new Date().toISOString(), userId, day).run();
  }
  return true;
}
