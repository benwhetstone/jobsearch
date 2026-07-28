// POST /api/v1/auth/signup   { email, password, name?, inviteCode? }
// Creates a new account and signs in. If a CLAIMABLE seeded user exists with that
// email (password_hash NULL, e.g. Ben's pre-filled profile), sets its password
// and claims it instead of erroring.
import { json, err, type Env } from "../../_lib";
import { hashPassword, createSession, sessionCookie, normalizeEmail, validEmail, newId } from "../../_auth";
import { sendEmail, welcomeHtml } from "../../_email";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: { email?: string; password?: string; name?: string; inviteCode?: string };
  try { body = await request.json(); } catch { return err(400, "Body must be JSON."); }

  if (env.APP_SIGNUP_CODE && body.inviteCode !== env.APP_SIGNUP_CODE) {
    return err(403, "This app is invite-only. Ask the owner for a sign-up code.");
  }
  const email = normalizeEmail(body.email || "");
  const password = body.password || "";
  const name = (body.name || "").trim() || null;
  if (!validEmail(email)) return err(422, "Enter a valid email address.");
  if (password.length < 8) return err(422, "Password must be at least 8 characters.");

  const existing = await env.DB.prepare("SELECT id, password_hash FROM users WHERE email = ?")
    .bind(email).first<{ id: string; password_hash: string | null }>();

  const { hash, salt } = await hashPassword(password);
  const now = new Date().toISOString();
  let userId: string;

  if (existing) {
    if (existing.password_hash) return err(409, "An account with that email already exists. Try logging in.");
    // claim the seeded, passwordless account (keeps its pre-filled profile)
    userId = existing.id;
    await env.DB.prepare(
      "UPDATE users SET password_hash = ?, password_salt = ?, name = COALESCE(?, name), last_login_at = ? WHERE id = ?"
    ).bind(hash, salt, name, now, userId).run();
  } else {
    userId = newId("user");
    await env.DB.prepare(
      "INSERT INTO users (id, email, name, password_hash, password_salt, role, notify_email, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, 'user', 1, ?, ?)"
    ).bind(userId, email, name, hash, salt, now, now).run();
  }

  const token = await createSession(env, userId);

  // Welcome email (no-op if email not configured). Non-blocking on failure.
  const appUrl = env.APP_BASE_URL || new URL(request.url).origin;
  await sendEmail(env, email, "Welcome to your Job Search", welcomeHtml(name, appUrl)).catch(() => {});

  return json(
    { user: { id: userId, email, name, role: existing ? undefined : "user" }, claimed: !!existing },
    {},
    200,
    { "Set-Cookie": sessionCookie(token) }
  );
};
