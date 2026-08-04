// GET   /api/v1/applications/:uuid  -> everything the review screen needs:
//        the tailored résumé (with redline vs the base), the cover letter, the
//        gate verdict, and the employer's mirrored form with fill status.
// PATCH /api/v1/applications/:uuid  -> { answers: [{fieldUuid, value}] } fill
//        remaining fields (writes a learned alias so the question never comes
//        back), and/or { action: "approve" } once nothing needs a human.
//
// Approve marks the application ready for the browser step on the desktop
// client. Nothing in this file submits anything to an employer.
import { json, err, currentUser, logActivity, type Env, type CtxUser } from "../../_lib";
import { redline, cvToText, type CvContent } from "../../_docs";
import { submitToAts } from "../../_submit";
import { prepare } from "./index";

type Ctx = { user?: CtxUser };
const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
// Use a caller-supplied timestamp when it's a valid ISO string, stored VERBATIM
// so an offset (e.g. "2026-08-03T19:30:00-04:00") is preserved and the date
// doesn't roll forward a day in UTC. Falls back to the server's now.
const stampFrom = (v: unknown, fallback: string): string =>
  (typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v))) ? v : fallback;

export const onRequestGet: PagesFunction<Env, string, Ctx> = async ({ params, env, data }) => {
  const user = currentUser(data);
  const uuid = String(params.uuid);

  const app = await env.DB.prepare(
    `SELECT a.*, j.title, j.company_name, j.location, j.url AS job_url, j.apply_url, j.description
       FROM applications_v2 a JOIN jobs j ON j.uuid = a.job_uuid
      WHERE a.uuid = ? AND a.user_id = ?`
  ).bind(uuid, user.id).first<any>();
  if (!app) return err(404, "No such application.");

  const [cv, cover, fields, activity] = await Promise.all([
    app.cv_uuid ? env.DB.prepare("SELECT * FROM documents WHERE uuid = ?").bind(app.cv_uuid).first<any>() : null,
    app.cover_letter_uuid ? env.DB.prepare("SELECT * FROM documents WHERE uuid = ?").bind(app.cover_letter_uuid).first<any>() : null,
    env.DB.prepare(
      "SELECT uuid, field_key, field_type, label, value, options_json, required, sort_order, fill_source, fill_status FROM application_form_fields WHERE application_uuid = ? ORDER BY sort_order"
    ).bind(uuid).all<any>(),
    env.DB.prepare(
      "SELECT id, kind, message, meta_json, created_at FROM activity_log WHERE user_id = ? AND application_uuid = ? ORDER BY created_at DESC LIMIT 200"
    ).bind(user.id, uuid).all<any>(),
  ]);

  // redline: tailored CV against the user's base CV (if one exists)
  let diff: { op: string; text: string }[] | null = null;
  if (cv) {
    const baseRow = cv.parent_uuid
      ? await env.DB.prepare("SELECT content_json FROM documents WHERE uuid = ?").bind(cv.parent_uuid).first<any>()
      : await env.DB.prepare("SELECT content_json FROM documents WHERE user_id = ? AND kind='cv' AND is_default=1")
          .bind(user.id).first<any>();
    if (baseRow) {
      try {
        diff = redline(cvToText(JSON.parse(baseRow.content_json)), cvToText(JSON.parse(cv.content_json)));
      } catch { diff = null; }
    }
  }

  const parse = (s: string | null) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
  return json({
    uuid: app.uuid, status: app.status, ats: app.ats, needManualApply: !!app.need_manual_apply,
    gateVerdict: app.gate_verdict, gateNotes: parse(app.gate_report) || [],
    matchScore: app.match_score == null ? null : Math.round(app.match_score * 100),
    prepareError: app.prepare_error, submittedAt: app.submitted_at,
    resumeUrl: app.resume_url, coverUrl: app.cover_url, jobId: app.job_id,
    activity: (activity?.results ?? []).map((e: any) => ({
      id: e.id, kind: e.kind, message: e.message,
      meta: parse(e.meta_json), createdAt: e.created_at,
    })),
    job: { title: app.title, company: app.company_name, location: app.location,
           url: app.job_url, applyUrl: app.apply_url },
    cv: cv ? { uuid: cv.uuid, content: parse(cv.content_json), verifyPassed: !!cv.verify_passed,
               verifyReport: parse(cv.verify_report), diff } : null,
    coverLetter: cover ? { uuid: cover.uuid, content: parse(cover.content_json),
                           verifyPassed: !!cover.verify_passed, verifyReport: parse(cover.verify_report) } : null,
    fields: (fields?.results ?? []).map((f: any) => ({
      uuid: f.uuid, key: f.field_key, type: f.field_type, label: f.label, value: f.value,
      options: parse(f.options_json) || [], required: !!f.required,
      fillSource: f.fill_source, fillStatus: f.fill_status,
    })),
  });
};

export const onRequestPatch: PagesFunction<Env, string, Ctx> = async ({ params, request, env, data, waitUntil }) => {
  const user = currentUser(data);
  const uuid = String(params.uuid);
  const app = await env.DB.prepare("SELECT uuid, status FROM applications_v2 WHERE uuid = ? AND user_id = ?")
    .bind(uuid, user.id).first<{ uuid: string; status: string }>();
  if (!app) return err(404, "No such application.");

  let body: any;
  try { body = await request.json(); } catch { return err(400, "Invalid JSON body."); }
  const now = new Date().toISOString();

  // ---- answer outstanding fields ----
  if (Array.isArray(body.answers) && body.answers.length) {
    for (const a of body.answers) {
      const f = await env.DB.prepare(
        "SELECT uuid, label FROM application_form_fields WHERE uuid = ? AND application_uuid = ?"
      ).bind(String(a.fieldUuid || ""), uuid).first<{ uuid: string; label: string }>();
      if (!f) continue;
      const value = a.value == null ? null : String(a.value).slice(0, 4000);
      await env.DB.prepare(
        "UPDATE application_form_fields SET value = ?, fill_source = 'human', fill_status = 'filled' WHERE uuid = ?"
      ).bind(value, f.uuid).run();
      // Learn from the human: if they told us which profile field answers this
      // question, the alias means it never needs asking again.
      if (a.learnFieldKey) {
        await env.DB.prepare(
          `INSERT INTO profile_field_aliases (field_key, alias_text, source, hit_count, created_at)
           VALUES (?, ?, 'learned', 0, ?)
           ON CONFLICT(field_key, alias_text) DO NOTHING`
        ).bind(String(a.learnFieldKey), norm(f.label), now).run().catch(() => {});
      }
    }
  }

  // ---- attach generated document links (Cowork saved them to Drive) ----
  if (body.action === "attachDocs") {
    const rUrl = String(body.resumeUrl || "").trim() || null;
    const cUrl = String(body.coverUrl || "").trim() || null;
    if (!rUrl && !cUrl) return err(400, "Provide resumeUrl and/or coverUrl.");
    await env.DB.prepare(
      "UPDATE applications_v2 SET resume_url = COALESCE(?, resume_url), cover_url = COALESCE(?, cover_url), updated_at = ? WHERE uuid = ?"
    ).bind(rUrl, cUrl, new Date().toISOString(), uuid).run();
    await logActivity(env, user.id, { applicationUuid: uuid, kind: "tailored",
      message: `Attached ${[rUrl && "résumé", cUrl && "cover letter"].filter(Boolean).join(" + ")}.`,
      meta: { resumeUrl: rUrl, coverUrl: cUrl } });
    return json({ uuid, resumeUrl: rUrl, coverUrl: cUrl });
  }

  // ---- correct the descriptors on a queued/applied row (title, location, url).
  //      These live on the jobs row; a placeholder queued before the real title
  //      was known ("Req R-0011925", "TBD") can be fixed here without creating a
  //      second row. Company/date/status are not touched.
  if (body.action === "update") {
    const title = body.title != null ? String(body.title).trim().slice(0, 300) : null;
    const location = body.location != null ? String(body.location).trim().slice(0, 200) : null;
    const url = body.url != null ? String(body.url).trim().slice(0, 1000) : null;
    if (title == null && location == null && url == null) return err(400, "Provide title, location, and/or url to update.");
    await env.DB.prepare(
      `UPDATE jobs SET title = COALESCE(?, title), location = COALESCE(?, location),
         url = COALESCE(?, url), apply_url = COALESCE(?, apply_url)
       WHERE uuid = (SELECT job_uuid FROM applications_v2 WHERE uuid = ? AND user_id = ?)`
    ).bind(title, location, url, url, uuid, user.id).run();
    await logActivity(env, user.id, { applicationUuid: uuid, kind: "note",
      message: `Corrected ${[title != null && "title", location != null && "location", url != null && "url"].filter(Boolean).join(", ")}.`,
      meta: { title, location, url } });
    return json({ uuid, updated: { title, location, url } });
  }

  // ---- manual submit done: the user applied on the employer's site ----
  if (body.action === "markApplied") {
    const at = stampFrom(body.submittedAt ?? body.appliedAt ?? body.at, now);
    await env.DB.prepare("UPDATE applications_v2 SET status = 'applied', submitted_at = ?, updated_at = ? WHERE uuid = ?")
      .bind(at, now, uuid).run();
    await resolveActionItems(env, user.id, uuid);
    await logActivity(env, user.id, { applicationUuid: uuid, kind: "applied", message: "Marked applied." });
    return json({ uuid, status: "applied" });
  }

  // ---- manual pipeline movement: a phone call, an email the inbox missed,
  //      or any update from outside the system. Persisted like any other move.
  if (body.action === "setStatus") {
    const allowed = new Set(["applied", "interview", "offer", "rejected", "withdrawn"]);
    const to = String(body.status || "");
    if (!allowed.has(to)) return err(400, `status must be one of: ${[...allowed].join(", ")}`);
    const at = stampFrom(body.submittedAt ?? body.appliedAt ?? body.at, now);
    // A provided timestamp also back-stamps submitted_at when moving to applied.
    if (to === "applied") {
      await env.DB.prepare("UPDATE applications_v2 SET status = ?, submitted_at = COALESCE(submitted_at, ?), updated_at = ? WHERE uuid = ?")
        .bind(to, at, now, uuid).run();
    } else {
      await env.DB.prepare("UPDATE applications_v2 SET status = ?, updated_at = ? WHERE uuid = ?")
        .bind(to, now, uuid).run();
    }
    if (to !== "actionRequired") await resolveActionItems(env, user.id, uuid);
    await logActivity(env, user.id, { applicationUuid: uuid, kind: "status", message: `Status → ${to}.` });
    return json({ uuid, status: to });
  }

  // ---- regenerate: re-tailor the résumé, cover letter, and form fills from
  //      the CURRENT profile. For when the user sharpened their answers (or
  //      changed template) and wants fresh documents before submitting.
  if (body.action === "regenerate") {
    const job = await env.DB.prepare(
      `SELECT j.uuid, j.title, j.company_name, j.description, j.url, j.apply_url, j.source
         FROM applications_v2 a JOIN jobs j ON j.uuid = a.job_uuid WHERE a.uuid = ? AND a.user_id = ?`
    ).bind(uuid, user.id).first<any>();
    if (!job) return err(404, "No such application.");
    // clear the old mirrored form fields; prepare() re-mirrors and refills
    await env.DB.prepare("DELETE FROM application_form_fields WHERE application_uuid = ?").bind(uuid).run();
    await env.DB.prepare("UPDATE applications_v2 SET status = 'preparing', updated_at = ? WHERE uuid = ?")
      .bind(new Date().toISOString(), uuid).run();
    waitUntil(prepare(env, user, uuid, job, { skipOnReject: false }));
    return json({ uuid, status: "preparing", regenerating: true });
  }

  // ---- discard: the user said no to this one ----
  if (body.action === "discard") {
    await env.DB.prepare("UPDATE applications_v2 SET status = 'discarded', updated_at = ? WHERE uuid = ?")
      .bind(new Date().toISOString(), uuid).run();
    await resolveActionItems(env, user.id, uuid);
    return json({ uuid, status: "discarded" });
  }

  // ---- move back to Jobs: undo starting an application. Drops it from the
  //      funnel and un-applies the match so the job reappears in "Jobs For
  //      You", ready to reconsider. Only meaningful before submission.
  if (body.action === "moveBack") {
    const now = new Date().toISOString();
    await env.DB.prepare("UPDATE applications_v2 SET status = 'discarded', updated_at = ? WHERE uuid = ?")
      .bind(now, uuid).run();
    await env.DB.prepare(
      "UPDATE matches SET status = 'matched' WHERE user_id = ? AND job_uuid = (SELECT job_uuid FROM applications_v2 WHERE uuid = ?)"
    ).bind(user.id, uuid).run();
    await resolveActionItems(env, user.id, uuid);
    return json({ uuid, status: "movedBack" });
  }

  // ---- approve: the final QA gate before anything can be submitted ----
  // Three checks, all hard: every employer question answered, and BOTH
  // documents passed their quality gates. A failed document never ships.
  if (body.action === "approve") {
    const open = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM application_form_fields WHERE application_uuid = ? AND fill_status = 'needs_human'"
    ).bind(uuid).first<{ n: number }>();
    if ((open?.n ?? 0) > 0) return err(409, `${open!.n} question(s) still need your answer before approving.`);
    const full = await env.DB.prepare("SELECT cv_uuid, cover_letter_uuid FROM applications_v2 WHERE uuid = ?")
      .bind(uuid).first<{ cv_uuid: string | null; cover_letter_uuid: string | null }>();
    for (const [label, docUuid] of [["résumé", full?.cv_uuid], ["cover letter", full?.cover_letter_uuid]] as const) {
      if (!docUuid) return err(409, `No ${label} exists for this application yet.`);
      const d = await env.DB.prepare("SELECT verify_passed, verify_report FROM documents WHERE uuid = ?")
        .bind(docUuid).first<{ verify_passed: number; verify_report: string | null }>();
      if (!d?.verify_passed) {
        let why: string[] = [];
        try { why = JSON.parse(d?.verify_report || "{}").failures || []; } catch { /* */ }
        return err(409, `QA blocked the ${label}: ${why[0] || "it did not pass the quality gate"}. Regenerate it before approving.`);
      }
    }
    await env.DB.prepare("UPDATE applications_v2 SET status = 'approved', updated_at = ? WHERE uuid = ?")
      .bind(new Date().toISOString(), uuid).run();
    await resolveActionItems(env, user.id, uuid);
    // Approval was the human gate. From here the machine files it with the
    // employer's ATS where the board accepts a direct post; if that path is
    // blocked (captcha, unsupported board) it falls back to manual with an
    // action item saying why.
    const appRow = await env.DB.prepare("SELECT supported_ats, ats, need_manual_apply FROM applications_v2 WHERE uuid = ?")
      .bind(uuid).first<{ supported_ats: number; ats: string | null; need_manual_apply: number }>();
    // Two submission paths, both after the human gate:
    //  1. form-post ATSs (Greenhouse/Lever) — filed server-side, no browser.
    //  2. everything else with a real application URL — driven by the
    //     browser-apply worker (Workday/Workable/iCIMS/Ashby), like globalwork.
    const directPost = !!appRow?.supported_ats && ["greenhouse", "lever"].includes(appRow?.ats || "");
    const browserApply = !directPost && !!env.BROWSER_APPLY_URL && !appRow?.need_manual_apply;
    if (directPost || browserApply) {
      await env.DB.prepare("UPDATE applications_v2 SET status = 'applying', updated_at = ? WHERE uuid = ?")
        .bind(new Date().toISOString(), uuid).run();
      if (directPost) waitUntil(submitToAts(env, user.id, uuid));
      else waitUntil(dispatchBrowserApply(env, uuid));
      return json({ uuid, status: "applying", submitting: true, via: directPost ? "direct" : "browser" });
    }
    return json({ uuid, status: "approved", submitting: false });
  }

  // An action was named but matched nothing above. NEVER fall through to the
  // answers-recompute below — that silently rewrites a submitted application to
  // 'readyToApply' and returns 200, which reads as "unfinished" and invites a
  // duplicate apply. Reject it loudly and change nothing.
  if (body.action != null && String(body.action).trim() !== "") {
    return err(400, `Unknown action "${String(body.action).slice(0, 40)}". No change made. ` +
      `Valid actions: update, attachDocs, markApplied, setStatus, regenerate, discard, moveBack, approve.`);
  }

  // No action: this is an answers-only submission. Recompute status from whether
  // any employer question still needs the user.
  const open = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM application_form_fields WHERE application_uuid = ? AND fill_status = 'needs_human'"
  ).bind(uuid).first<{ n: number }>();
  const status = (open?.n ?? 0) > 0 ? "actionRequired" : (app.status === "approved" ? "approved" : "readyToApply");
  await env.DB.prepare("UPDATE applications_v2 SET status = ?, updated_at = ? WHERE uuid = ?")
    .bind(status, new Date().toISOString(), uuid).run();
  // Once nothing is waiting on the user, clear the queue entry so the actions
  // banner and the notification email stop nagging about it.
  if (status !== "actionRequired") await resolveActionItems(env, user.id, uuid);
  return json({ uuid, status, needsHuman: open?.n ?? 0 });
};

// Hand an approved application to the browser-apply worker. Fire-and-forget:
// the worker drives the employer's real form and writes status back to D1.
async function dispatchBrowserApply(env: Env, appUuid: string): Promise<void> {
  try {
    await fetch(env.BROWSER_APPLY_URL!, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.APP_ADMIN_TOKEN || ""}` },
      body: JSON.stringify({ appUuid }),
    });
  } catch { /* worker writes its own failure state; nothing to do here */ }
}

async function resolveActionItems(env: Env, userId: string, appUuid: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE action_items SET status = 'done', resolved_at = ? WHERE user_id = ? AND url = ? AND status = 'pending'"
  ).bind(new Date().toISOString(), userId, `/#application=${appUuid}`).run().catch(() => {});
}
