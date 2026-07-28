// GET   /api/v1/applications/:uuid  -> everything the review screen needs:
//        the tailored résumé (with redline vs the base), the cover letter, the
//        gate verdict, and the employer's mirrored form with fill status.
// PATCH /api/v1/applications/:uuid  -> { answers: [{fieldUuid, value}] } fill
//        remaining fields (writes a learned alias so the question never comes
//        back), and/or { action: "approve" } once nothing needs a human.
//
// Approve marks the application ready for the browser step on the desktop
// client. Nothing in this file submits anything to an employer.
import { json, err, currentUser, type Env, type CtxUser } from "../../_lib";
import { redline, cvToText, type CvContent } from "../../_docs";

type Ctx = { user?: CtxUser };
const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

export const onRequestGet: PagesFunction<Env, string, Ctx> = async ({ params, env, data }) => {
  const user = currentUser(data);
  const uuid = String(params.uuid);

  const app = await env.DB.prepare(
    `SELECT a.*, j.title, j.company_name, j.location, j.url AS job_url, j.apply_url, j.description
       FROM applications a JOIN jobs j ON j.uuid = a.job_uuid
      WHERE a.uuid = ? AND a.user_id = ?`
  ).bind(uuid, user.id).first<any>();
  if (!app) return err(404, "No such application.");

  const [cv, cover, fields] = await Promise.all([
    app.cv_uuid ? env.DB.prepare("SELECT * FROM documents WHERE uuid = ?").bind(app.cv_uuid).first<any>() : null,
    app.cover_letter_uuid ? env.DB.prepare("SELECT * FROM documents WHERE uuid = ?").bind(app.cover_letter_uuid).first<any>() : null,
    env.DB.prepare(
      "SELECT uuid, field_key, field_type, label, value, options_json, required, sort_order, fill_source, fill_status FROM application_form_fields WHERE application_uuid = ? ORDER BY sort_order"
    ).bind(uuid).all<any>(),
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

export const onRequestPatch: PagesFunction<Env, string, Ctx> = async ({ params, request, env, data }) => {
  const user = currentUser(data);
  const uuid = String(params.uuid);
  const app = await env.DB.prepare("SELECT uuid, status FROM applications WHERE uuid = ? AND user_id = ?")
    .bind(uuid, user.id).first<{ uuid: string; status: string }>();
  if (!app) return err(404, "No such application.");

  let body: any;
  try { body = await request.json(); } catch { return err(400, "Invalid JSON body."); }

  // ---- answer outstanding fields ----
  if (Array.isArray(body.answers) && body.answers.length) {
    const now = new Date().toISOString();
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

  // ---- approve: only when nothing still needs a human ----
  if (body.action === "approve") {
    const open = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM application_form_fields WHERE application_uuid = ? AND fill_status = 'needs_human'"
    ).bind(uuid).first<{ n: number }>();
    if ((open?.n ?? 0) > 0) return err(409, `${open!.n} question(s) still need your answer before approving.`);
    await env.DB.prepare("UPDATE applications SET status = 'approved', updated_at = ? WHERE uuid = ?")
      .bind(new Date().toISOString(), uuid).run();
    return json({ uuid, status: "approved" });
  }

  // recompute status after answers
  const open = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM application_form_fields WHERE application_uuid = ? AND fill_status = 'needs_human'"
  ).bind(uuid).first<{ n: number }>();
  const status = (open?.n ?? 0) > 0 ? "actionRequired" : (app.status === "approved" ? "approved" : "readyToApply");
  await env.DB.prepare("UPDATE applications SET status = ?, updated_at = ? WHERE uuid = ?")
    .bind(status, new Date().toISOString(), uuid).run();
  return json({ uuid, status, needsHuman: open?.n ?? 0 });
};
