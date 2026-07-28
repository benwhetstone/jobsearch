// POST /api/v1/auth/logout
import { json, type Env } from "../../_lib";
import { readSessionCookie, destroySession, clearCookie } from "../../_auth";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const token = readSessionCookie(request);
  if (token) await destroySession(env, token);
  return json({ ok: true }, {}, 200, { "Set-Cookie": clearCookie() });
};
