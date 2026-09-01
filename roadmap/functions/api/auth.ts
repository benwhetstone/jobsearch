// GET  /api/auth                                  -> { signedIn, email, hasPassword }
// POST /api/auth { action:"login", email, password }
// POST /api/auth { action:"logout" }
// POST /api/auth { action:"changePassword", current, next }
// POST /api/auth { action:"setup", password }      -> only while no password exists
import { json, validSession, makeSession, sessionCookie, clearCookie,
         checkPassword, setPassword, getCred, OWNER_EMAIL, type Env } from "./_auth";

export const onRequestOptions: PagesFunction<Env> = () => json({ ok: true });

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const cred = await getCred(env);
  return json({ signedIn: await validSession(request, env), email: OWNER_EMAIL, hasPassword: !!cred });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: any;
  try { body = await request.json(); } catch { return json({ error: "invalid json" }, 400); }
  const action = String(body?.action || "");

  if (action === "logout") return json({ signedIn: false }, 200, { "set-cookie": clearCookie() });

  if (action === "setup") {
    if (await getCred(env)) return json({ error: "already set up" }, 409);
    const pw = String(body?.password || "");
    if (pw.length < 10) return json({ error: "password must be at least 10 characters" }, 400);
    await setPassword(env, pw);
    return json({ ok: true, signedIn: true }, 200, { "set-cookie": sessionCookie(await makeSession(env)) });
  }

  if (action === "login") {
    const email = String(body?.email || "").trim().toLowerCase();
    const pw = String(body?.password || "");
    // One account exists, so a wrong address and a wrong password fail the same
    // way — no reason to confirm which half was right.
    if (email !== OWNER_EMAIL || !(await checkPassword(env, pw)))
      return json({ error: "That email and password do not match." }, 401);
    return json({ ok: true, signedIn: true }, 200, { "set-cookie": sessionCookie(await makeSession(env)) });
  }

  if (action === "changePassword") {
    if (!(await validSession(request, env))) return json({ error: "sign in first" }, 401);
    const next = String(body?.next || "");
    if (!(await checkPassword(env, String(body?.current || ""))))
      return json({ error: "Current password is not right." }, 401);
    if (next.length < 10) return json({ error: "New password must be at least 10 characters." }, 400);
    await setPassword(env, next);
    // re-issue, so the change also refreshes the session
    return json({ ok: true }, 200, { "set-cookie": sessionCookie(await makeSession(env)) });
  }

  return json({ error: "unknown action" }, 400);
};
