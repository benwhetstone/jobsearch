// The fill algorithm. For each field the employer asks, in order, stop at first hit:
//   1. direct profile map   2. learned alias   3. ENUM COERCION   4. LLM   5. needs_human
//
// Step 3 is the whole differentiator. The teardown measured globalwork prefilling
// 10/18 fields on a live Greenhouse application — every success free text, and
// every one of the 8 select fields left empty. Their generator writes prose but
// cannot land a value on someone else's option list. Ben's profile is already
// stored as controlled enums, so for us that is a lookup, not a generation
// problem. Get it right and we clear applications they cannot.
//
// Never guess on a required field. A wrong answer to "are you authorized to work
// in the United States" is far worse than an unfinished application.
import type { Env } from "./_lib";
import type { AtsField } from "./_ats";

export interface FilledField {
  field: AtsField;
  value: string | null;
  source: string | null;   // profile:<key> | alias | enum | llm | null
  status: "filled" | "needs_human" | "skipped";
}

const norm = (s: string) =>
  (s || "").toLowerCase().replace(/[‘’']/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

// ---- step 1: the ~40 questions that appear on nearly every application ------
const DIRECT: [RegExp, string][] = [
  [/preferred (first )?name/,                       "applicationFirstName"],
  [/^(first|given) name$/,                          "firstName"],
  [/^(last|family|sur)\s?name$/,                    "lastName"],
  [/^(middle name|any middle name)/,                "middleName"],
  [/^(full |your )?name$/,                          "__fullName"],
  [/e ?mail/,                                       "email"],
  [/phone|mobile|cell/,                             "phone"],
  [/^(home )?address|street/,                       "address"],
  [/^city|which city|currently reside.*city/,       "city"],
  [/^state|province|region$/,                       "state"],
  [/zip|postal/,                                    "zip"],
  [/linked ?in/,                                    "linkedinProfile"],
  [/git ?hub/,                                      "github"],
  [/portfolio|personal (web)?site/,                 "portfolioLink"],
  [/country.*(reside|based|live)|^country$/,        "country"],
  [/legally authoriz|authorized to work|work authoriz|eligible to work/, "workAuthorization"],
  [/sponsor/,                                       "requiresSponsorship"],
  [/veteran/,                                       "veteranStatus"],
  [/disab/,                                         "disabilityStatus"],
  [/gender/,                                        "gender"],
  [/(race|ethnic)/,                                 "raceEthnicity"],
  [/hispanic|latino/,                               "raceEthnicity"],
  [/salary|compensation expect|desired pay/,        "baseSalary"],
  [/(start date|available to start|when can you start)/, "availableStartDate"],
  [/relocat/,                                       "relocationReadiness"],
  [/(highest )?(level of )?education|degree/,       "highestEducation"],
  [/current or previous employer|current (employer|firm|company|organization)/, "__currentEmployer"],
  [/current or previous job title|current title/,   "__currentTitle"],
  [/years of experience/,                           "__yearsExperience"],
  [/how did you hear/,                              "__howHeard"],
];

// ---- step 3: enum -> the employer's wording --------------------------------
// Each profile enum maps to phrases we expect to find in an option list. Matching
// is done against the employer's options, never the other way round.
const SYNONYMS: Record<string, string[]> = {
  // work authorization
  US_CITIZEN: ["yes", "authorized", "us citizen", "citizen", "legally authorized", "no sponsorship"],
  PERMANENT_RESIDENT: ["permanent resident", "green card", "authorized", "yes"],
  VISA_HOLDER: ["visa", "authorized with visa", "yes"],
  NOT_AUTHORIZED: ["no", "not authorized"],
  // yes/no style
  YES: ["yes", "y", "true"],
  NO: ["no", "n", "false"],
  TRUE: ["yes", "true"],
  FALSE: ["no", "false"],
  // veteran
  PROTECTED_VETERAN: ["i identify as one or more of the classifications of a protected veteran",
                      "yes", "protected veteran", "i am a protected veteran"],
  NOT_A_VETERAN: ["i am not a protected veteran", "no", "not a veteran"],
  // disability
  DISABILITY_YES: ["yes i have", "yes", "i have a disability"],
  DISABILITY_NO: ["no i do not", "no", "i dont have a disability"],
  // decline
  PREFER_NOT_TO_SAY: ["decline", "prefer not", "i do not wish", "dont wish to answer",
                      "i dont want to answer", "choose not to disclose", "not disclose"],
  // education
  HIGH_SCHOOL: ["high school", "ged", "secondary"],
  ASSOCIATE: ["associate"],
  BACHELOR: ["bachelor", "bs", "ba", "undergraduate", "4 year"],
  MASTER: ["master", "ms", "ma", "mba", "graduate"],
  DOCTORATE: ["doctor", "phd"],
  // relocation
  WILLING_TO_RELOCATE: ["yes", "willing to relocate", "open to relocation"],
  NOT_WILLING_TO_RELOCATE: ["no", "not willing"],
  DEPENDS_ON_LOCATION: ["depends", "case by case", "maybe", "yes"],
};

// Score how well an employer option matches a candidate phrase. Exact beats
// prefix beats containment; anything weaker is not trusted.
function optionScore(optionLabel: string, phrase: string): number {
  const o = norm(optionLabel), p = norm(phrase);
  if (!o || !p) return 0;
  if (o === p) return 1.0;
  if (o.startsWith(p) || p.startsWith(o)) return 0.9;
  if (o.includes(p)) return 0.8;
  if (p.includes(o) && o.length >= 3) return 0.7;
  return 0;
}

export function coerceToOption(
  value: unknown, options: { value: string; label: string }[]
): { value: string; confidence: number } | null {
  if (value == null || !options.length) return null;
  const raw = String(typeof value === "boolean" ? (value ? "YES" : "NO") : value);
  // candidate phrasings: the enum's synonyms, plus the raw value humanised
  const phrases = [...(SYNONYMS[raw.toUpperCase()] || []), raw.replace(/_/g, " ")];
  let best: { value: string; confidence: number } | null = null;
  for (const opt of options) {
    for (const ph of phrases) {
      const s = optionScore(opt.label, ph);
      if (s > (best?.confidence ?? 0)) best = { value: opt.value, confidence: s };
    }
  }
  // Below this the "match" is coincidence, and a confident wrong answer on an
  // EEO or authorization question is the worst outcome in the whole product.
  return best && best.confidence >= 0.7 ? best : null;
}

// ---- profile helpers --------------------------------------------------------
function parse(v: string | null | undefined): unknown {
  if (v == null) return null;
  try { return JSON.parse(v); } catch { return v; }
}

function derived(key: string, values: Record<string, string | null>): unknown {
  const g = (k: string) => parse(values[k]);
  if (key === "__fullName") return [g("firstName"), g("lastName")].filter(Boolean).join(" ") || null;
  if (key === "__currentEmployer" || key === "__currentTitle") {
    const w = g("st_workExperiences");
    if (!Array.isArray(w) || !w.length) return null;
    const cur = (w as any[]).find((e) => !e?.endDate) || w[0];
    return key === "__currentEmployer" ? cur?.employer ?? null : cur?.title ?? null;
  }
  if (key === "__yearsExperience") {
    const w = g("st_workExperiences");
    if (!Array.isArray(w) || !w.length) return null;
    const years = (w as any[]).reduce((min: number, e: any) => {
      const m = String(e?.startDate || "").match(/(\d{4})/);
      return m ? Math.min(min, Number(m[1])) : min;
    }, 9999);
    return years === 9999 ? null : String(new Date().getFullYear() - years);
  }
  if (key === "__howHeard") return "Company website";
  return null;
}

// ---- the algorithm ----------------------------------------------------------
export async function fillFields(
  env: Env,
  fields: AtsField[],
  values: Record<string, string | null>,
  opts: { generate?: (f: AtsField) => Promise<string | null> } = {}
): Promise<FilledField[]> {
  // learned aliases (step 2)
  const aliasRows = await env.DB.prepare("SELECT alias_text, field_key FROM profile_field_aliases")
    .all<{ alias_text: string; field_key: string }>().catch(() => ({ results: [] as any[] }));
  const aliases = new Map((aliasRows.results ?? []).map((r) => [norm(r.alias_text), r.field_key]));

  const out: FilledField[] = [];
  for (const f of fields) {
    const ln = norm(f.label);

    // The résumé is attached as a file by the browser step, not typed here.
    if (f.type === "file") {
      out.push({ field: f, value: null, source: "document", status: "filled" });
      continue;
    }

    // 1 + 2: find which profile field answers this question
    let fieldKey: string | null = null;
    for (const [re, key] of DIRECT) if (re.test(ln)) { fieldKey = key; break; }
    if (!fieldKey && aliases.has(ln)) fieldKey = aliases.get(ln)!;

    let raw: unknown = null;
    if (fieldKey) raw = fieldKey.startsWith("__") ? derived(fieldKey, values) : parse(values[fieldKey]);

    if (raw != null && raw !== "") {
      // 3: enum coercion onto the employer's own option list
      if (f.options.length) {
        const c = coerceToOption(raw, f.options);
        if (c) { out.push({ field: f, value: c.value, source: "enum", status: "filled" }); continue; }
        // We hold a value but cannot land it on their list — ask rather than guess.
        out.push({ field: f, value: null, source: null, status: "needs_human" });
        continue;
      }
      const v = Array.isArray(raw) ? raw.join(", ") : String(raw);
      out.push({ field: f, value: v, source: `profile:${fieldKey}`, status: "filled" });
      continue;
    }

    // 4: genuinely open questions get written, but only free text
    if (!f.options.length && (f.type === "textarea" || (f.type === "text" && f.label.length > 40)) && opts.generate) {
      const gen = await opts.generate(f).catch(() => null);
      if (gen) { out.push({ field: f, value: gen, source: "llm", status: "filled" }); continue; }
    }

    // 5: never guess
    out.push({ field: f, value: null, source: null, status: f.required ? "needs_human" : "skipped" });
  }
  return out;
}
