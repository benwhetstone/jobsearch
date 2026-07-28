import { json, type Env } from "../_lib";

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM profile_fields").first<{ n: number }>();
  return json({ ok: true, fields: row?.n ?? 0, env: env.APP_ENV ?? "unknown" });
};
