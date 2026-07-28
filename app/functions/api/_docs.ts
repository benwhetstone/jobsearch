// Tailored résumé and cover letter, written in THE USER'S voice.
//
// Nothing tenant-specific is hardcoded here. The voice comes from the
// resumeVoice profile block (tone, bullet style, banned words, employer
// descriptions, metric phrasing), and per-user writing_rules rows become the
// validation gate. Universal rules only — never invent an employer, a date, or
// a skill — live in code, because they are true for everyone.
import type { Env } from "./_lib";
import { anthropic, extractJson } from "./_ai";

export interface CvSection { heading: string; bullets: string[]; }
export interface CvContent { summary: string; sections: CvSection[]; skills: string[]; }
export interface CoverContent { greeting: string; paragraphs: string[]; closing: string; }
export interface VerifyReport { passed: boolean; failures: string[]; warnings: string[]; }

const parse = (v: string | null | undefined): any => { if (v == null) return null; try { return JSON.parse(v); } catch { return v; } };
const names = (x: unknown): string[] => Array.isArray(x) ? (x as any[]).map((i: any) => i?.name || i).filter((s) => typeof s === "string") : [];

// ---- the user's voice, assembled from their own answers ----------------------
export interface Voice {
  firstName: string | null;
  headline: string | null;
  narrative: string | null;
  employerDescriptions: { employer: string; description: string }[];
  achievements: { result: string; metric?: string; employer?: string }[];
  metricPhrasing: { number: string; phrasing: string }[];
  proudestWork: string | null;
  tone: string; bulletStyle: string; coverLength: string;
  avoidWords: string[]; avoidEmDash: boolean;
  skillsSource: string; forbiddenSkills: string[];
  template: string;
}

export function buildVoice(values: Record<string, string | null>): Voice {
  const arr = (k: string) => { const v = parse(values[k]); return Array.isArray(v) ? v : []; };
  const str = (k: string) => { const v = parse(values[k]); return typeof v === "string" && v.trim() ? v : null; };
  return {
    firstName: str("applicationFirstName") || str("firstName"),
    headline: str("professionalHeadline"),
    narrative: str("careerNarrative"),
    employerDescriptions: arr("employerDescriptions"),
    achievements: arr("signatureAchievements"),
    metricPhrasing: arr("metricPhrasing"),
    proudestWork: str("proudestWork"),
    tone: str("writingTone") || "PLAIN_AND_DIRECT",
    bulletStyle: str("bulletStyle") || "OUTCOME_FIRST_WITH_METRICS",
    coverLength: str("coverLetterLength") || "FOUR_PARAGRAPHS",
    avoidWords: (parse(values.avoidWords) as string[]) || [],
    avoidEmDash: parse(values.avoidEmDash) === true,
    skillsSource: str("skillsSource") || "PROFILE_ONLY",
    forbiddenSkills: ((parse(values.forbiddenSkills) as string[]) || []).map((s) => s.toLowerCase()),
    template: (str("resumeTemplate") || "CLASSIC").toLowerCase(),
  };
}

const TONE_TEXT: Record<string, string> = {
  PLAIN_AND_DIRECT: "Plain and direct. Short sentences. No filler, no superlatives.",
  WARM_AND_PERSONABLE: "Warm and personable while staying professional. Write like a considerate colleague.",
  FORMAL_AND_PRECISE: "Formal and precise. Complete sentences, measured vocabulary, no contractions.",
  CONFIDENT_AND_PUNCHY: "Confident and punchy. Strong verbs, short lines, momentum.",
};
const BULLET_TEXT: Record<string, string> = {
  OUTCOME_FIRST_WITH_METRICS: "Every bullet leads with the outcome or number, then how it was achieved.",
  ACTION_THEN_RESULT: "Every bullet opens with a strong verb and ends with the result.",
  SCOPE_AND_RESPONSIBILITY: "Bullets describe scope and ownership: team size, budget, surface area.",
  SHORT_AND_PUNCHY: "Bullets are one line each, never more.",
};
const LENGTH_TEXT: Record<string, string> = {
  THREE_TIGHT_PARAGRAPHS: "exactly three tight paragraphs",
  FOUR_PARAGRAPHS: "four paragraphs at most",
  ONE_PAGE: "a full but single page",
  SHORT_NOTE: "a short note of two paragraphs",
};

// Style instructions generated from the user's answers, not from anyone's CLAUDE.md.
export function styleBlock(v: Voice): string {
  const lines = [
    "Style rules, all mandatory:",
    `- ${TONE_TEXT[v.tone] || TONE_TEXT.PLAIN_AND_DIRECT}`,
    `- ${BULLET_TEXT[v.bulletStyle] || BULLET_TEXT.OUTCOME_FIRST_WITH_METRICS}`,
    "- Never invent an employer, a title, a date, a metric, or a skill.",
    "- Skills may only come from the provided skills list, never from the posting.",
  ];
  if (v.avoidEmDash) lines.push("- Never use an em dash or en dash. Use a colon or a full stop.");
  if (v.avoidWords.length) lines.push(`- Never use these words: ${v.avoidWords.join(", ")}.`);
  if (v.forbiddenSkills.length) lines.push(`- Never list these as skills: ${v.forbiddenSkills.join(", ")}.`);
  for (const e of v.employerDescriptions) lines.push(`- Describe ${e.employer} as "${e.description}".`);
  for (const m of v.metricPhrasing) lines.push(`- When citing ${m.number}: ${m.phrasing}.`);
  if (v.narrative) lines.push(`- Career framing: ${v.narrative}`);
  return lines.join("\n");
}

// ---- the gate -----------------------------------------------------------------
export interface RuleRow { pattern: string; requires: string | null; forbids: number; message: string; severity: string; }

export async function loadRules(env: Env, userId: string): Promise<RuleRow[]> {
  const r = await env.DB.prepare(
    "SELECT pattern, requires, forbids, message, severity FROM writing_rules WHERE user_id = ?"
  ).bind(userId).all<RuleRow>().catch(() => ({ results: [] as RuleRow[] }));
  return r.results ?? [];
}

function allText(doc: CvContent | CoverContent): string {
  return "sections" in doc
    ? [doc.summary, ...doc.sections.flatMap((s) => [s.heading, ...s.bullets]), ...doc.skills].join("\n")
    : [doc.greeting, ...doc.paragraphs, doc.closing].join("\n");
}

export function verify(
  doc: CvContent | CoverContent, profileSkills: string[], voice: Voice, rules: RuleRow[],
  jobTitle?: string | null
): VerifyReport {
  const failures: string[] = [];
  const warnings: string[] = [];
  const text = allText(doc);
  // The employer's own words are exempt: citing the role "Data and AI Lead" is
  // not claiming AI as a skill. A hit on a banned term is excused only when it
  // sits right next to other words from the job title (models paraphrase, so
  // exact-title stripping is not enough: "Data and AI Lead role in Finance").
  const titleTokens = new Set(
    (jobTitle || "").toLowerCase().split(/[^a-z0-9+#]+/).filter((t) => t.length > 1)
  );
  const excused = (matchStart: number, matchEnd: number): boolean => {
    if (!titleTokens.size) return false;
    const ctx = text.slice(Math.max(0, matchStart - 40), matchEnd + 40).toLowerCase();
    const near = ctx.split(/[^a-z0-9+#]+/).filter((t) => titleTokens.has(t)).length;
    return near >= 3; // the banned word plus at least two of its title neighbours
  };
  const hits = (re: RegExp): boolean => {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = g.exec(text)) !== null) {
      if (!excused(m.index, m.index + m[0].length)) return true;
      if (m.index === g.lastIndex) g.lastIndex++;
    }
    return false;
  };

  // universal rules
  if (voice.avoidEmDash && /—|–/.test(text)) failures.push("Contains an em or en dash.");
  for (const w of voice.avoidWords) {
    if (hits(new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"))) {
      failures.push(`Uses a banned word: "${w}".`);
    }
  }

  // the user's own rules
  for (const r of rules) {
    let re: RegExp;
    try { re = new RegExp(r.pattern, "i"); } catch { continue; }
    const bucket = r.severity === "warn" ? warnings : failures;
    if (r.forbids && hits(re)) bucket.push(r.message);
    if (!r.forbids && re.test(text) && r.requires && !new RegExp(r.requires, "i").test(text)) bucket.push(r.message);
  }

  if ("skills" in doc) {
    const allowed = new Set(profileSkills.map((s) => s.toLowerCase()));
    // whole-word match: "AI" must flag "AI" but never "Attention to Detail"
    const isForbidden = (skill: string) =>
      voice.forbiddenSkills.some((f) =>
        new RegExp(`(^|[^a-z0-9])${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(skill));
    for (const s of doc.skills) {
      const low = s.toLowerCase();
      if (isForbidden(low)) failures.push(`Skill "${s}" is on the do-not-list.`);
      else if (voice.skillsSource === "PROFILE_ONLY" && !allowed.has(low)) {
        failures.push(`Skill "${s}" is not in the profile. Skills come from the profile only.`);
      }
    }
    if (!doc.summary?.trim()) failures.push("Summary is empty.");
    if (!doc.sections?.length) failures.push("No experience sections.");
  } else if (!doc.paragraphs?.length) {
    failures.push("Cover letter has no body.");
  }
  return { passed: failures.length === 0, failures, warnings };
}

// ---- writing ------------------------------------------------------------------
function profileBrief(values: Record<string, string | null>, v: Voice): { brief: string; skills: string[] } {
  const p = (k: string) => parse(values[k]);
  const skills = [...names(p("st_hardSkills")), ...names(p("st_softSkills"))];
  const work = (p("st_workExperiences") as any[]) || [];
  const edu = (p("st_education") as any[]) || [];
  const brief = [
    `Name: ${v.firstName || p("firstName") || ""} ${p("lastName") || ""}`,
    `Location: ${p("city") || ""}, ${p("state") || ""}`,
    v.headline ? `Positioning: ${v.headline}` : "",
    `Skills (the ONLY skills you may use): ${skills.join(", ")}`,
    `Domains: ${names(p("st_industryDomainKnowledge")).join(", ")}`,
    v.achievements.length ? "\nSignature achievements (place first when relevant):" : "",
    ...v.achievements.map((a) => `- ${a.result}${a.metric ? ` (${a.metric})` : ""}${a.employer ? ` at ${a.employer}` : ""}`),
    v.proudestWork ? `\nProudest work: ${v.proudestWork}` : "",
    "\nWork history:",
    ...work.map((w: any) => `- ${w.title} at ${w.employer} (${w.startDate} to ${w.endDate || "present"}), ${w.city || ""}\n  ${w.description || ""}`),
    "\nEducation:",
    ...edu.map((e: any) => `- ${e.degree} ${e.fieldOfStudy || ""}, ${e.school} (${e.endDate || ""})`),
  ].filter(Boolean).join("\n");
  return { brief, skills };
}

// Models sneak dashes into date ranges no matter what the prompt says. When the
// user bans them, fix it mechanically instead of failing the document over
// punctuation: date-range dashes become "to", everything else becomes a colon.
function stripDashes<T>(doc: T, voice: Voice): T {
  if (!voice.avoidEmDash) return doc;
  const fix = (s: string) =>
    s.replace(/(\d|present)\s*[—–]\s*(?=\d|present)/gi, "$1 to ")
     .replace(/\s*[—–]\s*/g, ": ");
  const walk = (x: any): any =>
    typeof x === "string" ? fix(x)
    : Array.isArray(x) ? x.map(walk)
    : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, walk(v)]))
    : x;
  return walk(doc);
}

const CV_SHAPE = '{"summary": string, "sections": [{"heading": "Title, Employer (start to end)", "bullets": [string]}], "skills": [string]}';

export async function tailorCv(
  env: Env, userId: string, values: Record<string, string | null>,
  job: { title: string; company: string | null; description: string | null }
): Promise<{ content: CvContent; report: VerifyReport; voice: Voice }> {
  const voice = buildVoice(values);
  const rules = await loadRules(env, userId);
  const { brief, skills } = profileBrief(values, voice);
  const system =
    "You tailor an existing résumé to one job posting. Re-order, re-weight and re-word what the candidate " +
    "has actually done so the most relevant work leads. Return ONLY JSON matching the given shape.\n\n" +
    styleBlock(voice);
  const prompt =
    `CANDIDATE\n${brief}\n\nTARGET ROLE\n${job.title} at ${job.company || "the employer"}\n\n` +
    `POSTING\n${(job.description || "").slice(0, 6000)}\n\n` +
    `Return JSON exactly matching: ${CV_SHAPE}\n` +
    `Every section heading must correspond to a real role above. 3 to 5 bullets for recent roles, fewer for older. ` +
    `"skills" ordered by relevance to this posting.`;

  const reply = await anthropic(env, { system, content: prompt, maxTokens: 2600 });
  const content = stripDashes(extractJson(reply) as CvContent, voice);
  return { content, report: verify(content, skills, voice, rules, job.title), voice };
}

export async function tailorCoverLetter(
  env: Env, userId: string, values: Record<string, string | null>,
  job: { title: string; company: string | null; description: string | null }
): Promise<{ content: CoverContent; report: VerifyReport }> {
  const voice = buildVoice(values);
  const rules = await loadRules(env, userId);
  const { brief, skills } = profileBrief(values, voice);
  const system =
    `You write a specific cover letter: ${LENGTH_TEXT[voice.coverLength] || LENGTH_TEXT.FOUR_PARAGRAPHS}. ` +
    "Concrete, drawn only from the candidate's real history. Return ONLY JSON.\n\n" + styleBlock(voice);
  const prompt =
    `CANDIDATE\n${brief}\n\nROLE\n${job.title} at ${job.company || "the employer"}\n\n` +
    `POSTING\n${(job.description || "").slice(0, 5000)}\n\n` +
    `Return JSON: {"greeting": string, "paragraphs": [string], "closing": string}\n` +
    `Open with why this specific role. One paragraph must cite a concrete result from the history above.`;
  const reply = await anthropic(env, { system, content: prompt, maxTokens: 1400 });
  const content = stripDashes(extractJson(reply) as CoverContent, voice);
  return { content, report: verify(content, skills, voice, rules, job.title) };
}

// Hiring-manager gate: would this get a first-round call, honestly?
export async function hiringManagerGate(
  env: Env, cv: CvContent, job: { title: string; company: string | null; description: string | null }
): Promise<{ verdict: "PASS" | "REVISE" | "REJECT"; notes: string[] }> {
  const system =
    "You are a hiring manager screening résumés for this exact role. Six seconds per résumé, sceptical of " +
    'career changers. Judge only what is written. Return ONLY JSON {"verdict":"PASS"|"REVISE"|"REJECT","notes":[string]}. ' +
    "PASS means you would grant a first-round call. REVISE means fixable gaps: list them specifically.";
  const prompt =
    `ROLE\n${job.title} at ${job.company || ""}\n\nPOSTING\n${(job.description || "").slice(0, 4000)}\n\n` +
    `RESUME\n${JSON.stringify(cv).slice(0, 6000)}`;
  try {
    const reply = await anthropic(env, { system, content: prompt, maxTokens: 900 });
    const r = extractJson(reply) as { verdict: string; notes: string[] };
    const v = ["PASS", "REVISE", "REJECT"].includes(r?.verdict) ? r.verdict as any : "REVISE";
    return { verdict: v, notes: Array.isArray(r?.notes) ? r.notes : [] };
  } catch {
    return { verdict: "REVISE", notes: ["The hiring-manager review could not be completed."] };
  }
}

// Word-level LCS diff for the redline view.
export function redline(baseText: string, newText: string): { op: "same" | "add" | "del"; text: string }[] {
  const a = (baseText || "").split(/(\s+)/), b = (newText || "").split(/(\s+)/);
  const n = a.length, m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { op: "same" | "add" | "del"; text: string }[] = [];
  const push = (op: "same" | "add" | "del", t: string) => {
    const last = out[out.length - 1];
    if (last && last.op === op) last.text += t; else out.push({ op, text: t });
  };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { push("same", a[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push("del", a[i]); i++; }
    else { push("add", b[j]); j++; }
  }
  while (i < n) push("del", a[i++]);
  while (j < m) push("add", b[j++]);
  return out;
}

export function cvToText(c: CvContent): string {
  return [c.summary, ...c.sections.flatMap((s) => [s.heading, ...s.bullets]), "Skills: " + c.skills.join(", ")].join("\n");
}
