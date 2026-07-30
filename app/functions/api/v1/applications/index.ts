// GET  /api/v1/applications        -> the pipeline
// POST /api/v1/applications        -> { jobUuid }  = "Apply". Starts autopilot.
//
// Apply does NOT open the posting and it does NOT submit anything. It resolves
// the employer's real applicant tracking system, tailors the résumé and cover
// letter, runs the gate, mirrors the employer's form and prefills it, then stops
// at whatever still needs a human. Submission is a separate, approved step.
import { json, err, currentUser, type Env, type CtxUser } from "../../_lib";
import { resolveBoard, refFromUrl, fetchForm, boardJobs, type AtsRef } from "../../_ats";
import { fillFields } from "../../_fill";
import { tailorCv, tailorCoverLetter, hiringManagerGate, verify, cvToText } from "../../_docs";
import { anthropic } from "../../_ai";

const uuid = () => crypto.randomUUID();
const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

interface JobRow {
  uuid: string; title: string; company_name: string | null; description: string | null;
  url: string; apply_url: string | null; source: string;
}

export const onRequestGet: PagesFunction<Env, string, { user?: CtxUser }> = async ({ env, data }) => {
  const user = currentUser(data);
  const rows = await env.DB.prepare(
    `SELECT a.uuid, a.status, a.ats, a.need_manual_apply, a.gate_verdict, a.match_score,
            a.prepare_error, a.created_at, a.submitted_at, a.cv_uuid, a.cover_letter_uuid, a.job_uuid,
            j.title, j.company_name, j.location, j.remote, j.salary_min, j.salary_max, j.url, j.apply_url,
            (SELECT COUNT(*) FROM application_form_fields f
              WHERE f.application_uuid = a.uuid AND f.fill_status = 'needs_human') AS needs,
            (SELECT COUNT(*) FROM application_form_fields f WHERE f.application_uuid = a.uuid) AS total
       FROM applications_v2 a JOIN jobs j ON j.uuid = a.job_uuid
      WHERE a.user_id = ? AND a.status != 'discarded' ORDER BY a.created_at DESC`
  ).bind(user.id).all<any>();

  const apps = (rows.results ?? []).map((r) => ({
    uuid: r.uuid, status: r.status, ats: r.ats, needManualApply: !!r.need_manual_apply,
    gateVerdict: r.gate_verdict, matchScore: r.match_score == null ? null : Math.round(r.match_score * 100),
    prepareError: r.prepare_error, cvUuid: r.cv_uuid, coverLetterUuid: r.cover_letter_uuid, jobUuid: r.job_uuid,
    fields: { total: r.total, needsHuman: r.needs },
    createdAt: r.created_at, submittedAt: r.submitted_at,
    job: { title: r.title, company: r.company_name, location: r.location, remote: !!r.remote,
           salaryMin: r.salary_min, salaryMax: r.salary_max, url: r.url, applyUrl: r.apply_url },
  }));
  const counts: Record<string, number> = {};
  for (const a of apps) counts[a.status] = (counts[a.status] || 0) + 1;
  return json({ applications: apps, counts }, { totalRecords: apps.length });
};

export const onRequestPost: PagesFunction<Env, string, { user?: CtxUser }> = async ({ request, env, data }) => {
  const user = currentUser(data);
  let body: any;
  try { body = await request.json(); } catch { return err(400, "Invalid JSON body."); }
  const jobUuid = String(body?.jobUuid || "");
  if (!jobUuid) return err(400, "jobUuid is required.");

  const job = await env.DB.prepare(
    "SELECT uuid, title, company_name, description, url, apply_url, source FROM jobs WHERE uuid = ?"
  ).bind(jobUuid).first<JobRow>();
  if (!job) return err(404, "No such job.");

  const existing = await env.DB.prepare("SELECT uuid FROM applications_v2 WHERE user_id = ? AND job_uuid = ?")
    .bind(user.id, jobUuid).first<{ uuid: string }>();
  if (existing) return json({ uuid: existing.uuid, alreadyStarted: true });

  const now = new Date().toISOString();
  const appUuid = uuid();
  const match = await env.DB.prepare("SELECT total_score FROM matches WHERE user_id = ? AND job_uuid = ?")
    .bind(user.id, jobUuid).first<{ total_score: number }>();

  await env.DB.prepare(
    `INSERT INTO applications_v2 (uuid, user_id, job_uuid, status, match_score, created_at, updated_at)
     VALUES (?, ?, ?, 'preparing', ?, ?, ?)`
  ).bind(appUuid, user.id, jobUuid, match?.total_score ?? null, now, now).run();

  await env.DB.prepare("UPDATE matches SET status = 'applied' WHERE user_id = ? AND job_uuid = ?")
    .bind(user.id, jobUuid).run();

  try {
    await prepare(env, user, appUuid, job);
  } catch (e: any) {
    await env.DB.prepare("UPDATE applications_v2 SET status = 'failed', prepare_error = ?, updated_at = ? WHERE uuid = ?")
      .bind(String(e?.message || e).slice(0, 400), new Date().toISOString(), appUuid).run();
  }

  const out = await env.DB.prepare("SELECT status, ats, need_manual_apply, gate_verdict FROM applications_v2 WHERE uuid = ?")
    .bind(appUuid).first<any>();
  return json({ uuid: appUuid, status: out?.status, ats: out?.ats,
                needManualApply: !!out?.need_manual_apply, gateVerdict: out?.gate_verdict });
};

// ---- the autopilot run ------------------------------------------------------
export async function prepare(env: Env, user: CtxUser, appUuid: string, job: JobRow,
                               opts: { skipOnReject?: boolean } = {}): Promise<void> {
  const now = () => new Date().toISOString();

  // 1. find the employer's real application. Aggregator links are interstitials
  //    and can never be submitted, so we resolve the company to its ATS instead.
  let ref: AtsRef | null = refFromUrl(job.apply_url || job.url);
  if (!ref && job.company_name) {
    const board = await resolveBoard(env, job.company_name);
    if (board) {
      // find this exact role on their board
      const listed = await boardJobs(board, job.title).catch(() => []);
      const want = norm(job.title);
      const found = listed.find((l) => norm(l.title) === want)
                 || listed.find((l) => norm(l.title).includes(want) || want.includes(norm(l.title)));
      if (found) ref = { ...board, jobId: found.externalId };
    }
  }

  // 2. profile
  const vals = await env.DB.prepare("SELECT field_key, value_json FROM profile_values WHERE user_id = ?")
    .bind(user.id).all<{ field_key: string; value_json: string | null }>();
  const values: Record<string, string | null> = {};
  for (const v of vals.results ?? []) values[v.field_key] = v.value_json;

  // Apply with the user's REAL email (the connected Gmail address, falling back
  // to their account email). Recruiter replies land in their own inbox and the
  // Gmail scan advances the tracker — no relay alias, no per-tenant relay
  // domain to manage. A relay slug is still recorded for legacy/optional use.
  const nameOf = (k: string) => { try { const v = JSON.parse(values[k] || '""'); return typeof v === "string" ? v : ""; } catch { return values[k] || ""; } };
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const first = clean(nameOf("applicationFirstName") || nameOf("firstName")).slice(0, 8) || "cand";
  const last3 = clean(nameOf("lastName")).slice(0, 3);
  const hex6 = appUuid.replace(/-/g, "").slice(0, 6);
  const num = parseInt(hex6, 16) % 1000;            // stable tag from the app id
  const relaySlug = last3 ? `${first}_${last3}${num}` : `${first}${num}`;
  const gm = await env.DB.prepare("SELECT email FROM oauth_credentials WHERE user_id = ? AND provider = 'gmail'").bind(user.id).first<{ email: string | null }>();
  const applyEmail = gm?.email && gm.email.includes("@") ? gm.email : user.email;
  values.email = JSON.stringify(applyEmail);

  // 3. tailor documents + run the gate. In bulk mode the order is sequential
  //    and a gate REJECT stops the spend right there: no cover letter, no form
  //    fill, no LLM answers for a job not worth submitting to.
  const jd = { title: job.title, company: job.company_name, description: job.description };
  const cv = await tailorCv(env, user.id, values, jd);
  const gate = cv.report.passed ? await hiringManagerGate(env, cv.content, jd, user.id)
                                : { verdict: "REVISE" as const, notes: cv.report.failures };
  const stopEarly = opts.skipOnReject && gate.verdict === "REJECT";
  const cover = stopEarly
    ? { content: { greeting: "", paragraphs: [], closing: "" }, report: { passed: false, failures: ["Skipped: the hiring-manager gate rejected this fit before the cover letter was written."], warnings: [] } }
    : await tailorCoverLetter(env, user.id, values, jd);

  const base = await env.DB.prepare(
    "SELECT uuid FROM documents WHERE user_id = ? AND kind = 'cv' AND is_default = 1"
  ).bind(user.id).first<{ uuid: string }>();

  const cvUuid = uuid(), clUuid = uuid();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO documents (uuid, user_id, kind, doc_type, is_default, job_uuid, parent_uuid, title,
                              content_json, verify_passed, verify_report, created_at)
       VALUES (?, ?, 'cv', 'TAILORED', 0, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(cvUuid, user.id, job.uuid, base?.uuid ?? null, `${job.title} at ${job.company_name || ""}`,
           JSON.stringify(cv.content), cv.report.passed ? 1 : 0, JSON.stringify(cv.report), now()),
    env.DB.prepare(
      `INSERT INTO documents (uuid, user_id, kind, doc_type, is_default, job_uuid, parent_uuid, title,
                              content_json, verify_passed, verify_report, created_at)
       VALUES (?, ?, 'cover_letter', 'TAILORED', 0, ?, NULL, ?, ?, ?, ?, ?)`
    ).bind(clUuid, user.id, job.uuid, `Cover letter: ${job.company_name || job.title}`,
           JSON.stringify(cover.content), cover.report.passed ? 1 : 0, JSON.stringify(cover.report), now()),
  ]);

  // 4. mirror the employer's form and prefill it
  let fieldCount = 0, needsHuman = 0;
  if (ref && !stopEarly) {
    const form = await fetchForm(ref).catch(() => []);
    if (form.length) {
      const cvText = cvToText(cv.content);
      const filled = await fillFields(env, form, values, {
        // Only genuinely open questions reach the model, prompted with the real
        // posting and the tailored résumé so the answer is specific.
        generate: async (f) => {
          const reply = await anthropic(env, {
            system: "Answer this job-application question as the candidate, in their voice. Two to four " +
                    "sentences. Specific, drawn only from the résumé provided. Never use an em dash. " +
                    "Return the answer text only.",
            content: `QUESTION\n${f.label}\n\nROLE\n${job.title} at ${job.company_name || ""}\n\n` +
                     `POSTING\n${(job.description || "").slice(0, 2500)}\n\nRESUME\n${cvText.slice(0, 3000)}`,
            maxTokens: 320, userId: user.id, purpose: "form_answer",
          });
          return reply.trim() || null;
        },
      });
      const stmts = filled.map((ff, i) => env.DB.prepare(
        `INSERT INTO application_form_fields
           (uuid, application_uuid, field_key, field_type, label, label_normalized, value, options_json,
            required, sort_order, fill_source, fill_status, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(uuid(), appUuid, ff.field.key, ff.field.type, ff.field.label, norm(ff.field.label),
             ff.value, JSON.stringify(ff.field.options), ff.field.required ? 1 : 0, i,
             ff.source, ff.status, now()));
      for (let i = 0; i < stmts.length; i += 40) await env.DB.batch(stmts.slice(i, i + 40));
      fieldCount = filled.length;
      needsHuman = filled.filter((f) => f.status === "needs_human").length;
    }
  }

  // 5. status. actionRequired if the employer still needs something only Ben can
  //    answer, or if the gate wants changes before this goes out.
  const manual = !ref || fieldCount === 0;
  const status = gate.verdict === "REJECT" ? "actionRequired"
               : needsHuman > 0 ? "actionRequired"
               : gate.verdict === "REVISE" ? "actionRequired"
               : "readyToApply";

  await env.DB.prepare(
    `UPDATE applications_v2 SET ats = ?, ats_token = ?, ats_job_id = ?, supported_ats = ?, need_manual_apply = ?,
            status = ?, cv_uuid = ?, cover_letter_uuid = ?, gate_verdict = ?, gate_report = ?, relay_slug = ?, updated_at = ?
      WHERE uuid = ?`
  ).bind(ref?.ats ?? null, ref?.token ?? null, ref?.jobId ?? null, ref ? 1 : 0, manual ? 1 : 0,
         status, cvUuid, clUuid, gate.verdict, JSON.stringify(gate.notes), relaySlug, now(), appUuid).run();

  // Anything that stops and waits for the user goes on the action-required
  // queue, which is what the actions banner shows and the notification email
  // runner drains. Deep link resolves the item once it's handled.
  if (status === "actionRequired") {
    const bits: string[] = [];
    if (needsHuman > 0) bits.push(`${needsHuman} question${needsHuman === 1 ? " needs" : "s need"} your answer`);
    if (gate.verdict !== "PASS") bits.push(`the hiring-manager check says ${gate.verdict}`);
    await env.DB.prepare(
      `INSERT INTO action_items (id, user_id, kind, title, detail, url, status, created_at)
       VALUES (?, ?, 'action_required', ?, ?, ?, 'pending', ?)`
    ).bind(
      uuid(), user.id,
      `Your ${job.company_name || ""} application needs you`.replace(/\s+/g, " ").trim(),
      `${job.title}: ${bits.join(", ")}.`,
      `/#application=${appUuid}`, now()
    ).run().catch(() => {});
  }
}
