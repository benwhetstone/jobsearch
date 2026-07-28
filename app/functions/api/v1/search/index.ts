// GET  /api/v1/search  -> the user's saved search preferences (with sensible
//                          defaults derived from their profile).
// PATCH/POST /api/v1/search -> upsert { keywords, location, remoteOnly, salaryMin, country }.
//
// keywords drive every connector. If the user hasn't set them, we fall back to
// their desired job titles from the profile, so search works on day one.
import { json, err, currentUser, type Env, type CtxUser } from "../../_lib";

interface PrefRow {
  keywords: string | null; location: string | null; remote_only: number;
  salary_min: number | null; radius_mi: number | null; country: string | null; updated_at: string | null;
}

async function defaults(env: Env, userId: string): Promise<{ keywords: string; location: string }> {
  const rows = await env.DB.prepare(
    "SELECT field_key, value_json FROM profile_values WHERE user_id = ? AND field_key IN ('st_jobTitles','city','state')"
  ).bind(userId).all<{ field_key: string; value_json: string | null }>();
  const m: Record<string, string | null> = {};
  for (const r of rows.results ?? []) m[r.field_key] = r.value_json;
  let keywords = "";
  try { keywords = (JSON.parse(m.st_jobTitles || "[]") as any[]).map((x) => x?.name).filter(Boolean).slice(0, 3).join(" "); } catch { /* */ }
  const str = (k: string) => { const v = m[k]; if (v == null) return null; try { const p = JSON.parse(v); return typeof p === "string" ? p : null; } catch { return v; } };
  const location = [str("city"), str("state")].filter(Boolean).join(", ");
  return { keywords, location };
}

export const onRequestGet: PagesFunction<Env, string, { user?: CtxUser }> = async ({ env, data }) => {
  const user = currentUser(data);
  const row = await env.DB.prepare("SELECT keywords, location, remote_only, salary_min, radius_mi, country, updated_at FROM search_prefs WHERE user_id = ?")
    .bind(user.id).first<PrefRow>();
  const needDefaults = !row?.keywords || !row?.location;
  const def = needDefaults ? await defaults(env, user.id) : { keywords: "", location: "" };
  return json({
    keywords: row?.keywords ?? "",
    keywordsFallback: row?.keywords ? "" : def.keywords,   // placeholder when blank
    location: row?.location ?? "",
    locationFallback: row?.location ? "" : def.location,   // placeholder from profile city/state
    remoteOnly: !!row?.remote_only,
    salaryMin: row?.salary_min ?? null,
    radiusMi: row?.radius_mi ?? null,
    country: row?.country ?? "us",
    updatedAt: row?.updated_at ?? null,
  });
};

async function upsert(request: Request, env: Env, user: CtxUser): Promise<Response> {
  let body: any;
  try { body = await request.json(); } catch { return err(400, "Invalid JSON body."); }

  const keywords = typeof body.keywords === "string" ? body.keywords.trim().slice(0, 200) : "";
  const location = typeof body.location === "string" ? body.location.trim().slice(0, 120) : "";
  const remoteOnly = body.remoteOnly ? 1 : 0;
  const salaryMin = body.salaryMin == null || body.salaryMin === "" ? null : Math.max(0, Math.round(Number(body.salaryMin)));
  if (salaryMin != null && !Number.isFinite(salaryMin)) return err(400, "salaryMin must be a number.");
  const radiusMi = body.radiusMi == null || body.radiusMi === "" ? null : Math.max(1, Math.min(500, Math.round(Number(body.radiusMi))));
  if (radiusMi != null && !Number.isFinite(radiusMi)) return err(400, "radiusMi must be a number.");
  const country = typeof body.country === "string" && body.country.trim() ? body.country.trim().toLowerCase().slice(0, 2) : "us";
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO search_prefs (user_id, keywords, location, remote_only, salary_min, radius_mi, country, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       keywords=excluded.keywords, location=excluded.location, remote_only=excluded.remote_only,
       salary_min=excluded.salary_min, radius_mi=excluded.radius_mi, country=excluded.country, updated_at=excluded.updated_at`
  ).bind(user.id, keywords, location, remoteOnly, salaryMin, radiusMi, country, now).run();

  return json({ keywords, location, remoteOnly: !!remoteOnly, salaryMin, radiusMi, country, updatedAt: now });
}

export const onRequestPatch: PagesFunction<Env, string, { user?: CtxUser }> = ({ request, env, data }) =>
  upsert(request, env, currentUser(data));
export const onRequestPost: PagesFunction<Env, string, { user?: CtxUser }> = ({ request, env, data }) =>
  upsert(request, env, currentUser(data));
