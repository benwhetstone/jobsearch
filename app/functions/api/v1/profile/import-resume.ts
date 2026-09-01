// POST /api/v1/profile/import-resume
// Accepts a résumé as an uploaded file (PDF / image) OR JSON { text }. Sends it
// to Claude, which extracts structured values mapped to the profile fields.
// Values are validated against each field's type/enum, then applied to fields
// the user hasn't filled yet; anything that conflicts comes back as a suggestion.
import { json, err, currentUser, type Env, type CtxUser } from "../../_lib";
import { anthropic, extractJson, toBase64, type Block } from "../../_ai";

type Ctx = { user?: CtxUser };

interface FieldDef {
  field_key: string; block_key: string; category_key: string;
  field_type: string; question: string | null; options_json: string; help_text: string | null;
}

// Item-shape hints for the taxonomy/object_array fields.
const OBJ_HINTS: Record<string, string> = {
  st_hardSkills: 'array of {"name": string, "level": "BEGINNER|INTERMEDIATE|ADVANCED|EXPERT"}',
  st_softSkills: 'array of {"name": string}',
  st_jobTitles: 'array of {"name": string}  (desired/target job titles)',
  st_industryDomainKnowledge: 'array of {"name": string}',
  workLanguage: 'array of {"name": string, "level": "BASIC|INTERMEDIATE|PROFESSIONAL|FLUENT|NATIVE"}',
  st_professionalCredential: 'array of {"name": string}',
  st_workExperiences: 'array of {"title","employer","city","startDate":"YYYY-MM or YYYY","endDate":"YYYY-MM/blank if current","description"}',
  st_education: 'array of {"degree","school","fieldOfStudy","city","startDate":"year","endDate":"year"}',
  signatureAchievements: 'array of {"result": string, "metric": string, "employer": string} — only quantified wins actually stated in the résumé',
  employerDescriptions: 'array of {"employer": string, "description": string} — only where the résumé itself explains what a company does',
};

// Fields we ask the model to extract (contact + professional history/skills, plus
// the parts of Résumé & Voice a résumé actually evidences).
// Never EEO, eligibility, or preferences — those aren't on a résumé.
// Never tone, avoid-words or template either: a résumé shows what someone has
// done, not how they want future documents to sound. Those stay for the user.
const VOICE_FROM_RESUME = new Set([
  "professionalHeadline",    // a summary/objective line, if present
  "signatureAchievements",   // quantified wins already written down
  "employerDescriptions",    // how lesser-known employers are described
  "careerNarrative",         // an explicit career-change framing, if present
  "proudestWork",
]);

function extractable(f: FieldDef): boolean {
  if (f.block_key === "personalDetails") return f.category_key === "personalInfo" || f.category_key === "digitalPresence";
  if (f.block_key === "professionalProfile") return true;
  if (f.block_key === "resumeVoice") return VOICE_FROM_RESUME.has(f.field_key);
  return false;
}

function fieldSpecLine(f: FieldDef): string {
  const opts: string[] = (() => { try { return JSON.parse(f.options_json) || []; } catch { return []; } })();
  let t = f.field_type;
  if (OBJ_HINTS[f.field_key]) t = OBJ_HINTS[f.field_key];
  else if (opts.length) t = `one of [${opts.join(", ")}]`;
  const label = f.question || f.field_key;
  return `- ${f.field_key} (${t}): ${label}`;
}

function coerce(f: FieldDef, value: unknown): { ok: boolean; value?: unknown } {
  const opts: string[] = (() => { try { return JSON.parse(f.options_json) || []; } catch { return []; } })();
  const hasEnum = opts.length > 0;
  switch (f.field_type) {
    case "number": { const n = Number(value); if (!Number.isFinite(n)) return { ok: false };
      if (hasEnum && !opts.includes(String(n))) return { ok: false }; return { ok: true, value: n }; }
    case "boolean": return typeof value === "boolean" ? { ok: true, value } : { ok: false };
    case "string": { if (typeof value !== "string" || !value.trim()) return { ok: false };
      if (hasEnum && !opts.includes(value)) return { ok: false }; return { ok: true, value }; }
    case "string_array": { if (!Array.isArray(value)) return { ok: false };
      let a = value.filter((x) => typeof x === "string");
      if (hasEnum) a = a.filter((x) => opts.includes(x as string));
      return a.length ? { ok: true, value: a } : { ok: false }; }
    case "object_array": { if (!Array.isArray(value)) return { ok: false };
      const a = value.filter((x) => x && typeof x === "object" && !Array.isArray(x));
      return a.length ? { ok: true, value: a } : { ok: false }; }
    default: return { ok: false };
  }
}

export const onRequestPost: PagesFunction<Env, string, Ctx> = async ({ request, env, data }) => {
  const user = currentUser(data);
  if (!env.ANTHROPIC_API_KEY) return err(503, "AI isn't configured yet (no ANTHROPIC_API_KEY).");

  // ---- read the résumé (file or text) ----
  let resumeBlocks: Block[];
  const ctype = request.headers.get("content-type") || "";
  try {
    if (ctype.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return err(400, "Attach a résumé file as `file`.");
      const buf = await file.arrayBuffer();
      if (buf.byteLength > 8 * 1024 * 1024) return err(413, "Résumé too large (max 8 MB).");
      const b64 = toBase64(buf);
      const mt = file.type || "";
      if (mt.includes("pdf")) resumeBlocks = [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }];
      else if (mt.startsWith("image/")) resumeBlocks = [{ type: "image", source: { type: "base64", media_type: mt, data: b64 } }];
      else {
        const text = new TextDecoder().decode(buf).slice(0, 60000);
        if (!text.trim()) return err(400, "Could not read that file. Upload a PDF, an image, or paste the text.");
        resumeBlocks = [{ type: "text", text }];
      }
    } else {
      const body: any = await request.json();
      const text = (body?.text || "").toString().slice(0, 60000);
      if (!text.trim()) return err(400, "Provide résumé `text` or upload a file.");
      resumeBlocks = [{ type: "text", text }];
    }
  } catch {
    return err(400, "Could not read the résumé.");
  }

  // ---- build the extraction spec from the live field definitions ----
  const fieldsRes = await env.DB.prepare(
    "SELECT field_key, block_key, category_key, field_type, question, options_json, help_text FROM profile_fields ORDER BY sort_order"
  ).all<FieldDef>();
  const fields = (fieldsRes.results ?? []).filter(extractable);
  const defByKey = new Map(fields.map((f) => [f.field_key, f]));
  const spec = fields.map(fieldSpecLine).join("\n");

  const system =
    "You extract structured data from a résumé. Return ONLY a single JSON object mapping field_key to value. " +
    "Include a field ONLY if the résumé clearly supports it; omit everything else (do not guess). " +
    "Enum values must match EXACTLY one of the allowed options. Dates as shown. No commentary.";
  const prompt =
    "Extract this person's information into these fields:\n\n" + spec +
    "\n\nRésumé follows. Respond with only the JSON object.";

  // ---- call Claude ----
  let extracted: Record<string, unknown>;
  try {
    const reply = await anthropic(env, {
      system,
      content: [{ type: "text", text: prompt }, ...resumeBlocks],
      maxTokens: 3000, userId: user.id, purpose: "resume_parse",
    });
    extracted = extractJson(reply);
  } catch (e: any) {
    return err(502, "Résumé parsing failed: " + (e?.message || "AI error"));
  }
  if (!extracted || typeof extracted !== "object") return err(502, "The parser returned nothing usable.");

  // ---- validate + apply (fill empties; conflicts become suggestions) ----
  const existing = await env.DB.prepare("SELECT field_key, value_json FROM profile_values WHERE user_id = ?")
    .bind(user.id).all<{ field_key: string; value_json: string | null }>();
  const filled = new Set((existing.results ?? []).filter((r) => r.value_json && r.value_json !== "null").map((r) => r.field_key));

  const now = new Date().toISOString();
  const applied: { fieldKey: string; value: unknown }[] = [];
  const suggestions: { fieldKey: string; value: unknown }[] = [];
  const statements: D1PreparedStatement[] = [];

  for (const [key, raw] of Object.entries(extracted)) {
    const def = defByKey.get(key);
    if (!def) continue;
    const c = coerce(def, raw);
    if (!c.ok) continue;
    if (filled.has(key)) { suggestions.push({ fieldKey: key, value: c.value }); continue; }
    statements.push(
      env.DB.prepare("INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES (?, ?, ?, ?)")
        .bind(user.id, key, JSON.stringify(c.value), now)
    );
    applied.push({ fieldKey: key, value: c.value });
  }
  if (statements.length) await env.DB.batch(statements);

  return json({ applied, suggestions, appliedCount: applied.length, suggestionCount: suggestions.length });
};
