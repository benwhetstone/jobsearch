// POST /api/v1/admin/notify   (admin bearer)
//   { appUuid, reason }
// The browser-apply worker calls this when it stops on an application it
// couldn't finish (a captcha it couldn't beat, a field it couldn't fill). The
// user gets a REAL email at their account address — not just the in-app inbox
// note — so a blocked application never sits unnoticed. Respects the per-user
// notify_email opt-out. Self-guards with the admin bearer; the middleware
// treats /api/v1/admin/ as public so this runs without a session cookie.
import { json, err, checkAdmin, type Env } from "../../_lib";
import { sendEmail, escapeHtml } from "../../_email";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkAdmin(request, env)) return err(401, "Admin bearer required.");
  let body: any;
  try { body = await request.json(); } catch { return err(400, "Invalid JSON body."); }
  const appUuid = String(body.appUuid || "");
  const reason = String(body.reason || "the automatic submission couldn't be completed").slice(0, 400);
  if (!appUuid) return err(400, "appUuid required.");

  const row = await env.DB.prepare(
    `SELECT u.email, u.name, u.notify_email, j.title AS job_title, j.company_name
       FROM applications_v2 a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN jobs j ON j.uuid = a.job_uuid
      WHERE a.uuid = ?`
  ).bind(appUuid).first<any>();
  if (!row?.email) return json({ status: "skipped", reason: "no user email on file" });
  if (!row.notify_email) return json({ status: "skipped", reason: "user opted out of email" });

  const company = row.company_name || "an employer";
  const role = row.job_title || "a role";
  const first = row.name ? escapeHtml(String(row.name).split(" ")[0]) : "there";
  const appUrl = `${new URL(request.url).origin}/#application=${appUuid}`;
  const subject = `Action needed: your ${company} application needs you to finish it`;
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#14181d">
    <h2 style="font-size:19px;margin:0 0 12px">Your ${escapeHtml(company)} application needs you</h2>
    <p>Hi ${first},</p>
    <p>The autopilot filled out your application for <strong>${escapeHtml(role)}</strong> at <strong>${escapeHtml(company)}</strong>, but couldn't finish the last step on its own:</p>
    <p style="background:#f4f6fa;border-left:3px solid #2563eb;padding:10px 14px;border-radius:6px;color:#33404d">${escapeHtml(reason)}.</p>
    <p>Everything else is already filled in and your place is saved — open it and complete the final step (this usually takes under a minute).</p>
    <p style="margin:22px 0"><a href="${appUrl}" style="background:#2563eb;color:#fff;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:600;display:inline-block">Finish this application</a></p>
    <p style="font-size:12px;color:#5c6875;margin-top:24px">Job Search Engine · you're getting this because autopilot needs a hand on one application. Turn these off in your profile settings.</p>
  </div>`;

  const result = await sendEmail(env, row.email, subject, html);
  return json({ status: result.status, error: result.error });
};
