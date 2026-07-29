// The relay inbox.
//
// GET  /api/v1/inbox?category=interview|offer|rejection|info|all
// POST /api/v1/inbox/ingest  (admin bearer; called by the email worker)
//        { to, from, subject, text }
// PATCH /api/v1/inbox        { id, read: true }
//
// Every application gets a vanity address, apply-<slug>@<domain>. Whatever the
// employer sends there is classified — rules first (free), model only when the
// rules can't tell — filed under Info / Interviews / Offers / Rejections, and
// the application's own status advances with it. That's how "applied" becomes
// "interview" without anyone forwarding emails around.
import { json, err, checkAdmin, currentUser, type Env, type CtxUser } from "../../_lib";
import { anthropic } from "../../_ai";

type Category = "info" | "interview" | "offer" | "rejection" | "other";

// Rules first: most recruiting email is formulaic enough that a regex settles
// it for free. The model only sees the ambiguous remainder.
function classifyByRules(subject: string, body: string): Category | null {
  const t = (subject + "\n" + body).toLowerCase();
  if (/(unfortunately|not (be )?moving forward|other candidates|pursue other|not selected|position has been filled|no longer under consideration)/.test(t)) return "rejection";
  if (/(offer letter|pleased to offer|extend an offer|compensation package|start date confirmation)/.test(t)) return "offer";
  if (/(interview|schedule a (call|conversation|chat)|availability|meet with|phone screen|next round|technical assessment|take-home)/.test(t)) return "interview";
  if (/(application (received|submitted)|thank you for applying|we received your application|confirm your email|verification code)/.test(t)) return "info";
  return null;
}

const STATUS_FOR: Partial<Record<Category, string>> = {
  interview: "interview", offer: "offer", rejection: "rejected",
};

export const onRequestGet: PagesFunction<Env, string, { user?: CtxUser }> = async ({ request, env, data }) => {
  const user = currentUser(data);
  const url = new URL(request.url);
  const cat = url.searchParams.get("category") || "all";
  const rows = await env.DB.prepare(
    `SELECT e.id, e.from_addr, e.subject, e.body_text, e.category, e.received_at, e.read_at,
            e.application_uuid, j.title AS job_title, j.company_name
       FROM inbox_emails e
       LEFT JOIN applications_v2 a ON a.uuid = e.application_uuid
       LEFT JOIN jobs j ON j.uuid = a.job_uuid
      WHERE e.user_id = ? AND (? = 'all' OR e.category = ?)
      ORDER BY e.received_at DESC LIMIT 100`
  ).bind(user.id, cat, cat).all<any>();
  const counts = await env.DB.prepare(
    "SELECT category, COUNT(*) AS n, SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END) AS unread FROM inbox_emails WHERE user_id = ? GROUP BY category"
  ).bind(user.id).all<any>();
  const byCat: Record<string, { total: number; unread: number }> = {};
  for (const c of counts.results ?? []) byCat[c.category] = { total: c.n, unread: c.unread };
  return json({
    emails: (rows.results ?? []).map((e: any) => ({
      id: e.id, from: e.from_addr, subject: e.subject,
      snippet: (e.body_text || "").slice(0, 240),
      category: e.category, receivedAt: e.received_at, read: !!e.read_at,
      applicationUuid: e.application_uuid,
      job: e.job_title ? { title: e.job_title, company: e.company_name } : null,
    })),
    counts: byCat,
  });
};

export const onRequestPatch: PagesFunction<Env, string, { user?: CtxUser }> = async ({ request, env, data }) => {
  const user = currentUser(data);
  let body: any;
  try { body = await request.json(); } catch { return err(400, "Invalid JSON body."); }
  if (!body.id) return err(400, "id required.");
  await env.DB.prepare("UPDATE inbox_emails SET read_at = ? WHERE id = ? AND user_id = ?")
    .bind(new Date().toISOString(), String(body.id), user.id).run();
  return json({ ok: true });
};

// DELETE /api/v1/inbox   { id }   — remove a message from the inbox.
export const onRequestDelete: PagesFunction<Env, string, { user?: CtxUser }> = async ({ request, env, data }) => {
  const user = currentUser(data);
  let body: any;
  try { body = await request.json(); } catch { return err(400, "Invalid JSON body."); }
  if (!body.id) return err(400, "id required.");
  await env.DB.prepare("DELETE FROM inbox_emails WHERE id = ? AND user_id = ?")
    .bind(String(body.id), user.id).run();
  return json({ ok: true });
};

// ---- ingest (email worker -> here) -------------------------------------------
export async function ingest(env: Env, msg: { to: string; from: string; subject: string; text: string }) {
  const slugMatch = (msg.to || "").toLowerCase().match(/apply-([a-z0-9]{6,16})@/);
  const slug = slugMatch ? slugMatch[1] : null;

  let userId: string | null = null, appUuid: string | null = null;
  if (slug) {
    const app = await env.DB.prepare("SELECT uuid, user_id FROM applications_v2 WHERE relay_slug = ?")
      .bind(slug).first<{ uuid: string; user_id: string }>();
    if (app) { userId = app.user_id; appUuid = app.uuid; }
  }
  if (!userId) return { stored: false, reason: "no matching application for " + (msg.to || "") };

  const subject = (msg.subject || "").slice(0, 400);
  const text = (msg.text || "").slice(0, 20000);

  let category = classifyByRules(subject, text);
  let by = "rules";
  if (!category) {
    by = "llm";
    try {
      const reply = await anthropic(env, {
        system: 'Classify this recruiting email. Return exactly one word: info, interview, offer, rejection, or other.',
        content: `SUBJECT: ${subject}\n\n${text.slice(0, 3000)}`,
        maxTokens: 8, userId, purpose: "email_classify",
      });
      const w = reply.trim().toLowerCase();
      category = (["info", "interview", "offer", "rejection", "other"].includes(w) ? w : "other") as Category;
    } catch { category = "other"; }
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO inbox_emails (id, user_id, application_uuid, relay_slug, from_addr, subject, body_text, category, classified_by, received_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, userId, appUuid, slug, (msg.from || "").slice(0, 300), subject, text, category, by, now).run();

  // Verification codes (teardown §8): ATS 2FA must never stall an application.
  // A 4-8 digit code near the words code/verify/confirm becomes an action item
  // the moment it lands, so it's one glance away instead of buried in mail.
  const codeMatch = (subject + "\n" + text).match(/(?:code|verify|verification|confirm)[^\d]{0,40}(\d{4,8})\b/i)
                 || subject.match(/\b(\d{6})\b/);
  if (codeMatch) {
    await env.DB.prepare(
      `INSERT INTO action_items (id, user_id, kind, title, detail, url, status, created_at)
       VALUES (?, ?, 'verification_code', ?, ?, ?, 'pending', ?)`
    ).bind(crypto.randomUUID(), userId, `Verification code: ${codeMatch[1]}`,
           `From ${msg.from}: "${subject}"`, appUuid ? `/#application=${appUuid}` : null, now).run().catch(() => {});
  }

  // advance the application + queue an action item for the ones that matter
  const newStatus = STATUS_FOR[category];
  if (appUuid && newStatus) {
    await env.DB.prepare("UPDATE applications_v2 SET status = ?, updated_at = ? WHERE uuid = ?")
      .bind(newStatus, now, appUuid).run();
    if (category === "interview" || category === "offer") {
      const j = await env.DB.prepare(
        "SELECT j.title, j.company_name FROM applications_v2 a JOIN jobs j ON j.uuid = a.job_uuid WHERE a.uuid = ?"
      ).bind(appUuid).first<any>();
      await env.DB.prepare(
        `INSERT INTO action_items (id, user_id, kind, title, detail, url, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
      ).bind(crypto.randomUUID(), userId, category,
             category === "interview" ? `Interview request: ${j?.company_name || ""}` : `Offer from ${j?.company_name || ""}`,
             `${j?.title || ""} — "${subject}"`, `/#application=${appUuid}`, now).run().catch(() => {});
    }
  }
  return { stored: true, category, applicationUuid: appUuid };
}
