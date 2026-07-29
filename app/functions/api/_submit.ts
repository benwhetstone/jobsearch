// Server-side ATS submission, run ONLY after the user approves an application.
// Approval is the human gate the product promises; once it's given, the machine
// files the application with the employer's own public form endpoint
// (Greenhouse job-boards post, Lever apply post) instead of sending the user
// off to retype everything.
//
// Success detection is strict: we only mark "applied" when the ATS response
// clearly confirms receipt. Captchas, validation errors and anything ambiguous
// fall back to manual with an action item that says exactly why.
import type { Env } from "./_lib";
import { renderCvPdf, renderCoverPdf, type Contact, type CvExtras, TEMPLATE_NAMES } from "./_pdf";

export interface SubmitResult { ok: boolean; reason?: string }

const now = () => new Date().toISOString();

export async function submitToAts(env: Env, userId: string, appUuid: string): Promise<SubmitResult> {
  const app = await env.DB.prepare(
    `SELECT a.*, j.title AS job_title, j.company_name FROM applications_v2 a
       JOIN jobs j ON j.uuid = a.job_uuid WHERE a.uuid = ? AND a.user_id = ?`
  ).bind(appUuid, userId).first<any>();
  if (!app) return fail(env, userId, appUuid, "application not found");
  if (!["approved", "applying"].includes(app.status)) return { ok: false, reason: "not approved" };
  if (!app.supported_ats || !app.ats_token || !app.ats_job_id || !["greenhouse", "lever"].includes(app.ats || ""))
    return fail(env, userId, appUuid, "this employer's system only takes applications on its own page");

  const fields = (await env.DB.prepare(
    "SELECT field_key, field_type, value, fill_status FROM application_form_fields WHERE application_uuid = ? ORDER BY sort_order"
  ).bind(appUuid).all<any>()).results ?? [];
  if (fields.some((f: any) => f.fill_status === "needs_human"))
    return { ok: false, reason: "unanswered questions" };

  // documents + contact, rendered exactly like the download endpoint
  const vals = await env.DB.prepare(
    `SELECT field_key, value_json FROM profile_values WHERE user_id = ?
      AND field_key IN ('firstName','lastName','applicationFirstName','email','phone','city','state',
                        'linkedinProfile','portfolioLink','resumeTemplate','st_education',
                        'st_professionalCredential','st_hardSkills','employerDescriptions')`
  ).bind(userId).all<{ field_key: string; value_json: string | null }>();
  const v: Record<string, any> = {};
  for (const r of vals.results ?? []) { try { v[r.field_key] = JSON.parse(r.value_json || "null"); } catch { v[r.field_key] = r.value_json; } }
  const contact: Contact = {
    name: [v.applicationFirstName || v.firstName, v.lastName].filter(Boolean).join(" ") || "Candidate",
    email: v.email, phone: v.phone, city: v.city, state: v.state,
    linkedin: v.linkedinProfile, website: v.portfolioLink,
  };
  const arr = (x: any) => (Array.isArray(x) ? x : []);
  const hard = arr(v.st_hardSkills);
  const extras: CvExtras = {
    education: arr(v.st_education),
    certs: arr(v.st_professionalCredential).map((c: any) => c?.name || c)
      .filter((n: any) => typeof n === "string" && !/\(in progress\)/i.test(n)),
    tagline: hard.slice(0, 4).map((x: any) => x?.name || x).filter(Boolean).join(" \xb7 ") || null,
    credentialLine: null,
    employerSublines: arr(v.employerDescriptions).filter((e: any) => e?.employer && e?.description),
    skillGroups: [{ label: "Skills", items: hard.filter((s: any) => s?.level !== "BEGINNER").map((s: any) => s?.name || s).filter(Boolean) }],
  };
  const template = TEMPLATE_NAMES.includes(String(v.resumeTemplate || "").toLowerCase())
    ? String(v.resumeTemplate).toLowerCase() : "classic";

  const loadDoc = async (uuid: string | null) => {
    if (!uuid) return null;
    const d = await env.DB.prepare("SELECT kind, content_json FROM documents WHERE uuid = ?").bind(uuid).first<any>();
    try { return d ? { kind: d.kind, content: JSON.parse(d.content_json) } : null; } catch { return null; }
  };
  const [cvDoc, coverDoc] = await Promise.all([loadDoc(app.cv_uuid), loadDoc(app.cover_letter_uuid)]);
  if (!cvDoc) return fail(env, userId, appUuid, "no résumé on file");
  const cvPdf = renderCvPdf(cvDoc.content, contact, template, extras);
  const coverPdf = coverDoc
    ? renderCoverPdf(coverDoc.content, contact, { company: app.company_name, date: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) }, template, extras)
    : null;
  const safe = contact.name.replace(/\s+/g, "-");

  // The application is filed from the relay address (globalwork's trick): the
  // résumé PDF keeps the real contact details, but the ATS gets the relay so
  // every reply routes into the platform inbox.
  const relayEmail = app.relay_slug
    ? `${app.relay_slug}@${env.RELAY_DOMAIN || "benwhetstone.info"}`
    : contact.email;

  try {
    const res = app.ats === "greenhouse"
      ? await postGreenhouse(app, fields, { ...contact, email: relayEmail }, cvPdf, coverPdf, safe)
      : await postLever(app, fields, { ...contact, email: relayEmail }, cvPdf, coverPdf, safe);
    if (res.ok) {
      await env.DB.prepare(
        "UPDATE applications_v2 SET status = 'applied', submitted_at = ?, need_manual_apply = 0, updated_at = ? WHERE uuid = ?"
      ).bind(now(), now(), appUuid).run();
      return { ok: true };
    }
    return fail(env, userId, appUuid, res.reason || "the employer's system did not confirm receipt");
  } catch (e: any) {
    return fail(env, userId, appUuid, e?.message || "network error reaching the employer's system");
  }
}

// Mark the fallback honestly: approved but needing the user's own click,
// with an action item that says why the automatic path stopped.
async function fail(env: Env, userId: string, appUuid: string, reason: string): Promise<SubmitResult> {
  await env.DB.prepare(
    "UPDATE applications_v2 SET status = 'approved', need_manual_apply = 1, updated_at = ? WHERE uuid = ? AND status IN ('approved','applying')"
  ).bind(now(), appUuid).run().catch(() => {});
  await env.DB.prepare(
    `INSERT INTO action_items (id, user_id, kind, title, detail, url, status, created_at)
     VALUES (?, ?, 'manual_submit', ?, ?, ?, 'pending', ?)`
  ).bind(crypto.randomUUID(), userId, "Finish this application on the employer's page",
         `Automatic submission stopped: ${reason}. Your documents are ready to download from the application.`,
         `/#application=${appUuid}`, now()).run().catch(() => {});
  return { ok: false, reason };
}

function addField(fd: FormData, key: string, value: string | null) {
  if (value == null || value === "") return;
  // multiselects were stored as JSON arrays of option values
  if (value.startsWith("[")) {
    try {
      const items = JSON.parse(value);
      if (Array.isArray(items)) { for (const it of items) fd.append(key + "[]", String(it)); return; }
    } catch { /* fall through to plain */ }
  }
  fd.append(key, value);
}

const CONFIRM = /thank(s| you)|confirmation|application (was )?(received|submitted)|we('ve| have) received/i;
const CAPTCHA = /captcha/i;

async function postGreenhouse(app: any, fields: any[], contact: Contact, cv: Uint8Array, cover: Uint8Array | null, safe: string): Promise<SubmitResult> {
  const fd = new FormData();
  for (const f of fields) {
    if (f.field_type === "file") continue;
    addField(fd, f.field_key, f.value);
  }
  // standard identity fields, in case the mirrored form didn't carry them
  const [first, ...rest] = contact.name.split(" ");
  if (!fd.has("first_name")) fd.set("first_name", first);
  if (!fd.has("last_name")) fd.set("last_name", rest.join(" ") || first);
  if (!fd.has("email") && contact.email) fd.set("email", contact.email);
  if (!fd.has("phone") && contact.phone) fd.set("phone", contact.phone);
  fd.set("resume", new Blob([cv.buffer as ArrayBuffer], { type: "application/pdf" }), `${safe}-Resume.pdf`);
  if (cover) fd.set("cover_letter", new Blob([cover.buffer as ArrayBuffer], { type: "application/pdf" }), `${safe}-Cover-Letter.pdf`);

  const url = `https://job-boards.greenhouse.io/${app.ats_token}/jobs/${app.ats_job_id}`;
  const res = await fetch(url, {
    method: "POST", body: fd, redirect: "manual",
    headers: { Origin: "https://job-boards.greenhouse.io", Referer: url, "User-Agent": "Mozilla/5.0" },
  });
  return judge(res);
}

async function postLever(app: any, fields: any[], contact: Contact, cv: Uint8Array, cover: Uint8Array | null, safe: string): Promise<SubmitResult> {
  const fd = new FormData();
  for (const f of fields) {
    if (f.field_type === "file") continue;
    // lever custom questions were mirrored as "<cardId>_<index>"
    const m = f.field_key.match(/^(.+)_(\d+)$/);
    if (m && f.field_key !== "name") addField(fd, `cards[${m[1]}][field${m[2]}]`, f.value);
    else addField(fd, f.field_key, f.value);
  }
  if (!fd.has("name")) fd.set("name", contact.name);
  if (!fd.has("email") && contact.email) fd.set("email", contact.email);
  if (!fd.has("phone") && contact.phone) fd.set("phone", contact.phone);
  fd.set("resume", new Blob([cv.buffer as ArrayBuffer], { type: "application/pdf" }), `${safe}-Resume.pdf`);

  const url = `https://jobs.lever.co/${app.ats_token}/${app.ats_job_id}/apply`;
  const res = await fetch(url, {
    method: "POST", body: fd, redirect: "manual",
    headers: { Origin: "https://jobs.lever.co", Referer: url.replace(/\/apply$/, ""), "User-Agent": "Mozilla/5.0" },
  });
  return judge(res);
}

// Only a clear confirmation counts. A redirect to a thanks page counts; a 200
// whose body still contains the form or a captcha does not.
async function judge(res: Response): Promise<SubmitResult> {
  if (res.status === 302 || res.status === 303) {
    const loc = res.headers.get("location") || "";
    if (/thank|confirm|success/i.test(loc)) return { ok: true };
    return { ok: false, reason: `the system redirected without confirming (${loc.slice(0, 80) || "no destination"})` };
  }
  const body = (await res.text()).slice(0, 20000);
  if (res.ok && CONFIRM.test(body) && !CAPTCHA.test(body)) return { ok: true };
  if (CAPTCHA.test(body)) return { ok: false, reason: "the employer requires a captcha, which only a person can pass" };
  return { ok: false, reason: `the system answered ${res.status} without a confirmation` };
}
