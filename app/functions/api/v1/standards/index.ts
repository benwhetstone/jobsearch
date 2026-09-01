// Résumé / cover-letter standards, stored structured in D1 instead of a Drive
// doc so the builder + gate can enforce them and every session can read them.
//
// GET  /api/v1/standards            -> { standards: { <key>: <value>, ... } }
// POST /api/v1/standards            -> { key, value, rawSource? }  upsert one
//        key: 'resume' | 'cover_letter' | 'general'
import { json, err, currentUser, type Env, type CtxUser } from "../../_lib";

export const onRequestGet: PagesFunction<Env, string, { user?: CtxUser }> = async ({ env, data }) => {
  const user = currentUser(data);
  const rows = await env.DB.prepare(
    "SELECT key, value_json, updated_at FROM standards WHERE user_id = ?"
  ).bind(user.id).all<any>();
  const out: Record<string, unknown> = {};
  const updated: Record<string, string> = {};
  for (const r of rows.results ?? []) {
    try { out[r.key] = JSON.parse(r.value_json); } catch { out[r.key] = null; }
    updated[r.key] = r.updated_at;
  }
  return json({ standards: out, updatedAt: updated });
};

export const onRequestPost: PagesFunction<Env, string, { user?: CtxUser }> = async ({ request, env, data }) => {
  const user = currentUser(data);
  let body: any;
  try { body = await request.json(); } catch { return err(400, "Invalid JSON body."); }
  const key = String(body?.key || "").trim();
  if (!key || body?.value == null) return err(400, "key and value are required.");
  if (!["resume", "cover_letter", "general"].includes(key)) return err(400, "key must be resume, cover_letter, or general.");
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO standards (user_id, key, value_json, raw_source, updated_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(user_id, key) DO UPDATE SET
       value_json = excluded.value_json,
       raw_source = COALESCE(excluded.raw_source, standards.raw_source),
       updated_at = excluded.updated_at`
  ).bind(user.id, key, JSON.stringify(body.value),
         body.rawSource ? String(body.rawSource).slice(0, 40000) : null, now).run();
  return json({ ok: true, key });
};
