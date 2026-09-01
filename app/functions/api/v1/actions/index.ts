// GET  /api/v1/actions          -> the signed-in user's pending action items
// POST /api/v1/actions          -> create an action item for the signed-in user
//                                  { kind, title, detail?, url? }
// PATCH /api/v1/actions          -> resolve/dismiss one { id, status: 'done'|'dismissed' }
// Later phases (match, ATS mirror, relay inbox) insert action items server-side;
// the daily notifications runner emails users about the pending ones.
import { json, err, currentUser, type Env, type CtxUser } from "../../_lib";
import { newId } from "../../_auth";

type Ctx = { user?: CtxUser };

export const onRequestGet: PagesFunction<Env, string, Ctx> = async ({ env, data }) => {
  const user = currentUser(data);
  const rows = await env.DB.prepare(
    "SELECT id, kind, title, detail, url, created_at FROM action_items WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC"
  ).bind(user.id).all();
  return json({ items: rows.results ?? [] }, { totalRecords: (rows.results ?? []).length });
};

export const onRequestPost: PagesFunction<Env, string, Ctx> = async ({ request, env, data }) => {
  const user = currentUser(data);
  let body: { kind?: string; title?: string; detail?: string; url?: string };
  try { body = await request.json(); } catch { return err(400, "Body must be JSON."); }
  if (!body.title) return err(422, "title is required.");
  const id = newId("act");
  await env.DB.prepare(
    "INSERT INTO action_items (id, user_id, kind, title, detail, url, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)"
  ).bind(id, user.id, body.kind || "general", body.title, body.detail ?? null, body.url ?? null, new Date().toISOString()).run();
  return json({ id });
};

export const onRequestPatch: PagesFunction<Env, string, Ctx> = async ({ request, env, data }) => {
  const user = currentUser(data);
  let body: { id?: string; status?: string };
  try { body = await request.json(); } catch { return err(400, "Body must be JSON."); }
  if (!body.id || !["done", "dismissed"].includes(body.status || "")) return err(422, "id and status (done|dismissed) required.");
  const res = await env.DB.prepare(
    "UPDATE action_items SET status = ?, resolved_at = ? WHERE id = ? AND user_id = ?"
  ).bind(body.status, new Date().toISOString(), body.id, user.id).run();
  return json({ updated: res.meta?.changes ?? 0 });
};
