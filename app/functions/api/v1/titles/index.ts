// GET /api/v1/titles?q=data an  -> official + common job titles (O*NET-SOC).
// Suggestions only: titles stay free-entry, the taxonomy never restricts what a
// user may type (junk-in-taxonomy is worse than mess-in-titles).
import { json, currentUser, type Env, type CtxUser } from "../../_lib";

export const onRequestGet: PagesFunction<Env, string, { user?: CtxUser }> = async ({ request, env, data }) => {
  currentUser(data);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (q.length < 2) return json({ titles: [] });
  const rows = await env.DB.prepare(
    `SELECT name, level FROM taxonomy_titles
      WHERE name_normalized LIKE ?
      ORDER BY level DESC, LENGTH(name) ASC LIMIT 12`
  ).bind(`%${q}%`).all<{ name: string; level: number }>().catch(() => ({ results: [] as any[] }));
  return json({ titles: (rows.results ?? []).map((r) => ({ name: r.name, official: !!r.level })) });
};
