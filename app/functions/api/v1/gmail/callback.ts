// GET /api/v1/gmail/callback?code=...&state=<userId>
// Google redirects here after consent. Exchange the code for a refresh token,
// store it, record the connected address, then bounce back to the app.
import { type Env, type CtxUser } from "../../_lib";
import { loadCreds, exchangeCode, accessToken, profileEmail } from "../../_gmail";

function done(origin: string, msg: string, ok: boolean) {
  return Response.redirect(`${origin}/#gmail=${ok ? "connected" : "error"}&m=${encodeURIComponent(msg)}`, 302);
}

export const onRequestGet: PagesFunction<Env, string, { user?: CtxUser }> = async ({ request, env }) => {
  const url = new URL(request.url);
  const origin = url.origin;
  const code = url.searchParams.get("code");
  const userId = url.searchParams.get("state"); // we passed the user id as state
  if (url.searchParams.get("error")) return done(origin, url.searchParams.get("error")!, false);
  if (!code || !userId) return done(origin, "missing code", false);

  const c = await loadCreds(env, userId);
  if (!c?.client_id || !c?.client_secret) return done(origin, "credentials not configured", false);

  const tok = await exchangeCode(c.client_id, c.client_secret, code, `${origin}/api/v1/gmail/callback`);
  if (tok.error || !tok.refresh_token) return done(origin, tok.error || "no refresh token returned", false);

  // record which mailbox we connected
  let email: string | null = null;
  if (tok.access_token) email = await profileEmail(tok.access_token);

  const now = new Date().toISOString();
  await env.DB.prepare(
    "UPDATE oauth_credentials SET refresh_token=?, email=?, status='connected', updated_at=? WHERE user_id=? AND provider='gmail'"
  ).bind(tok.refresh_token, email, now, userId, now).run();

  return done(origin, email || "connected", true);
};
