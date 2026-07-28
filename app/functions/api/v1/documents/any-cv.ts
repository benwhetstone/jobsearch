// GET /api/v1/documents/any-cv — the user's most recent résumé document (base
// preferred), used by the Templates page to preview a layout with real content.
import { json, err, currentUser, type Env, type CtxUser } from "../../_lib";

export const onRequestGet: PagesFunction<Env, string, { user?: CtxUser }> = async ({ env, data }) => {
  const user = currentUser(data);
  const doc = await env.DB.prepare(
    "SELECT uuid FROM documents WHERE user_id = ? AND kind = 'cv' ORDER BY is_default DESC, created_at DESC LIMIT 1"
  ).bind(user.id).first<{ uuid: string }>();
  if (!doc) return err(404, "No résumé yet. Upload one or generate one on the Profile page first.");
  return json({ uuid: doc.uuid });
};
