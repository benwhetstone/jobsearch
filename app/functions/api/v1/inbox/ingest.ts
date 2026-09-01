// POST /api/v1/inbox/ingest — the email worker delivers parsed messages here.
// Guarded by the admin bearer, not a user session (mail arrives on its own).
import { json, err, checkAdmin, type Env } from "../../_lib";
import { ingest } from "./index";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkAdmin(request, env)) return err(401, "Admin bearer required.");
  let body: any;
  try { body = await request.json(); } catch { return err(400, "Invalid JSON body."); }
  const res = await ingest(env, {
    to: String(body.to || ""), from: String(body.from || ""),
    subject: String(body.subject || ""), text: String(body.text || ""),
  });
  return json(res);
};
