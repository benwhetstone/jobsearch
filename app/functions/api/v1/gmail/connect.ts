// GET /api/v1/gmail/connect -> redirect the user to Google's consent screen.
// Uses the client id they saved. access_type=offline + prompt=consent so Google
// returns a refresh token we can store for the recurring scan.
import { err, currentUser, type Env, type CtxUser } from "../../_lib";
import { loadCreds, GMAIL_SCOPE } from "../../_gmail";

export const onRequestGet: PagesFunction<Env, string, { user?: CtxUser }> = async ({ request, env, data }) => {
  const user = currentUser(data);
  const c = await loadCreds(env, user.id);
  if (!c?.client_id) return err(400, "Save your Google client ID and secret first.");
  const origin = new URL(request.url).origin;
  const params = new URLSearchParams({
    client_id: c.client_id,
    redirect_uri: `${origin}/api/v1/gmail/callback`,
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state: user.id,
  });
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
};
