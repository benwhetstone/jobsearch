// Session-based auth for /api/*. Public routes: /health, /auth/*.
// Everything else requires a valid session cookie; the resolved user is attached
// to context.data.user for downstream functions.
import { err, preflight, type Env } from "./_lib";
import { getSessionUser } from "./_auth";

// Public (no session). /notifications/run self-guards with an admin bearer token
// so a Cron Trigger can call it without a user session.
const PUBLIC_PREFIXES = ["/api/v1/health", "/api/v1/auth/", "/api/v1/notifications/run", "/api/v1/inbox/ingest", "/api/v1/admin/"];

export const onRequest: PagesFunction<Env, string, { user?: unknown }> = async (context) => {
  const { request, env } = context;
  if (request.method === "OPTIONS") return preflight();

  const path = new URL(request.url).pathname;
  const isPublic = PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p));
  if (isPublic) return context.next();

  const session = await getSessionUser(env, request);
  if (!session) return err(401, "Not signed in.");
  context.data.user = session.user;
  return context.next();
};
