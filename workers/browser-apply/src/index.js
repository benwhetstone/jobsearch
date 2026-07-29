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
  await preparePage(page);
  await page.setViewport({ width: 1280, height: 1600 });
  const log = [];
  try {
    // Navigate like a human: try the canonical ATS form, but if that 404s
    // (custom-domain / embedded boards), fall back to the posting and click
    // through to Apply. The form often lives in an iframe — navigateToForm
    // searches every frame, so we never need the "exact" application link.
    const { frame: reached, deadSeen } = await navigateToForm(page, [canonicalFormUrl(app), applyUrl], log);
    let frame = reached;
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
    // Workday/iCIMS gate the form behind a candidate account. If we hit that
    // wall, sign in with the account we already made for this employer, or
    // register with the vanity relay address and click the verification link
    // that lands in the relay inbox. Once it clears, the real form renders —
    // re-find the form frame.
    const acct = await ensureAccount(env, page, app, log);
    if (acct.blocked && !dryRun) {
      return fail(env, appUuid, acct.reason || "couldn't create or verify a candidate account on the employer's site", await screenshot(page));
    }
    if (acct.handled) {
      await sleep(2000);
      frame = await findFormFrame(page) || frame;
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

    // Captcha: solve it ourselves — anti-detection lets most invisible/checkbox
    // challenges pass, and reCAPTCHA v2 audio is transcribed with Workers AI
    // Whisper. Only if that genuinely can't clear it do we hand back.
    if (await hasCaptcha(page)) {
      const solved = await solveCaptcha(env, page, log);
      if (!solved) {
        return fail(env, appUuid, "the employer's form uses a captcha the automated solver couldn't clear (likely an hCaptcha image challenge) — open it from here and finish the last step", await screenshot(page));
      }
      log.push("captcha solved");
    }

    // A verification-code wall before submit (some ATSs verify the email up
    // front). Pull the code from the relay inbox and enter it; if it never
    // arrives, hand back to the human.
    if (await detectVerification(page)) {
      const entered = await enterVerificationCode(env, frame, page, appUuid, log);
      if (!entered) {
        return fail(env, appUuid, "the employer's system asked for an email verification code we didn't receive in time", await screenshot(page));
      }
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

    // Greenhouse (and others) email a confirmation CODE only AFTER you submit —
    // a "verify it's really you" step that gates the final receipt. If that wall
    // appears now, pull the code from the relay inbox, enter it, and confirm.
    for (let round = 0; round < 2 && await detectVerification(page); round++) {
      const entered = await enterVerificationCode(env, frame, page, appUuid, log);
      if (!entered) {
        return fail(env, appUuid, "the employer emailed a verification code after submit that we didn't receive in time — enter it from here to finish", await screenshot(page));
      }
      await sleep(3500);
    }

    const bodyText = norm(await page.evaluate(() => document.body.innerText || ""));
    const confirmed = /(thank you|application (received|submitted)|we(?:'ve| have) received|successfully applied|submission received)/.test(bodyText);
    const stillForm = /captcha/.test(bodyText);

    if (confirmed && !stillForm) {
      await env.DB.prepare(
        "UPDATE applications_v2 SET status='applied', submitted_at=?, need_manual_apply=0, updated_at=? WHERE uuid=?"
      ).bind(now(), now(), appUuid).run();
      return { ok: true, placed, log };
    }
    // A captcha that only appeared on submit: solve it, submit once more.
    if (stillForm && await solveCaptcha(env, page, log)) {
      await (clickByText(frame, ["submit application", "submit", "send application", "apply"])
          || clickByText(page, ["submit application", "submit", "send application", "apply"]));
      await sleep(4000);
      const bt2 = norm(await page.evaluate(() => document.body.innerText || ""));
      if (/(thank you|application (received|submitted)|we(?:'ve| have) received|successfully applied|submission received)/.test(bt2)) {
        await env.DB.prepare(
          "UPDATE applications_v2 SET status='applied', submitted_at=?, need_manual_apply=0, updated_at=? WHERE uuid=?"
        ).bind(now(), now(), appUuid).run();
        return { ok: true, placed, log };
      }
    }
    if (stillForm) return fail(env, appUuid, "the employer requires a captcha the solver couldn't clear — please finish the last step on the employer site", await screenshot(page));
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
  await preparePage(page);
  await page.setViewport({ width: 1280, height: 1700 });
  const log = [], insights = [];
  try {
    const { frame } = await navigateToForm(page, [url], log);
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
  if (/smartrecruiters/.test(host)) return "smartrecruiters";
  if (/bamboohr/.test(host)) return "bamboohr";
  if (/taleo/.test(host)) return "taleo";
  if (/successfactors|sapsf/.test(host)) return "successfactors";
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

// ---- navigation: reach the frame that actually holds the application form ---
// Try each candidate URL; on each, look for the form, and if it isn't there
// yet, scroll (to trigger lazy-loaded embedded iframes — Greenhouse on custom
// domains) and click any apply/tab affordance, then look again. "Application"
// is first so Ashby/Workday tabbed layouts switch to the form tab instead of
// sitting on Overview. Returns { frame, deadSeen }.
const APPLY_AFFORDANCES = [
  "application", "apply for this job", "apply now", "apply manually",
  "apply to this job", "start your application", "start application",
  "submit application", "apply", "i'm interested",
];
const DEAD_POSTING = /page not found|no longer active|position (is )?(closed|filled|no longer)|this job is no longer|posting (is )?(closed|expired)|applications are closed|not accepting applications|this posting (is|has)|job has been filled/i;

async function navigateToForm(page, candidates, log) {
  let frame = null, deadSeen = false;
  for (const url of candidates.filter(Boolean)) {
    await page.goto(url, { waitUntil: "networkidle0", timeout: 45000 }).catch(() => {});
    await sleep(1800);
    const body = (await page.evaluate(() => document.body.innerText || "").catch(() => "")).toLowerCase();
    if (DEAD_POSTING.test(body)) { log?.push(`skip (dead): ${url}`); deadSeen = true; continue; }
    log?.push(`opened ${url}`);
    frame = await findFormFrame(page);
    for (let attempt = 0; attempt < 3 && !frame; attempt++) {
      // scroll to force lazy iframes (embedded Greenhouse) to load
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await sleep(600);
      await clickByText(page, APPLY_AFFORDANCES).catch(() => {});
      await sleep(2400);
      frame = await findFormFrame(page);
    }
    if (frame) break;
  }
  return { frame, deadSeen };
}

// Find the frame that holds the application form. The form may be the main
// document or an embedded iframe (Greenhouse/Lever embeds, Workday portals).
// We pick the frame with the most application-shaped inputs, so we never need
// the "exact" form URL.
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

// Make the headless browser look like a real one before any page script runs.
// Most invisible captchas (reCAPTCHA v3, Turnstile managed, the v2 checkbox)
// only challenge when they smell automation — clearing these tells is the
// cheapest, most effective captcha defense there is.
async function preparePage(page) {
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
  ).catch(() => {});
  await page.setExtraHTTPHeaders({ "accept-language": "en-US,en;q=0.9" }).catch(() => {});
  await page.evaluateOnNewDocument(() => {
    // esbuild keepNames wraps functions with __name(), absent in page context.
    globalThis.__name = globalThis.__name || ((f) => f);
    try { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); } catch {}
    try { Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] }); } catch {}
    try { Object.defineProperty(navigator, "platform", { get: () => "Win32" }); } catch {}
    try { Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 }); } catch {}
    try { window.chrome = window.chrome || { runtime: {} }; } catch {}
    // headless Chromium reports 0 plugins; give it a plausible non-empty list
    try { Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3] }); } catch {}
    // WebGL vendor/renderer are common automation tells
    try {
      const gp = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function (p) {
        if (p === 37445) return "Intel Inc.";
        if (p === 37446) return "Intel Iris OpenGL Engine";
        return gp.call(this, p);
      };
    } catch {}
  }).catch(() => {});
}

// Solve a captcha ourselves. Try the checkbox (often passes with a clean
// fingerprint), then fall back to the reCAPTCHA v2 audio challenge transcribed
// by Workers AI Whisper. Returns true only if the captcha is actually cleared.
async function solveCaptcha(env, page, log) {
  const anchorFrame = () => page.frames().find((f) => /recaptcha.*anchor|api2\/anchor|\/anchor\?/.test(f.url()));
  const isChecked = async () => {
    const a = anchorFrame();
    return a ? await a.evaluate(() => document.querySelector("#recaptcha-anchor")?.getAttribute("aria-checked") === "true").catch(() => false) : false;
  };
  // 1) Click the "I'm not a robot" checkbox and see if it just passes.
  const a = anchorFrame();
  if (a) {
    await a.evaluate(() => { const c = document.querySelector("#recaptcha-anchor"); if (c) c.click(); }).catch(() => {});
    await sleep(2500);
    if (await isChecked()) { log?.push("captcha: passed on checkbox"); return true; }
  }
  // 2) reCAPTCHA v2 audio challenge → Whisper.
  if (await solveRecaptchaAudio(env, page, log)) return true;
  return false;
}

async function solveRecaptchaAudio(env, page, log) {
  if (!env.AI) { log?.push("captcha: no Workers AI binding for audio solve"); return false; }
  const bframe = () => page.frames().find((f) => /api2\/bframe|\/bframe\?/.test(f.url()));
  const anchorFrame = () => page.frames().find((f) => /api2\/anchor|\/anchor\?/.test(f.url()));
  let fr = bframe();
  if (!fr) return false;
  // switch to the audio challenge
  await fr.evaluate(() => { const b = document.querySelector("#recaptcha-audio-button"); if (b) b.click(); }).catch(() => {});
  await sleep(2500);
  for (let attempt = 0; attempt < 4; attempt++) {
    fr = bframe();
    if (!fr) break;
    const blocked = await fr.evaluate(() =>
      /automated queries|try again later|your computer or network/i.test(document.body?.innerText || "")
    ).catch(() => false);
    if (blocked) { log?.push("captcha: Google blocked the audio challenge"); return false; }
    const audioUrl = await fr.evaluate(() => {
      const a = document.querySelector(".rc-audiochallenge-tdownload-link");
      if (a?.href) return a.href;
      const src = document.querySelector("#audio-source, audio source, audio");
      return src ? (src.src || src.getAttribute("src")) : null;
    }).catch(() => null);
    if (!audioUrl) return false;
    let text = "";
    try {
      const res = await fetch(audioUrl);
      const buf = new Uint8Array(await res.arrayBuffer());
      const out = await env.AI.run("@cf/openai/whisper", { audio: [...buf] });
      text = String(out?.text || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
    } catch (e) { log?.push("captcha: whisper error " + String(e?.message || e).slice(0, 50)); return false; }
    if (!text) return false;
    await fr.evaluate((t) => {
      const inp = document.querySelector("#audio-response");
      if (!inp) return;
      const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      s.call(inp, t);
      inp.dispatchEvent(new Event("input", { bubbles: true }));
    }, text).catch(() => {});
    await fr.evaluate(() => { const b = document.querySelector("#recaptcha-verify-button"); if (b) b.click(); }).catch(() => {});
    await sleep(3000);
    const anchor = anchorFrame();
    const solved = anchor && await anchor.evaluate(() =>
      document.querySelector("#recaptcha-anchor")?.getAttribute("aria-checked") === "true"
    ).catch(() => false);
    if (solved) { log?.push(`captcha: solved via Whisper audio (attempt ${attempt + 1})`); return true; }
    // otherwise a fresh audio clip loaded — loop and try again
    await sleep(1000);
  }
  return false;
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
  return /(verification code|verify your email|enter the code|we sent (?:you )?a code|confirm your email|enter the (?:6|five|six).?digit)/.test(t);
}

// Enter an emailed verification code. The email worker extracts the code from
// the relay inbox into action_items; we poll for it, type it into the code
// field (main doc or form frame), and confirm. Used both for a pre-form account
// wall and Greenhouse's post-submit "verify it's really you" step.
async function enterVerificationCode(env, frame, page, appUuid, log) {
  const code = await waitForCode(env, appUuid, 120000);
  if (!code) { log?.push("verification code not received in time"); return false; }
  // The code field can live in the main page or the form frame; some forms
  // split it into single-digit boxes.
  let ok = await fillByLabel(frame, "code", code, "text").catch(() => false);
  if (!ok) ok = await fillByLabel(page, "code", code, "text").catch(() => false);
  if (!ok) ok = await fillCodeBoxes(page, code).catch(() => false);
  await clickByText(frame, ["verify", "continue", "submit code", "confirm", "submit"]).catch(() => {});
  await clickByText(page, ["verify", "continue", "submit code", "confirm", "submit"]).catch(() => {});
  log?.push("entered verification code from relay inbox");
  return true;
}

// Some verification screens use N single-character inputs. Fill them in order.
async function fillCodeBoxes(page, code) {
  return await page.evaluate((code) => {
    const boxes = [...document.querySelectorAll("input")]
      .filter((el) => el.offsetParent !== null && el.maxLength === 1 && !["hidden", "submit", "button", "checkbox", "radio"].includes(el.type));
    if (boxes.length < code.length) return false;
    const set = (el, v) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    for (let i = 0; i < code.length; i++) set(boxes[i], code[i]);
    return true;
  }, code);
}

// ---- candidate accounts (Workday / iCIMS) -----------------------------------
// Some ATSs won't show the application until you have an account. We make one
// per (user, ats, tenant) with the vanity relay address, verify it via the
// link the employer emails to that relay, and store the credentials so every
// future application to the same employer just signs in.

// A candidate-account wall = password field(s) plus create-account / sign-in
// wording, in any frame. Returns the frame that holds it, or null.
async function detectAccountWall(page) {
  for (const fr of page.frames()) {
    const hit = await fr.evaluate(() => {
      if (!document.querySelector("input[type=password]")) return false;
      const t = (document.body?.innerText || "").toLowerCase();
      return /create account|create an account|create your account|sign in|new to |register|create profile|set up your account/.test(t);
    }).catch(() => false);
    if (hit) return fr;
  }
  return null;
}

async function ensureAccount(env, page, app, log) {
  const wallFrame = await detectAccountWall(page);
  if (!wallFrame) return { handled: false, noWall: true };
  const host = (() => { try { return new URL(page.url()).host; } catch { return ""; } })();
  const ats = app.ats || atsFromHost(host);
  const tenant = host;
  const email = relayEmailFor(env, app);
  log.push(`candidate-account wall on ${host}`);

  const existing = await env.DB.prepare(
    "SELECT email, password FROM ats_accounts WHERE user_id=? AND ats=? AND tenant=?"
  ).bind(app.user_id, ats, tenant).first().catch(() => null);

  if (existing?.password) {
    // Sign in with the account we made earlier for this employer.
    await clickByText(page, ["sign in", "log in", "sign in to your account"]).catch(() => {});
    await sleep(1200);
    const f = await detectAccountWall(page) || wallFrame;
    await fillByLabel(f, "email", existing.email, "text").catch(() => {});
    await fillByLabel(f, "password", existing.password, "text").catch(() => {});
    await clickByText(f, ["sign in", "log in", "login"]).catch(() => {});
    await clickByText(page, ["sign in", "log in", "login"]).catch(() => {});
    await sleep(3500);
    const still = await detectAccountWall(page);
    log.push(still ? "sign-in did not clear the wall" : "signed in to stored account");
    return still ? { blocked: true, reason: "couldn't sign in to the stored candidate account" }
                 : { handled: true, signedIn: true };
  }

  // No account yet — register with the vanity relay address.
  await clickByText(page, ["create account", "create an account", "new account", "sign up", "register"]).catch(() => {});
  await sleep(1200);
  const f = await detectAccountWall(page) || wallFrame;
  const password = genPassword();
  await fillByLabel(f, "email", email, "text").catch(() => {});
  await fillByLabel(f, "verify email", email, "text").catch(() => {});
  await fillPasswordFields(f, password).catch(() => {});
  await checkAgreements(f).catch(() => {});
  await clickByText(f, ["create account", "create my account", "register", "sign up", "submit", "continue"]).catch(() => {});
  await clickByText(page, ["create account", "create my account", "register", "sign up", "submit", "continue"]).catch(() => {});
  await sleep(3500);

  // Persist the credentials for this tenant (encrypt-at-rest is a tracked TODO).
  await env.DB.prepare(
    `INSERT INTO ats_accounts (id, user_id, ats, tenant, email, password, status, created_at)
     VALUES (?,?,?,?,?,?, 'pending', ?)
     ON CONFLICT(user_id, ats, tenant) DO UPDATE SET email=excluded.email, password=excluded.password, status='pending'`
  ).bind(crypto.randomUUID(), app.user_id, ats, tenant, email, password, now()).run().catch(() => {});

  // Workday usually emails a verification link before it lets you in. It lands
  // in the relay inbox → the email worker files it as a 'verification_link'
  // action item → we poll for it and navigate the browser there.
  await sleep(1500);
  const needLink = await page.evaluate(() =>
    /verify your email|confirm your email|check your (?:email|inbox)|we(?:'ve| have) sent|activation|activate your account/i.test(document.body?.innerText || "")
  ).catch(() => false);
  if (needLink || await detectAccountWall(page)) {
    log.push("waiting for account-verification link in relay inbox");
    const link = await waitForLink(env, app.uuid, 150000);
    if (!link) return { blocked: true, reason: "the employer emailed an account-verification link we didn't receive in time" };
    await page.goto(link, { waitUntil: "networkidle0", timeout: 45000 }).catch(() => {});
    await sleep(2500);
    log.push("followed account-verification link");
  }

  await env.DB.prepare("UPDATE ats_accounts SET status='verified', verified_at=? WHERE user_id=? AND ats=? AND tenant=?")
    .bind(now(), app.user_id, ats, tenant).run().catch(() => {});
  const still = await detectAccountWall(page);
  return still ? { blocked: true, reason: "created an account but couldn't get past the sign-in wall" }
               : { handled: true, created: true };
}

function relayEmailFor(env, app) {
  const slug = app.relay_slug || "candidate";
  return `${slug}@${env.RELAY_DOMAIN || "benwhetstone.info"}`;
}

// A strong random password that satisfies typical ATS complexity rules
// (upper, lower, digit, symbol). Ambiguous glyphs (0/O, 1/l/I) are excluded.
function genPassword() {
  const pick = (set, n) => {
    const a = new Uint32Array(n); crypto.getRandomValues(a);
    return [...a].map((x) => set[x % set.length]).join("");
  };
  return pick("ABCDEFGHJKLMNPQRSTUVWXYZ", 3) + pick("abcdefghijkmnpqrstuvwxyz", 5) +
         pick("23456789", 3) + pick("!@#$%*", 2);
}

// Fill "Password" and "Confirm/Verify Password" with the same value.
async function fillPasswordFields(frame, password) {
  return await frame.evaluate((pw) => {
    const boxes = [...document.querySelectorAll("input[type=password]")].filter((el) => el.offsetParent !== null);
    const set = (el, v) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    for (const b of boxes) set(b, pw);
    return boxes.length;
  }, password);
}

// Tick required agreement / terms checkboxes on a registration form.
async function checkAgreements(frame) {
  return await frame.evaluate(() => {
    let n = 0;
    for (const el of document.querySelectorAll("input[type=checkbox]")) {
      if (el.offsetParent === null || el.checked) continue;
      const t = ((el.closest("label")?.innerText || "") + " " + (el.getAttribute("aria-label") || "") +
        " " + (el.parentElement?.innerText || "")).toLowerCase();
      if (/agree|terms|privacy|consent|acknowledge|read and understood/.test(t)) { el.click(); n++; }
    }
    return n;
  });
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

// Poll D1 for an account-verification LINK the email worker extracted from the
// relay inbox into action_items (kind='verification_link').
async function waitForLink(env, appUuid, ms) {
  const deadline = Date.now() + ms;
  const since = now();
  while (Date.now() < deadline) {
    const row = await env.DB.prepare(
      `SELECT detail FROM action_items
        WHERE url = ? AND kind = 'verification_link' AND created_at >= ?
        ORDER BY created_at DESC LIMIT 1`
    ).bind(`/#application=${appUuid}`, since).first();
    if (row?.detail && /^https?:\/\//i.test(String(row.detail))) return String(row.detail);
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
  // A blocked application — a captcha we couldn't beat, a field we couldn't
  // fill — is an important update, so it also lands in the app inbox next to
  // recruiter mail, not only in the action queue.
  await env.DB.prepare(
    `INSERT INTO inbox_emails (id, user_id, application_uuid, relay_slug, from_addr, subject, body_text, category, classified_by, received_at)
     SELECT ?, a.user_id, a.uuid, a.relay_slug, ?,
            'Autopilot paused: ' || COALESCE(j.company_name, 'an application') || ' needs you',
            ?, 'info', 'system', ?
       FROM applications_v2 a LEFT JOIN jobs j ON j.uuid = a.job_uuid WHERE a.uuid = ?`
  ).bind(crypto.randomUUID(), "autopilot@jobs.benwhetstone.info",
         `We stopped the automatic submission and saved your place: ${reason}. Open the application from here and finish the last step.`,
         now(), appUuid).run().catch(() => {});
  // And a REAL email to the user's account address — a blocked application
  // shouldn't wait to be noticed. The app sends via Resend and respects the
  // user's email opt-out.
  await fetch(`${env.APP_BASE}/api/v1/admin/notify`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.ADMIN_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ appUuid, reason }),
  }).catch(() => {});
  return { ok: false, reason, screenshot: shot ? `data:image/png;base64,${shot}` : undefined };
}
function json(o, status = 200) { return new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } }); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
