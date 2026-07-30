// GET  /api/v1/gmail          -> connection status
// POST /api/v1/gmail          -> { clientId, clientSecret }  save OAuth app creds
// POST /api/v1/gmail?scan=1   -> run a scan now (also runs on each board refresh)
import { json, err, currentUser, type Env, type CtxUser } from "../../_lib";
import { loadCreds, scanGmail } from "../../_gmail";

export const onRequestGet: PagesFunction<Env, string, { user?: CtxUser }> = async ({ env, data }) => {
  const user = currentUser(data);
  const c = await loadCreds(env, user.id);
  return json({
    configured: !!(c?.client_id && c?.client_secret),
    connected: !!c?.refresh_token,
    email: c?.email || null,
    status: c?.status || "unconfigured",
    lastScanAt: c?.last_scan_at || null,
  });
};

export const onRequestPost: PagesFunction<Env, string, { user?: CtxUser }> = async ({ request, env, data }) => {
  const user = currentUser(data);
  const url = new URL(request.url);

  // trigger a scan now
  if (url.searchParams.get("scan")) {
    const res = await scanGmail(env, user.id, { days: 21, max: 50 });
    if (!res.ok) return err(400, res.reason || "Scan failed.");
    return json(res);
  }

  // save the OAuth client id/secret the user created in Google Cloud
  let body: any;
  try { body = await request.json(); } catch { return err(400, "Invalid JSON body."); }
  const clientId = String(body.clientId || "").trim();
  const clientSecret = String(body.clientSecret || "").trim();
  if (!clientId || !clientSecret) return err(400, "clientId and clientSecret are required.");
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO oauth_credentials (user_id, provider, client_id, client_secret, status, created_at, updated_at)
     VALUES (?, 'gmail', ?, ?, 'configured', ?, ?)
     ON CONFLICT(user_id, provider) DO UPDATE SET client_id=excluded.client_id, client_secret=excluded.client_secret,
       status=CASE WHEN oauth_credentials.refresh_token IS NOT NULL THEN 'connected' ELSE 'configured' END, updated_at=excluded.updated_at`
  ).bind(user.id, clientId, clientSecret, now, now).run();
  return json({ ok: true, configured: true });
};
