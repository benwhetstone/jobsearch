// Gmail integration for the OUTSIDE-application tracker. The relay-alias inbox
// covers applications filed through the platform; this covers the ones the user
// files themselves, directly on employer sites, from their own Gmail. On each
// board refresh we scan the mailbox, detect application confirmations and
// status updates (interview / offer / rejection), and keep applications_v2 +
// the inbox current — comprehensively, not relying on a Gmail label that misses
// things.
//
// Auth: OAuth 2.0 with a stored refresh token (per user, oauth_credentials).
// Only credentials the user connected are ever used; nothing is hardcoded.
import type { Env } from "./_lib";
import { anthropic } from "./_ai";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export interface GmailCreds {
  client_id: string | null; client_secret: string | null;
  refresh_token: string | null; email: string | null;
  status: string; last_scan_at: string | null;
}

export async function loadCreds(env: Env, userId: string): Promise<GmailCreds | null> {
  return await env.DB.prepare(
    "SELECT client_id, client_secret, refresh_token, email, status, last_scan_at FROM oauth_credentials WHERE user_id = ? AND provider = 'gmail'"
  ).bind(userId).first<GmailCreds>();
}

// Swap the long-lived refresh token for a short-lived access token.
export async function accessToken(creds: GmailCreds): Promise<string | null> {
  if (!creds.client_id || !creds.client_secret || !creds.refresh_token) return null;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.client_id, client_secret: creds.client_secret,
      refresh_token: creds.refresh_token, grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  const j = await res.json<any>().catch(() => null);
  return j?.access_token || null;
}

// Exchange the one-time auth code (from the consent redirect) for tokens.
export async function exchangeCode(clientId: string, secret: string, code: string, redirectUri: string): Promise<{ refresh_token?: string; access_token?: string; error?: string }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId, client_secret: secret, code, redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const j = await res.json<any>().catch(() => ({}));
  if (!res.ok) return { error: j?.error_description || j?.error || `HTTP ${res.status}` };
  return { refresh_token: j.refresh_token, access_token: j.access_token };
}

// Whose mailbox is this — used to record the connected address.
export async function profileEmail(token: string): Promise<string | null> {
  const res = await fetch(`${GMAIL}/profile`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const j = await res.json<any>().catch(() => null);
  return j?.emailAddress || null;
}

// A comprehensive query — recruiting mail plus common ATS sender domains — so
// we catch what a single label misses. Bounded to recent mail on each pass.
function scanQuery(days: number): string {
  const senders = ["greenhouse.io", "lever.co", "ashbyhq.com", "myworkdayjobs.com", "workday.com",
    "icims.com", "smartrecruiters.com", "workable.com", "jobvite.com", "bamboohr.com", "taleo.net",
    "successfactors.com", "linkedin.com", "indeed.com", "ziprecruiter.com"];
  const words = ['"thank you for applying"', '"application received"', '"we received your application"',
    '"your application"', '"application to"', '"application for"', '"status of your application"',
    '"schedule an interview"', "interview", '"move forward"', '"not moving forward"',
    '"unfortunately"', '"pleased to offer"', '"offer letter"', "recruiter", '"next steps"'];
  const from = senders.map((s) => `from:${s}`).join(" OR ");
  const kw = words.join(" OR ");
  return `newer_than:${days}d AND ((${from}) OR (${kw})) AND -in:spam`;
}

async function listMessageIds(token: string, q: string, max = 40): Promise<string[]> {
  const url = `${GMAIL}/messages?q=${encodeURIComponent(q)}&maxResults=${max}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  const j = await res.json<any>().catch(() => null);
  return (j?.messages || []).map((m: any) => m.id).filter(Boolean);
}

function header(payload: any, name: string): string {
  const h = (payload?.headers || []).find((x: any) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value || "";
}
function decodeB64Url(data: string): string {
  try { return atob(data.replace(/-/g, "+").replace(/_/g, "/")); } catch { return ""; }
}
// Pull a readable text body out of the MIME tree.
function bodyText(payload: any): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) return decodeB64Url(payload.body.data);
  const parts = payload.parts || [];
  for (const p of parts) { const t = bodyText(p); if (t) return t; }
  if (payload.body?.data) return decodeB64Url(payload.body.data);
  return "";
}

async function getMessage(token: string, id: string): Promise<{ id: string; from: string; subject: string; date: string; text: string } | null> {
  const res = await fetch(`${GMAIL}/messages/${id}?format=full`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const j = await res.json<any>().catch(() => null);
  if (!j) return null;
  return {
    id,
    from: header(j.payload, "From"),
    subject: header(j.payload, "Subject"),
    date: header(j.payload, "Date"),
    text: bodyText(j.payload).replace(/\r/g, "").slice(0, 8000),
  };
}

type Cat = "info" | "interview" | "offer" | "rejection" | "other";
function classifyByRules(subject: string, body: string): Cat | null {
  const t = (subject + "\n" + body).toLowerCase();
  if (/(unfortunately|not (be )?moving forward|other candidates|pursue other|not selected|position has been filled|no longer under consideration|decided not to)/.test(t)) return "rejection";
  if (/(offer letter|pleased to offer|extend an offer|compensation package)/.test(t)) return "offer";
  if (/(schedule (an|a).*(interview|call|conversation)|interview|availability|phone screen|next round|technical assessment|take-home)/.test(t)) return "interview";
  if (/(application (received|submitted)|thank you for applying|we received your application|your application (to|for))/.test(t)) return "info";
  return null;
}
const STATUS_FOR: Partial<Record<Cat, string>> = { interview: "interview", offer: "offer", rejection: "rejected" };

const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

// Ask the model for the employer + role a recruiting email is about, so we can
// tie it to (or create) the right application row. Rules first for the category.
async function extractCompanyRole(env: Env, userId: string, subject: string, from: string, text: string): Promise<{ company: string | null; title: string | null }> {
  try {
    const reply = await anthropic(env, {
      system: 'From this recruiting email, return JSON {"company": "...", "title": "..."} — the employer company name and the job title it concerns. Use null if unknown. Company from the sender or signature, not the ATS vendor (not "Greenhouse"/"Lever"). Return only JSON.',
      content: `FROM: ${from}\nSUBJECT: ${subject}\n\n${text.slice(0, 2500)}`,
      maxTokens: 120, userId, purpose: "gmail_extract",
    });
    const m = reply.match(/\{[\s\S]*\}/);
    if (!m) return { company: null, title: null };
    const j = JSON.parse(m[0]);
    return { company: j.company || null, title: j.title || null };
  } catch { return { company: null, title: null }; }
}

// The scan: for each recent job email not already ingested, classify it, tie it
// to an application (create one if it's an outside app we haven't seen), file it
// in the inbox, and advance status on interview/offer/rejection.
export async function scanGmail(env: Env, userId: string, opts: { days?: number; max?: number } = {}): Promise<{ ok: boolean; scanned: number; filed: number; created: number; advanced: number; reason?: string }> {
  const creds = await loadCreds(env, userId);
  if (!creds?.refresh_token) return { ok: false, scanned: 0, filed: 0, created: 0, advanced: 0, reason: "gmail not connected" };
  const token = await accessToken(creds);
  if (!token) { await env.DB.prepare("UPDATE oauth_credentials SET status='error', updated_at=? WHERE user_id=? AND provider='gmail'").bind(new Date().toISOString(), userId).run().catch(() => {}); return { ok: false, scanned: 0, filed: 0, created: 0, advanced: 0, reason: "token refresh failed — reconnect Gmail" }; }

  const ids = await listMessageIds(token, scanQuery(opts.days ?? 14), opts.max ?? 40);
  let filed = 0, created = 0, advanced = 0;
  const now = new Date().toISOString();

  for (const id of ids) {
    // dedupe: skip mail we already stored (gmail id kept in relay_slug slot for source='gmail')
    const seen = await env.DB.prepare("SELECT id FROM inbox_emails WHERE user_id=? AND relay_slug=?").bind(userId, `gmail:${id}`).first().catch(() => null);
    if (seen) continue;
    const msg = await getMessage(token, id);
    if (!msg) continue;
    const cat = classifyByRules(msg.subject, msg.text) || "other";
    if (cat === "other") continue; // not clearly job-related; skip the noise

    const { company, title } = await extractCompanyRole(env, userId, msg.subject, msg.from, msg.text);
    // find an existing application for this employer (fuzzy on company)
    let appUuid: string | null = null;
    if (company) {
      const hit = await env.DB.prepare(
        `SELECT a.uuid FROM applications_v2 a JOIN jobs j ON j.uuid=a.job_uuid
          WHERE a.user_id=? AND lower(j.company_name) LIKE ? ORDER BY a.created_at DESC LIMIT 1`
      ).bind(userId, `%${norm(company).slice(0, 20)}%`).first<{ uuid: string }>().catch(() => null);
      appUuid = hit?.uuid || null;
    }
    // no existing app → this is an outside application we haven't tracked; create it
    if (!appUuid && company) {
      appUuid = crypto.randomUUID();
      const jobUuid = "gmail:" + appUuid;
      const initStatus = STATUS_FOR[cat] || "applied";
      await env.DB.prepare(
        `INSERT INTO jobs (uuid, source, external_id, title, company_name, remote, url, description, created_at)
         VALUES (?, 'gmail', ?, ?, ?, 0, '', 'Detected from your Gmail (applied off-platform).', ?)`
      ).bind(jobUuid, id, title || "Role (from email)", company, now).run().catch(() => {});
      await env.DB.prepare(
        `INSERT INTO applications_v2 (uuid, user_id, job_uuid, status, need_manual_apply, submitted_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?)`
      ).bind(appUuid, userId, jobUuid, initStatus, now, now, now).run().catch(() => {});
      created++;
    }
    // file the email in the inbox (source gmail), tie to the app if we have one
    await env.DB.prepare(
      `INSERT INTO inbox_emails (id, user_id, application_uuid, relay_slug, from_addr, subject, body_text, category, classified_by, received_at)
       VALUES (?,?,?,?,?,?,?,?, 'gmail-scan', ?)`
    ).bind(crypto.randomUUID(), userId, appUuid, `gmail:${id}`, msg.from.slice(0, 300), msg.subject.slice(0, 400), msg.text, cat, now).run().catch(() => {});
    filed++;
    // advance the tied application on a real status signal
    const newStatus = STATUS_FOR[cat];
    if (appUuid && newStatus) {
      await env.DB.prepare("UPDATE applications_v2 SET status=?, updated_at=? WHERE uuid=? AND status NOT IN ('offer')")
        .bind(newStatus, now, appUuid).run().catch(() => {});
      advanced++;
    }
  }

  await env.DB.prepare("UPDATE oauth_credentials SET status='connected', last_scan_at=?, updated_at=? WHERE user_id=? AND provider='gmail'")
    .bind(now, now, userId).run().catch(() => {});
  return { ok: true, scanned: ids.length, filed, created, advanced };
}
