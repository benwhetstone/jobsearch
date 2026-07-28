// Guards every /api/* route with bearer auth and handles CORS preflight.
import { checkAuth, err, preflight, type Env } from "./_lib";

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  if (request.method === "OPTIONS") return preflight();
  if (!checkAuth(request, env)) {
    return err(401, "Unauthorized. Send Authorization: Bearer <APP_AUTH_TOKEN>.");
  }
  return context.next();
};
