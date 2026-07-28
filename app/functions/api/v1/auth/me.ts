// GET /api/v1/auth/me  -> current signed-in user (or 401 via middleware... but this
// route is public so we resolve the session ourselves and return null when absent).
import { json, type Env } from "../../_lib";
import { getSessionUser } from "../../_auth";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const session = await getSessionUser(env, request);
  if (!session) return json({ user: null });
  const u = session.user;
  return json({ user: { id: u.id, email: u.email, name: u.name, role: u.role, notifyEmail: !!u.notify_email } });
};
