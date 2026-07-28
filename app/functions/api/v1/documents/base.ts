// POST /api/v1/documents/base
// Build (or rebuild) the user's BASE résumé from their profile answers. This is
// the moment the profile interview pays off: someone who arrived with no résumé
// leaves with one, and someone who uploaded a résumé gets it restructured to
// the standards below. Every tailored copy is diffed against this base.
//
// The résumé expert's standards are encoded in the prompt (data-backed, from
// the researched best-practices file, form-and-strategy only — facts still come
// exclusively from the user's profile):
//   - value summary, never an objective; strongest number IN the summary
//   - bullets: action verb + tool + quantified result + business outcome
//   - vary metric precision; never a wall of suspiciously round numbers
//   - self-employment formatted exactly like a job, functional title, evidence
//     of answering to others (clients, compliance, oversight)
//   - every listed skill must reappear inside a bullet with a result
//   - military service translated to civilian language inside experience
import { json, err, currentUser, type Env, type CtxUser } from "../../_lib";
import { anthropic, extractJson } from "../../_ai";
import { buildVoice, styleBlock, loadRules, verify, hiringManagerGate, stripDashes, numberTokens, type CvContent } from "../../_docs";

const EXPERT_STANDARDS =
  "Résumé standards, all mandatory (2026 hiring data):\n" +
  "- Value summary, never an objective. 50-100 words. Put the single strongest number in it.\n" +
  "- Bullets follow: action verb + tool + quantified result + business outcome. 3-5 bullets for recent roles, 2-3 for older ones.\n" +
  "- Quantify scope (dataset size, users served, cadence) when outcome numbers don't exist. NEVER invent a number.\n" +
  "- Vary metric precision; identical round numbers read as fabricated.\n" +
  "- Self-employment is formatted exactly like a job: company, functional title, dates, bullets. Include evidence of answering to others (clients served, compliance, oversight).\n" +
  "- Military service goes inside experience with civilian-translated language, no separate veterans section.\n" +
  "- Every skill in the skills list must also appear inside a bullet with a result.\n";

export const onRequestPost: PagesFunction<Env, string, { user?: CtxUser }> = async ({ env, data }) => {
  const user = currentUser(data);
  if (!env.ANTHROPIC_API_KEY) return err(503, "AI isn't configured yet.");

  const vals = await env.DB.prepare("SELECT field_key, value_json FROM profile_values WHERE user_id = ?")
    .bind(user.id).all<{ field_key: string; value_json: string | null }>();
  const values: Record<string, string | null> = {};
  for (const v of vals.results ?? []) values[v.field_key] = v.value_json;

  const parse = (k: string) => { try { return JSON.parse(values[k] || "null"); } catch { return values[k]; } };
  const work = parse("st_workExperiences");
  if (!Array.isArray(work) || !work.length) {
    return err(422, "Add at least one role to your work history first — that's the raw material the résumé is built from.");
  }

  const voice = buildVoice(values);
  const rules = await loadRules(env, user.id);
  const names = (x: any) => Array.isArray(x) ? x.map((i: any) => i?.name || i).filter(Boolean) : [];
  const skills = [...names(parse("st_hardSkills")), ...names(parse("st_softSkills"))];
  const brief = [
    `Name: ${voice.firstName || parse("firstName")} ${parse("lastName") || ""}`,
    voice.headline ? `Positioning: ${voice.headline}` : "",
    `Skills (the ONLY skills you may use): ${skills.join(", ")}`,
    voice.achievements.length ? "Signature achievements:\n" + voice.achievements.map((a) => `- ${a.result}${a.metric ? ` (${a.metric})` : ""}${a.employer ? ` at ${a.employer}` : ""}`).join("\n") : "",
    "Work history:",
    ...(work as any[]).map((w: any) => `- ${w.title} at ${w.employer} (${w.startDate} to ${w.endDate || "present"}), ${w.city || ""}\n  ${w.description || ""}`),
    "Education:",
    ...((parse("st_education") as any[]) || []).map((e: any) => `- ${e.degree} ${e.fieldOfStudy || ""}, ${e.school} (${e.endDate || ""})`),
  ].filter(Boolean).join("\n");

  const system = "You write a base résumé (not tailored to any one job) from a person's real history. " +
      "Return ONLY JSON: {\"summary\": string, \"sections\": [{\"heading\": \"Title, Employer (start to end)\", \"bullets\": [string]}], \"skills\": [string]}.\n\n" +
      EXPERT_STANDARDS + "\n" + styleBlock(voice);
  const basePrompt = `PERSON\n${brief}\n\nWrite the base résumé JSON now.`;
  const src = numberTokens(JSON.stringify(Object.values(values)));

  let content: CvContent;
  let report;
  try {
    let reply = await anthropic(env, { system, content: basePrompt, maxTokens: 2600, userId: user.id, purpose: "base_resume" });
    content = stripDashes(extractJson(reply) as CvContent, voice);
    report = verify(content, skills, voice, rules, null, src);
    if (!report.passed) {
      // One self-repair pass with the exact gate failures. Invented numbers and
      // stray dashes almost always clear on the second attempt.
      reply = await anthropic(env, { system,
        content: basePrompt + `\n\nYour previous attempt failed these checks:\n- ${report.failures.join("\n- ")}\nReturn corrected JSON.`,
        maxTokens: 2600, userId: user.id, purpose: "base_resume" });
      content = stripDashes(extractJson(reply) as CvContent, voice);
      report = verify(content, skills, voice, rules, null, src);
    }
  } catch (e: any) {
    return err(502, "Résumé generation failed: " + (e?.message || "AI error"));
  }
  // Expert review of the base: what would a screener flag before any tailoring?
  const critique = await hiringManagerGate(env, content, {
    title: names(parse("st_jobTitles"))[0] || "the roles you're targeting",
    company: null,
    description: "General screen for the candidate's target roles. Judge the résumé on its own merits.",
  }, user.id);

  const now = new Date().toISOString();
  const uuid = crypto.randomUUID();
  await env.DB.prepare("UPDATE documents SET is_default = 0 WHERE user_id = ? AND kind = 'cv' AND is_default = 1")
    .bind(user.id).run();
  await env.DB.prepare(
    `INSERT INTO documents (uuid, user_id, kind, doc_type, is_default, job_uuid, parent_uuid, title,
                            content_json, verify_passed, verify_report, created_at)
     VALUES (?, ?, 'cv', 'DEFAULT', 1, NULL, NULL, 'Base résumé', ?, ?, ?, ?)`
  ).bind(uuid, user.id, JSON.stringify(content), report.passed ? 1 : 0, JSON.stringify(report), now).run();

  return json({
    uuid, content,
    verify: report,
    expertReview: critique,   // PASS / REVISE / REJECT + specific notes
  });
};
