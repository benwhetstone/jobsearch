// POST /api/v1/notifications/run   (admin bearer token; called by a daily Cron Trigger)
// Emails every user who has pending, un-notified action items and wants email.
// Marks those items notified so they are not emailed twice. If email is not yet
// configured, items are left un-notified so they go out once it is.
import { json, err, checkAdmin, type Env } from "../../_lib";
import { sendEmail, actionNeededHtml } from "../../_email";
import { newId } from "../../_auth";

interface ActionRow { id: string; title: string; url: string | null; }

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkAdmin(request, env)) return err(401, "Admin token required.");

  const users = await env.DB.prepare(
    `SELECT id, email, name FROM users u
      WHERE u.notify_email = 1
        AND EXISTS (SELECT 1 FROM action_items a
                     WHERE a.user_id = u.id AND a.status = 'pending' AND a.notified_at IS NULL)`
  ).all<{ id: string; email: string; name: string | null }>();

  const appUrl = env.APP_BASE_URL || new URL(request.url).origin;
  const now = new Date().toISOString();
  let notified = 0, sent = 0, skipped = 0, failed = 0;

  for (const u of users.results ?? []) {
    const items = await env.DB.prepare(
      "SELECT id, title, url FROM action_items WHERE user_id = ? AND status = 'pending' AND notified_at IS NULL ORDER BY created_at"
    ).bind(u.id).all<ActionRow>();
    const list = items.results ?? [];
    if (!list.length) continue;

    const subject = `You have ${list.length} thing${list.length === 1 ? "" : "s"} to review`;
    const result = await sendEmail(env, u.email, subject, actionNeededHtml(u.name, list, appUrl));

    await env.DB.prepare(
      "INSERT INTO notifications_log (id, user_id, channel, subject, item_count, status, provider_id, error, sent_at) VALUES (?, ?, 'email', ?, ?, ?, ?, ?, ?)"
    ).bind(newId("ntf"), u.id, subject, list.length, result.status, result.providerId ?? null, result.error ?? null, now).run();

    if (result.status === "sent") {
      const ids = list.map((i) => i.id);
      const ph = ids.map(() => "?").join(",");
      await env.DB.prepare(`UPDATE action_items SET notified_at = ? WHERE id IN (${ph})`).bind(now, ...ids).run();
      notified++; sent++;
    } else if (result.status === "skipped") { skipped++; }
    else { failed++; }
  }

  return json({ usersWithPending: (users.results ?? []).length, emailsSent: sent, skipped, failed, notifiedUsers: notified });
};
