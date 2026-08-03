// POST /api/v1/auth/api-token  -> mint a long-lived (1 year) session token the
// signed-in user can paste into a headless client (Cowork) as its API key.
// Because this requires an active session (Ben, logged in, clicks the button),
// the secret is created and shown in his own browser — it never passes through
// a server log or a third party. Presented ONCE.
//
// The returned token authenticates as this user via `Authorization: Bearer`.
// This route lives under the public /auth/ prefix, so it resolves the session
// itself rather than relying on the middleware.
import { json, err, type Env } from "../../_lib";
import { getSessionUser, createSession } from "../../_auth";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const session = await getSessionUser(env, request);
  if (!session) return err(401, "Sign in first.");
  const token = await createSession(env, session.user.id, 365);
  return json({ token, expiresInDays: 365,
    usage: "Send as `Authorization: Bearer <token>` on any /api/v1 call." });
};
