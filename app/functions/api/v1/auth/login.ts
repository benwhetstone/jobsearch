// POST /api/v1/auth/login   { email, password }
import { json, err, type Env } from "../../_lib";
import { verifyPassword, createSession, sessionCookie, normalizeEmail } from "../../_auth";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: { email?: string; password?: string };
  try { body = await request.json(); } catch { return err(400, "Body must be JSON."); }
  const email = normalizeEmail(body.email || "");
  const password = body.password || "";
  if (!email || !password) return err(422, "Email and password are required.");

  const user = await env.DB.prepare(
    "SELECT id, email, name, role, password_hash, password_salt FROM users WHERE email = ?"
  ).bind(email).first<{ id: string; email: string; name: string | null; role: string; password_hash: string | null; password_salt: string | null }>();

  // Generic message so we don't reveal which accounts exist.
  const bad = () => err(401, "Wrong email or password.");
  if (!user || !user.password_hash || !user.password_salt) {
    if (user && !user.password_hash) return err(403, "This account hasn't set a password yet. Use sign-up to claim it.");
    return bad();
  }
  const ok = await verifyPassword(password, user.password_hash, user.password_salt);
  if (!ok) return bad();

  await env.DB.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(new Date().toISOString(), user.id).run();
  const token = await createSession(env, user.id);
  return json(
    { user: { id: user.id, email: user.email, name: user.name, role: user.role } },
    {},
    200,
    { "Set-Cookie": sessionCookie(token) }
  );
};
