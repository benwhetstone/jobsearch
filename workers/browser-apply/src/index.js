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
    // probe: point the worker at ANY employer URL (no appUuid) using a given
    // user's profile + résumé, fill best-effort, screenshot, and report a full
    // field inventory. Used to learn new form architectures.
    if (body?.probeUrl) {
      try { return json(await probeForm(env, String(body.probeUrl), String(body.userId || "user_ben"), String(body.label || ""))); }
      catch (e) { return json({ ok: false, reason: String(e?.message || e), label: body.label }, 200); }
    }
    const appUuid = String(body?.appUuid || "");
    if (!appUuid) return json({ error: "appUuid or probeUrl required" }, 400);
    const dryRun = !!body?.dryRun;

    try {
      const result = await runApply(env, appUuid, dryRun);
      return json(result);
    } catch (e) {
      if (!dryRun) await fail(env, appUuid, `automation error: ${e?.message || e}`);
      return json({ ok: false, reason: String(e?.message || e) }, 200);
    }
  },
};

async function runApply(env, appUuid, dryRun = false) {
  const app = await env.DB.prepare(
    `SELECT a.*, j.title AS job_title, j.company_name, j.apply_url, j.url AS job_url
       FROM applications_v2 a JOIN jobs j ON j.uuid = a.job_uuid WHERE a.uuid = ?`
  ).bind(appUuid).first();
  if (!app) return { ok: false, reason: "application not found" };
  if (!dryRun && !["approved", "applying"].includes(app.status)) return { ok: false, reason: `status is ${app.status}, not approved` };

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
  // The bundler (esbuild keepNames) wraps functions with __name(); that helper
  // exists in the worker but NOT in the page/iframe context where our
  // evaluate() callbacks run — so shim it into every document before scripts.
  await page.evaluateOnNewDocument(() => { globalThis.__name = globalThis.__name || ((f) => f); }).catch(() => {});
  await page.setViewport({ width: 1280, height: 1600 });
  const log = [];
  try {
    // Navigate like a human: try the canonical ATS form, but if that 404s
    // (custom-domain / embedded boards), fall back to the posting and click
    // through to Apply. The form often lives in an iframe — we search every
    // frame for it, so we never need the "exact" application link.
    const candidates = [canonicalFormUrl(app), applyUrl].filter(Boolean);
    let frame = null, deadSeen = false;
    for (const url of candidates) {
      await page.goto(url, { waitUntil: "networkidle0", timeout: 45000 }).catch(() => {});
      await sleep(1800);
      const body = (await page.evaluate(() => document.body.innerText || "").catch(() => "")).toLowerCase();
      if (/page not found|no longer active|position (is )?(closed|filled|no longer)|this job is no longer|posting (is )?(closed|expired)|applications are closed/.test(body)) { log.push(`skip (dead): ${url}`); deadSeen = true; continue; }
      log.push(`opened ${url}`);
      frame = await findFormFrame(page);
      if (!frame) {
        // click any apply affordance, then look again (incl. new frames)
        await clickByText(page, ["apply for this job", "apply now", "apply to this job", "submit application", "start application", "apply", "i'm interested"]).catch(() => {});
        await sleep(2500);
        frame = await findFormFrame(page);
      }
      if (frame) break;
    }
    if (!frame) {
      // The posting is gone — mark it expired so it lands in the Expired stage
      // and the user can start over on a fresh req if they want.
      if (deadSeen && !dryRun) {
        await env.DB.prepare("UPDATE applications_v2 SET status='expired', updated_at=? WHERE uuid=?").bind(now(), appUuid).run().catch(() => {});
        return { ok: false, expired: true, reason: "this job is no longer accepting applications", log };
      }
      return dryRun ? { ok: false, reason: "couldn't reach a fillable form from the posting", log, screenshot: await shotData(page) }
                    : fail(env, appUuid, "couldn't reach a fillable application form from the posting", await screenshot(page));
    }
    const inputs = await frame.$$eval("input, textarea, select", (els) => els.length).catch(() => 0);
    log.push(`form frame has ${inputs} input(s)`);

    // Fill every field we hold an answer for, by matching its visible label.
    // Each step is isolated so one stubborn field can't abort the whole run.
    let placed = 0, missedRequired = [], files = 0;
    for (const f of fields) {
      if (!f.value || f.field_type === "file") continue;
      let ok = false;
      try { ok = await fillByLabel(frame, f.label, f.value, f.field_type); }
      catch (e) { log.push(`fill error (${f.label}): ${String(e.message || e).slice(0, 60)}`); }
      if (ok) { placed++; log.push(`filled: ${f.label}`); }
      else if (f.required) missedRequired.push(f.label);
    }

    // Attach the résumé (and cover letter) to the file inputs.
    try {
      files = await uploadFiles(frame, [
        { name: `${safe(app)}-Resume.pdf`, bytes: resume },
        ...(cover ? [{ name: `${safe(app)}-Cover-Letter.pdf`, bytes: cover }] : []),
      ]);
    } catch (e) { log.push(`upload error: ${String(e.message || e).slice(0, 60)}`); }
    log.push(`uploaded ${files} file input(s)`);

    // Standard identity fields many forms have that we didn't mirror by label.
    try { await fillStandardContact(env, frame, appUuid); }
    catch (e) { log.push(`contact fill error: ${String(e.message || e).slice(0, 60)}`); }

    // Anything required we still couldn't place becomes a mapped question in
    // the action-required queue, so the user answers it once and we keep it.
    if (!dryRun && missedRequired.length) {
      await createMissingFieldItems(env, appUuid, missedRequired);
    }

    // Dry run stops here: capture the filled employer form and return it so
    // the user can SEE the automation working, with nothing submitted.
    if (dryRun) {
      const shot = await screenshot(page);
      return { ok: true, dryRun: true, placed, uploaded: files, missedRequired,
               screenshot: shot ? `data:image/png;base64,${shot}` : undefined, log };
    }

    // Captcha is a hard human wall — no honest automation solves reCAPTCHA/
    // hCaptcha. If one is present, stop and route to action-required.
    if (await hasCaptcha(page)) {
      return fail(env, appUuid, "the employer's form uses a captcha, which only a person can complete — open it from here and finish the last step", await screenshot(page));
    }

    // A login / account wall means this ATS wants a real account — that's a
    // verification-code flow. Try it; if we can't clear it, hand back.
    const codeNeeded = await detectVerification(page);
    if (codeNeeded) {
      const code = await waitForCode(env, appUuid, 90000);
      if (!code) {
        const shot = await screenshot(page);
        return fail(env, appUuid, "the employer's system asked for an email verification code we didn't receive in time", shot);
      }
      await fillByLabel(frame, "code", code, "text").catch(() => {});
      await clickByText(frame, ["verify", "continue", "submit code"]).catch(() => {});
      await sleep(2000);
    }

    if (missedRequired.length) {
      const shot = await screenshot(page);
      return fail(env, appUuid,
        `couldn't fill required field(s): ${missedRequired.slice(0, 3).join(", ")}. Answer them in the app and it will finish.`, shot);
    }

    // Submit. Only a clear confirmation counts as applied.
    const submitted = await clickByText(frame, ["submit application", "submit", "send application", "apply"])
                   || await clickByText(page, ["submit application", "submit", "send application", "apply"]);
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

// ---- probe: learn any employer form -----------------------------------------
async function probeForm(env, url, userId, label) {
  const prof = await loadProfile(env, userId);
  const resume = prof.cvUuid ? await fetchPdf(env, prof.cvUuid) : null;
  const host = (() => { try { return new URL(url).host; } catch { return ""; } })();
  const ats = atsFromHost(host);

  const browser = await puppeteer.launch(env.BROWSER);
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => { globalThis.__name = globalThis.__name || ((f) => f); }).catch(() => {});
  await page.setViewport({ width: 1280, height: 1700 });
  const log = [], insights = [];
  try {
    await page.goto(url, { waitUntil: "networkidle0", timeout: 45000 }).catch(() => {});
    await sleep(2000);
    let frame = await findFormFrame(page);
    for (let attempt = 0; attempt < 3 && !frame; attempt++) {
      // Ashby shows an "Application" tab; Workday an "Apply"/"Apply Manually";
      // Greenhouse company embeds an "Apply for this job" button.
      await clickByText(page, ["application", "apply for this job", "apply now", "apply manually",
        "apply to this job", "start your application", "start application", "submit application", "apply", "i'm interested"]).catch(() => {});
      await sleep(2600);
      frame = await findFormFrame(page);
    }
    if (!frame) {
      return { ok: false, label, host, ats, reason: "no fillable form found from this URL", log, screenshot: await shotData(page) };
    }
    const before = await inventory(frame);
    // standard contact + name variants
    await fillStandardContact(env, frame, null, prof).catch((e) => log.push("contact: " + e.message));
    // common enum/button questions from the profile (work auth, sponsorship, terms)
    const answered = await answerCommonQuestions(frame, prof).catch(() => 0);
    // typeahead location
    const typed = await fillTypeaheads(frame, prof).catch(() => 0);
    // résumé upload
    let uploaded = 0;
    if (resume) { try { uploaded = await uploadFiles(frame, [{ name: `${prof.first}-${prof.last}-Resume.pdf`, bytes: resume }]); } catch (e) { log.push("upload: " + e.message); } }
    await sleep(1500);
    const after = await inventory(frame);
    const filledCount = after.filter((f) => f.value).length;

    // record what worked, so we adapt next time
    if (uploaded) insights.push({ ats, field_kind: "file_upload", strategy: "drop_event", note: "DataTransfer drop onto dropzone attaches the résumé" });
    if (after.some((f) => /name/.test(f.label) && f.value)) insights.push({ ats, field_kind: "text", strategy: "label_above", note: "label sits above input; read container heading + prev sibling" });
    if (answered) insights.push({ ats, field_kind: "button_group", strategy: "click_option", note: "Yes/No auth & sponsorship answered by clicking the matching button" });
    if (typed) insights.push({ ats, field_kind: "typeahead", strategy: "type_then_pick", note: "location typeahead: type city then click first suggestion" });
    await saveInsights(env, host, insights);

    return { ok: true, label, host, ats, url,
      fields: after.length, filledCount, uploaded, answered, typed,
      inventory: after.map((f) => ({ label: f.label.slice(0, 60), type: f.type, required: f.required, filled: !!f.value })),
      insights, log, screenshot: await shotData(page) };
  } finally { await browser.close().catch(() => {}); }
}

function atsFromHost(host) {
  if (/ashby/.test(host)) return "ashby";
  if (/greenhouse/.test(host)) return "greenhouse";
  if (/lever/.test(host)) return "lever";
  if (/workable/.test(host)) return "workable";
  if (/myworkdayjobs|workday/.test(host)) return "workday";
  if (/jazz|applytojob/.test(host)) return "jazzhr";
  if (/icims/.test(host)) return "icims";
  return "generic";
}

async function loadProfile(env, userId) {
  const rows = (await env.DB.prepare(
    "SELECT field_key, value_json FROM profile_values WHERE user_id = ? AND field_key IN ('firstName','lastName','applicationFirstName','phone','city','state','workAuthorization','visaSponsorship','linkedinProfile','portfolioLink')"
  ).bind(userId).all()).results ?? [];
  const v = {}; for (const r of rows) { try { v[r.field_key] = JSON.parse(r.value_json); } catch { v[r.field_key] = r.value_json; } }
  const cv = await env.DB.prepare("SELECT uuid FROM documents WHERE user_id=? AND kind='cv' AND is_default=1 ORDER BY created_at DESC LIMIT 1").bind(userId).first();
  return {
    first: v.applicationFirstName || v.firstName || "", last: v.lastName || "",
    phone: v.phone || "", city: v.city || "", state: v.state || "",
    workAuth: v.workAuthorization, sponsorship: v.visaSponsorship,
    linkedin: v.linkedinProfile, website: v.portfolioLink,
    cvUuid: cv?.uuid || null, userId,
  };
}

// Inventory every visible control with its resolved label, type, value.
async function inventory(frame) {
  return await frame.evaluate(() => {
    const nn = (s) => (s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
    const labelText = (el) => {
      let t = "";
      if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) t += " " + l.innerText; }
      const wrap = el.closest("label"); if (wrap) t += " " + wrap.innerText;
      t += " " + (el.getAttribute("aria-label") || "") + " " + (el.placeholder || "");
      let box = el;
      for (let up = 0; up < 4 && box; up++) { box = box.parentElement; if (!box) break;
        const lg = box.querySelector("legend,label,h1,h2,h3,h4,[class*=label],[class*=title]");
        if (lg && !lg.contains(el)) { t += " " + lg.innerText; break; } }
      return nn(t).slice(0, 80);
    };
    return [...document.querySelectorAll("input, textarea, select")]
      .filter((el) => el.offsetParent !== null && !["hidden", "submit", "button"].includes(el.type))
      .map((el) => ({ label: labelText(el) || el.name || el.type, type: el.type || el.tagName.toLowerCase(),
        required: el.required || el.getAttribute("aria-required") === "true", value: (el.value || "").slice(0, 40) }));
  }).catch(() => []);
}

async function saveInsights(env, host, insights) {
  const stmts = insights.map((i) => env.DB.prepare(
    `INSERT INTO form_insights (id, ats, host, field_kind, strategy, note, success, seen_count, updated_at)
     VALUES (?,?,?,?,?,?,1,1,?)
     ON CONFLICT(ats, field_kind, strategy) DO UPDATE SET seen_count = seen_count + 1, updated_at = excluded.updated_at`
  ).bind(crypto.randomUUID(), i.ats, host, i.field_kind, i.strategy, i.note, now()));
  for (let k = 0; k < stmts.length; k += 20) await env.DB.batch(stmts.slice(k, k + 20)).catch(() => {});
}

// Answer Yes/No button-group questions (work auth, sponsorship) from profile.
async function answerCommonQuestions(frame, prof) {
  const authorized = /citizen|permanent|valid_work|other_work/i.test(prof.workAuth || "US_CITIZEN") ? "yes" : "no";
  const needSponsor = /^yes$/i.test(String(prof.sponsorship || "NO")) ? "yes" : "no";
  return await frame.evaluate((authorized, needSponsor) => {
    const nn = (s) => (s || "").toLowerCase();
    let count = 0;
    const groups = [...document.querySelectorAll("fieldset, [role=group], div")];
    for (const g of groups) {
      const q = nn(g.innerText || "");
      let want = null;
      if (/authori[sz]ed to work|legally authorized|eligible to work/.test(q)) want = authorized;
      else if (/sponsor|visa/.test(q)) want = needSponsor;
      if (!want) continue;
      const btns = [...g.querySelectorAll("button, [role=button], label, input[type=radio]")]
        .filter((b) => b.offsetParent !== null);
      const hit = btns.find((b) => nn(b.innerText || b.value || b.getAttribute("aria-label") || "") === want)
        || btns.find((b) => nn(b.innerText || b.value || "").startsWith(want));
      if (hit) { hit.click(); count++; }
    }
    return count;
  }, authorized, needSponsor);
}

// Location typeaheads: type the city, wait, pick the first suggestion.
async function fillTypeaheads(frame, prof) {
  if (!prof.city) return 0;
  const loc = `${prof.city}${prof.state ? ", " + prof.state : ""}`;
  const handles = await frame.$$("input");
  let count = 0;
  for (const h of handles) {
    const isLoc = await h.evaluate((el) => {
      const t = ((el.getAttribute("aria-label") || "") + " " + (el.placeholder || "") + " " +
        (el.closest("div")?.innerText || "")).toLowerCase();
      return el.offsetParent !== null && /where are you|current location|located|city/.test(t) && !el.value;
    }).catch(() => false);
    if (!isLoc) continue;
    try {
      await h.click({ clickCount: 1 });
      await h.type(loc, { delay: 40 });
      await sleep(1400);
      // pick the first suggestion in any listbox/option that appeared
      const picked = await frame.evaluate(() => {
        const opt = document.querySelector('[role=option], li[role=option], .select__option, [class*=option]');
        if (opt && opt.offsetParent !== null) { opt.click(); return true; } return false;
      }).catch(() => false);
      if (picked) count++;
    } catch { /* skip */ }
  }
  return count;
}

// ---- navigation: find the frame that actually holds the application form ----
// The form may be the main document or an embedded iframe (Greenhouse/Lever
// embeds, Workday portals). We pick the frame with the most application-shaped
// inputs, so we never need the "exact" form URL.
async function findFormFrame(page) {
  const frames = page.frames();
  let best = null, bestScore = 0;
  for (const fr of frames) {
    const score = await fr.evaluate(() => {
      const inputs = [...document.querySelectorAll("input, textarea, select")]
        .filter((el) => el.offsetParent !== null && el.type !== "hidden");
      const fileish = document.querySelector('input[type=file]') ? 3 : 0;
      const applyish = /first name|last name|email|resume|cv|cover letter|phone/i.test(document.body?.innerText || "") ? 3 : 0;
      return inputs.length + fileish + applyish;
    }).catch(() => 0);
    if (score > bestScore) { bestScore = score; best = fr; }
  }
  return bestScore >= 3 ? best : null;
}

// reCAPTCHA / hCaptcha detection across the page and its frames.
async function hasCaptcha(page) {
  for (const fr of page.frames()) {
    const found = await fr.evaluate(() =>
      !!document.querySelector('.g-recaptcha, iframe[src*="recaptcha"], iframe[src*="hcaptcha"], [data-hcaptcha-widget-id], #cf-turnstile, .cf-turnstile')
      || /verify you are human|i'm not a robot|complete the captcha/i.test(document.body?.innerText || "")
    ).catch(() => false);
    if (found) return true;
  }
  return false;
}

// Each required field we couldn't auto-fill becomes a mapped, human-answerable
// question tied to this application — the "action required" mechanism. Once
// answered it's saved as a learned alias so the next form gets it automatically.
async function createMissingFieldItems(env, appUuid, labels) {
  const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const stmts = [];
  for (let i = 0; i < labels.length; i++) {
    stmts.push(env.DB.prepare(
      `INSERT INTO application_form_fields (uuid, application_uuid, field_key, field_type, label, label_normalized,
         value, options_json, required, sort_order, fill_source, fill_status, created_at)
       VALUES (?,?,?,?,?,?,?,?,1,?,NULL,'needs_human',?)`
    ).bind(crypto.randomUUID(), appUuid, `browser_${i}`, "text", labels[i], norm(labels[i]), null, "[]", 900 + i, now()));
  }
  stmts.push(env.DB.prepare(
    `INSERT INTO action_items (id, user_id, kind, title, detail, url, status, created_at)
     SELECT ?, user_id, 'browser_fields', ?, ?, ?, 'pending', ? FROM applications_v2 WHERE uuid = ?`
  ).bind(crypto.randomUUID(), "This application needs a few answers from you",
         `The employer's form asked for: ${labels.slice(0, 4).join(", ")}. Answer them and we finish the submission.`,
         `/#application=${appUuid}`, now(), appUuid));
  for (let i = 0; i < stmts.length; i += 20) await env.DB.batch(stmts.slice(i, i + 20));
}

async function shotData(page) {
  const s = await screenshot(page);
  return s ? `data:image/png;base64,${s}` : undefined;
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
      if (el.getAttribute("aria-labelledby")) {
        for (const id of el.getAttribute("aria-labelledby").split(/\s+/)) { const n = document.getElementById(id); if (n) t += " " + n.innerText; }
      }
      const wrap = el.closest("label"); if (wrap) t += " " + wrap.innerText;
      t += " " + (el.getAttribute("aria-label") || "") + " " + (el.placeholder || "") + " " + (el.name || "");
      // label-above-input pattern (Ashby/Workday React): walk up to the field
      // container and read its heading/label/first text before the input.
      let box = el;
      for (let up = 0; up < 4 && box; up++) {
        box = box.parentElement;
        if (!box) break;
        const lg = box.querySelector("legend,label,h1,h2,h3,h4,[class*=label],[class*=title],[class*=question]");
        if (lg && !lg.contains(el)) { t += " " + lg.innerText; break; }
        // previous sibling text (label rendered right above the control)
        const prev = box.previousElementSibling;
        if (prev && prev.innerText && prev.innerText.length < 120) t += " " + prev.innerText;
      }
      return nn(t).slice(0, 200);
    };
    const setNative = (el, v) => {
      try {
        if (el.type === "file") return false;
        const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype
          : el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
        setter.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      } catch { return false; }
    };
    // radios/checkbox groups: match the option label to the value
    const wantsChoice = String(value);
    for (const el of controls) {
      if (!vis(el)) continue;
      if (el.type === "file" || el.type === "hidden" || el.type === "submit" || el.type === "button") continue;
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

async function fillStandardContact(env, page, appUuid, prof) {
  let first, last, phone, slug;
  if (prof) {
    first = prof.first; last = prof.last; phone = prof.phone;
    // probe uses a demo relay so recruiters never see a raw address
    slug = `${(first || "candidate").toLowerCase()}.${(last || "").toLowerCase()}`.replace(/[^a-z.]/g, "");
  } else {
    const c = await env.DB.prepare(
      `SELECT
         (SELECT value_json FROM profile_values WHERE user_id=a.user_id AND field_key='firstName') fn,
         (SELECT value_json FROM profile_values WHERE user_id=a.user_id AND field_key='lastName') ln,
         (SELECT value_json FROM profile_values WHERE user_id=a.user_id AND field_key='phone') ph,
         a.relay_slug slug
       FROM applications_v2 a WHERE a.uuid=?`
    ).bind(appUuid).first();
    const strip = (s) => { try { return JSON.parse(s); } catch { return s; } };
    first = strip(c?.fn); last = strip(c?.ln); phone = strip(c?.ph); slug = c?.slug;
  }
  const full = [first, last].filter(Boolean).join(" ");
  // Try many label variants so "Legal Name" / "Full name" / "Your name" all hit.
  const map = [
    ["first name", first], ["given name", first], ["last name", last], ["family name", last], ["surname", last],
    ["legal name", full], ["full name", full], ["your name", full], ["name", full],
    ["phone", strip(c?.ph)], ["mobile", strip(c?.ph)],
    ["email", c?.slug ? `${c.slug}@benwhetstone.info` : null],
  ];
  for (const [label, val] of map) if (val) await fillByLabel(page, label, val, "text").catch(() => {});
}

// Attach the résumé/cover PDFs to the form's file inputs. Cloudflare's
// puppeteer accepts an in-memory file spec on ElementHandle.uploadFile; if a
// build rejects that shape we fall back to a DataTransfer drop, which many
// modern ATS dropzones (Ashby, Greenhouse) accept.
async function uploadFiles(page, files) {
  const inputs = await page.$$("input[type=file]");
  let n = 0;
  const b64of = (bytes) => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
  for (let i = 0; i < inputs.length && i < files.length; i++) {
    const f = files[i];
    const b64 = b64of(f.bytes);
    let done = false;
    // 1) Native uploadFile (works when the browser build supports in-memory).
    try { await inputs[i].uploadFile({ name: f.name, mimeType: "application/pdf", data: f.bytes }); done = true; }
    catch { /* try drop */ }
    // 2) Synthetic drop of a real File onto the input AND its dropzone — this
    //    is what react-dropzone based ATS forms (Ashby, Greenhouse) listen for.
    if (!done) {
      try {
        done = await inputs[i].evaluate((el, b64, name) => {
          const bin = atob(b64); const arr = new Uint8Array(bin.length);
          for (let k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k);
          const file = new File([arr], name, { type: "application/pdf" });
          const dt = new DataTransfer(); dt.items.add(file);
          // some inputs DO accept files set this way inside automation
          try { Object.defineProperty(el, "files", { value: dt.files, configurable: true }); } catch {}
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          // dropzone: the nearest ancestor that looks like a drop target
          const zone = el.closest("[class*=dropzone],[class*=upload],[data-testid*=upload],label") || el.parentElement || el;
          for (const type of ["dragenter", "dragover", "drop"]) {
            const ev = new DragEvent(type, { bubbles: true, cancelable: true });
            try { Object.defineProperty(ev, "dataTransfer", { value: dt }); } catch {}
            zone.dispatchEvent(ev);
          }
          return (el.files && el.files.length > 0);
        }, b64, f.name);
      } catch { /* give up on this input */ }
    }
    if (done) n++;
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

// The real, fillable application form URL for each supported ATS — not the
// employer's marketing wrapper. Greenhouse renders the form inline on
// job-boards.greenhouse.io; Lever at /apply; Ashby at /application.
function canonicalFormUrl(app) {
  const t = app.ats_token, id = app.ats_job_id;
  if (!t || !id) return null;
  if (app.ats === "greenhouse") return `https://job-boards.greenhouse.io/${t}/jobs/${id}`;
  if (app.ats === "lever") return `https://jobs.lever.co/${t}/${id}/apply`;
  if (app.ats === "ashby") return `https://jobs.ashbyhq.com/${t}/${id}/application`;
  return null;
}
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
