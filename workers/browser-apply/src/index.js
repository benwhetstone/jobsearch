// Browser-apply worker: fills and submits interactive ATS applications
// (Workday, Workable, iCIMS, JazzHR, Ashby) with a real headless Chromium —
// the automation layer globalwork uses for ATSs that have no submit API.
//
// It never guesses: it places the answers the app already mirrored and
// approved onto the live form, matching by visible label. If anything
// required can't be filled with confidence, or a login/verification wall
// appears it can't clear, it stops and hands back to the human with a
// screenshot and a reason — the same human-gate promise, one layer deeper.
//
// Trigger:  POST /apply  { "appUuid": "..." }  with  Authorization: Bearer <ADMIN_TOKEN>
// Deploy:   cd workers/browser-apply && npm i && npx wrangler deploy
//           npx wrangler secret put ADMIN_TOKEN   (= the app's APP_ADMIN_TOKEN)
import puppeteer from "@cloudflare/puppeteer";

const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const now = () => new Date().toISOString();

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return json({ error: "POST only" }, 405);
    const auth = request.headers.get("authorization") || "";
    if (auth !== `Bearer ${env.ADMIN_TOKEN}`) return json({ error: "unauthorized" }, 401);

    let body;
    try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
    const appUuid = String(body?.appUuid || "");
    if (!appUuid) return json({ error: "appUuid required" }, 400);

    try {
      const result = await runApply(env, appUuid);
      return json(result);
    } catch (e) {
      await fail(env, appUuid, `automation error: ${e?.message || e}`);
      return json({ ok: false, reason: String(e?.message || e) }, 200);
    }
  },
};

async function runApply(env, appUuid) {
  const app = await env.DB.prepare(
    `SELECT a.*, j.title AS job_title, j.company_name, j.apply_url, j.url AS job_url
       FROM applications_v2 a JOIN jobs j ON j.uuid = a.job_uuid WHERE a.uuid = ?`
  ).bind(appUuid).first();
  if (!app) return { ok: false, reason: "application not found" };
  if (!["approved", "applying"].includes(app.status)) return { ok: false, reason: `status is ${app.status}, not approved` };

  const applyUrl = app.apply_url || app.job_url;
  if (!applyUrl) return fail(env, appUuid, "no application URL on file");

  // the answers the app already mirrored + approved (label -> value)
  const fields = (await env.DB.prepare(
    "SELECT label, value, field_type, required, fill_status FROM application_form_fields WHERE application_uuid = ? ORDER BY sort_order"
  ).bind(appUuid).all()).results ?? [];
  if (fields.some((f) => f.fill_status === "needs_human"))
    return fail(env, appUuid, "there are still unanswered questions");

  // tailored PDFs, fetched from the app with the admin bearer
  const resume = app.cv_uuid ? await fetchPdf(env, app.cv_uuid) : null;
  const cover = app.cover_letter_uuid ? await fetchPdf(env, app.cover_letter_uuid) : null;
  if (!resume) return fail(env, appUuid, "no résumé PDF available");

  await setStatus(env, appUuid, "applying");

  const browser = await puppeteer.launch(env.BROWSER);
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1600 });
  const log = [];
  try {
    await page.goto(applyUrl, { waitUntil: "networkidle0", timeout: 45000 }).catch(() => {});
    await sleep(1500);

    // Some boards front the form behind an "Apply" button — click it first.
    await clickByText(page, ["apply now", "apply for this job", "apply", "i'm interested"]).catch(() => {});
    await sleep(1200);

    // Fill every field we hold an answer for, by matching its visible label.
    let placed = 0, missedRequired = [];
    for (const f of fields) {
      if (!f.value || f.field_type === "file") continue;
      const ok = await fillByLabel(page, f.label, f.value, f.field_type);
      if (ok) { placed++; log.push(`filled: ${f.label}`); }
      else if (f.required) missedRequired.push(f.label);
    }

    // Attach the résumé (and cover letter) to the first file inputs.
    const files = await uploadFiles(page, [
      { name: `${safe(app)}-Resume.pdf`, bytes: resume },
      ...(cover ? [{ name: `${safe(app)}-Cover-Letter.pdf`, bytes: cover }] : []),
    ]);
    log.push(`uploaded ${files} file input(s)`);

    // Standard identity fields many forms have that we didn't mirror by label.
    await fillStandardContact(env, page, appUuid);

    // A login / account wall means this ATS wants a real account — that's a
    // verification-code flow. Try it; if we can't clear it, hand back.
    const codeNeeded = await detectVerification(page);
    if (codeNeeded) {
      const code = await waitForCode(env, appUuid, 90000);
      if (!code) {
        const shot = await screenshot(page);
        return fail(env, appUuid, "the employer's system asked for an email verification code we didn't receive in time", shot);
      }
      await fillByLabel(page, "code", code, "text").catch(() => {});
      await clickByText(page, ["verify", "continue", "submit code"]).catch(() => {});
      await sleep(2000);
    }

    if (missedRequired.length) {
      const shot = await screenshot(page);
      return fail(env, appUuid,
        `couldn't fill required field(s): ${missedRequired.slice(0, 3).join(", ")}`, shot);
    }

    // Submit. Only a clear confirmation counts as applied.
    const submitted = await clickByText(page, ["submit application", "submit", "send application", "apply"]);
    if (!submitted) {
      const shot = await screenshot(page);
      return fail(env, appUuid, "couldn't find the submit button on the employer's form", shot);
    }
    await sleep(4000);
    const bodyText = norm(await page.evaluate(() => document.body.innerText || ""));
    const confirmed = /(thank you|application (received|submitted)|we(?:'ve| have) received|successfully applied|submission received)/.test(bodyText);
    const stillForm = /captcha/.test(bodyText);

    if (confirmed && !stillForm) {
      await env.DB.prepare(
        "UPDATE applications_v2 SET status='applied', submitted_at=?, need_manual_apply=0, updated_at=? WHERE uuid=?"
      ).bind(now(), now(), appUuid).run();
      return { ok: true, placed, log };
    }
    if (stillForm) return fail(env, appUuid, "the employer requires a captcha, which only a person can pass", await screenshot(page));
    return fail(env, appUuid, "submitted the form but the page didn't confirm receipt — please verify on the employer site", await screenshot(page));
  } finally {
    await browser.close().catch(() => {});
  }
}

// ---- form-filling primitives ------------------------------------------------

// Find an input/select/textarea whose associated label text contains `label`
// and set its value. Handles text, textarea, select (option match), radio.
async function fillByLabel(page, label, value, type) {
  const target = norm(label);
  return await page.evaluate((target, value, type) => {
    const vis = (el) => el && el.offsetParent !== null && !el.disabled;
    const nn = (s) => (s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
    // build a label->control map from <label for>, wrapping labels, aria-label
    const controls = [...document.querySelectorAll("input, textarea, select")];
    const labelText = (el) => {
      let t = "";
      if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) t += " " + l.innerText; }
      const wrap = el.closest("label"); if (wrap) t += " " + wrap.innerText;
      t += " " + (el.getAttribute("aria-label") || "") + " " + (el.placeholder || "") + " " + (el.name || "");
      const grp = el.closest("[role=group],fieldset,div"); if (grp) { const lg = grp.querySelector("legend,label,.label"); if (lg) t += " " + lg.innerText; }
      return nn(t);
    };
    const setNative = (el, v) => {
      const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype
        : el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    // radios/checkbox groups: match the option label to the value
    const wantsChoice = String(value);
    for (const el of controls) {
      if (!vis(el)) continue;
      const lt = labelText(el);
      if (!lt.includes(target) && !target.includes(lt.slice(0, 40))) continue;
      if (el.tagName === "SELECT") {
        const opt = [...el.options].find((o) => nn(o.text) === nn(wantsChoice))
          || [...el.options].find((o) => nn(o.text).includes(nn(wantsChoice)) || nn(wantsChoice).includes(nn(o.text)));
        if (opt) { setNative(el, opt.value); return true; }
      } else if (el.type === "radio" || el.type === "checkbox") {
        const own = nn(labelText(el));
        if (own.includes(nn(wantsChoice)) || nn(wantsChoice).includes(own)) { el.click(); return true; }
      } else {
        setNative(el, wantsChoice); return true;
      }
    }
    return false;
  }, target, value, type);
}

async function fillStandardContact(env, page, appUuid) {
  const c = await env.DB.prepare(
    `SELECT
       (SELECT value_json FROM profile_values WHERE user_id=a.user_id AND field_key='firstName') fn,
       (SELECT value_json FROM profile_values WHERE user_id=a.user_id AND field_key='lastName') ln,
       (SELECT value_json FROM profile_values WHERE user_id=a.user_id AND field_key='phone') ph,
       a.relay_slug slug
     FROM applications_v2 a WHERE a.uuid=?`
  ).bind(appUuid).first();
  const strip = (s) => { try { return JSON.parse(s); } catch { return s; } };
  const map = [
    ["first name", strip(c?.fn)], ["last name", strip(c?.ln)], ["phone", strip(c?.ph)],
    ["email", c?.slug ? `apply-${c.slug}@benwhetstone.info` : null],
  ];
  for (const [label, val] of map) if (val) await fillByLabel(page, label, val, "text").catch(() => {});
}

async function uploadFiles(page, files) {
  const inputs = await page.$$("input[type=file]");
  let n = 0;
  for (let i = 0; i < inputs.length && i < files.length; i++) {
    try {
      await inputs[i].uploadFile({ name: files[i].name, mimeType: "application/pdf", data: files[i].bytes });
      n++;
    } catch { /* some inputs are hidden/managed; skip */ }
  }
  return n;
}

async function clickByText(page, texts) {
  return await page.evaluate((texts) => {
    const nn = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
    const cands = [...document.querySelectorAll("button, a, input[type=submit], [role=button]")];
    for (const t of texts) {
      const el = cands.find((c) => c.offsetParent !== null && !c.disabled &&
        nn(c.innerText || c.value || "").includes(t));
      if (el) { el.click(); return true; }
    }
    return false;
  }, texts);
}

async function detectVerification(page) {
  const t = norm(await page.evaluate(() => document.body.innerText || "").catch(() => ""));
  return /(verification code|verify your email|enter the code|we sent (?:you )?a code|confirm your email)/.test(t);
}

// Poll D1 for the code the email worker extracted into action_items.
async function waitForCode(env, appUuid, ms) {
  const deadline = Date.now() + ms;
  const since = now();
  while (Date.now() < deadline) {
    const row = await env.DB.prepare(
      `SELECT detail FROM action_items
        WHERE url = ? AND kind = 'verification_code' AND created_at >= ?
        ORDER BY created_at DESC LIMIT 1`
    ).bind(`/#application=${appUuid}`, since).first();
    const m = row?.detail && String(row.detail).match(/\b(\d{4,8})\b/);
    if (m) return m[1];
    await sleep(5000);
  }
  return null;
}

// ---- helpers ----------------------------------------------------------------

async function fetchPdf(env, docUuid) {
  const r = await fetch(`${env.APP_BASE}/api/v1/admin/pdf/${docUuid}`, {
    headers: { authorization: `Bearer ${env.ADMIN_TOKEN}` },
  });
  if (!r.ok) return null;
  return new Uint8Array(await r.arrayBuffer());
}
async function screenshot(page) {
  try { return await page.screenshot({ encoding: "base64", type: "png" }); } catch { return null; }
}
function safe(app) { return String(app.company_name || "application").replace(/[^a-z0-9]+/gi, "-").slice(0, 30); }
async function setStatus(env, appUuid, status) {
  await env.DB.prepare("UPDATE applications_v2 SET status=?, updated_at=? WHERE uuid=?").bind(status, now(), appUuid).run();
}
async function fail(env, appUuid, reason, shot) {
  await env.DB.prepare(
    "UPDATE applications_v2 SET status='approved', need_manual_apply=1, updated_at=? WHERE uuid=? AND status IN ('approved','applying')"
  ).bind(now(), appUuid).run().catch(() => {});
  await env.DB.prepare(
    `INSERT INTO action_items (id, user_id, kind, title, detail, url, status, created_at)
     SELECT ?, user_id, 'manual_submit', 'Finish this application on the employer''s page', ?, ?, 'pending', ?
       FROM applications_v2 WHERE uuid = ?`
  ).bind(crypto.randomUUID(), `Automatic submission stopped: ${reason}.`, `/#application=${appUuid}`, now(), appUuid)
    .run().catch(() => {});
  return { ok: false, reason, screenshot: shot ? `data:image/png;base64,${shot}` : undefined };
}
function json(o, status = 200) { return new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } }); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
