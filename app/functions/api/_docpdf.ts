// Shared résumé/cover-letter PDF builder, used by both the user-facing
// document endpoint and the admin endpoint the browser-apply worker calls.
// Keyed by the document's own user_id so it needs no session.
import { renderCvPdf, renderCoverPdf, TEMPLATE_NAMES, type Contact, type CvExtras } from "./_pdf";
import type { Env } from "./_lib";

export interface RenderedDoc { bytes: Uint8Array; filename: string; kind: string }

export async function renderDocumentPdf(
  env: Env, docUuid: string, opts: { userId?: string; templateOverride?: string } = {}
): Promise<RenderedDoc | null> {
  const doc = opts.userId
    ? await env.DB.prepare("SELECT kind, content_json, job_uuid, user_id FROM documents WHERE uuid = ? AND user_id = ?")
        .bind(docUuid, opts.userId).first<any>()
    : await env.DB.prepare("SELECT kind, content_json, job_uuid, user_id FROM documents WHERE uuid = ?")
        .bind(docUuid).first<any>();
  if (!doc) return null;
  const userId = doc.user_id as string;

  const vals = await env.DB.prepare(
    `SELECT field_key, value_json FROM profile_values WHERE user_id = ?
      AND field_key IN ('firstName','lastName','applicationFirstName','email','phone','city','state',
                        'linkedinProfile','portfolioLink','resumeTemplate','st_education','st_professionalCredential',
                        'st_hardSkills','st_workExperiences','employerDescriptions')`
  ).bind(userId).all<{ field_key: string; value_json: string | null }>();
  const v: Record<string, any> = {};
  for (const r of vals.results ?? []) { try { v[r.field_key] = JSON.parse(r.value_json || "null"); } catch { v[r.field_key] = r.value_json; } }

  const user = await env.DB.prepare("SELECT name, email FROM users WHERE id = ?").bind(userId).first<any>();
  const contact: Contact = {
    name: [v.applicationFirstName || v.firstName, v.lastName].filter(Boolean).join(" ") || user?.name || "Candidate",
    email: v.email || user?.email, phone: v.phone, city: v.city, state: v.state,
    linkedin: v.linkedinProfile, website: v.portfolioLink,
  };

  const qt = (opts.templateOverride || "").toLowerCase();
  const template = TEMPLATE_NAMES.includes(qt) ? qt : String(v.resumeTemplate || "classic").toLowerCase();

  let content: any;
  try { content = JSON.parse(doc.content_json); } catch { return null; }

  const arr = (x: any) => (Array.isArray(x) ? x : []);
  const work = arr(v.st_workExperiences);
  const military = work.map((w: any) => `${w.employer || ""} ${w.title || ""}`).join(" ").match(/\b(army|navy|air force|marine|coast guard)\b/i);
  const hard = arr(v.st_hardSkills);
  const working = hard.filter((s: any) => (s?.level || "") !== "BEGINNER").map((s: any) => s?.name || s).filter(Boolean);
  const inProgress = [
    ...hard.filter((s: any) => s?.level === "BEGINNER").map((s: any) => s?.name || s),
    ...arr(v.st_professionalCredential).map((c: any) => c?.name || c)
      .filter((n: any) => typeof n === "string" && /\(in progress\)/i.test(n)).map((n: string) => n.replace(/\s*\(in progress\)\s*/i, "")),
  ].filter(Boolean);
  const extras: CvExtras = {
    education: arr(v.st_education),
    certs: arr(v.st_professionalCredential).map((c: any) => c?.name || c).filter((n: any) => typeof n === "string" && !/\(in progress\)/i.test(n)),
    tagline: hard.slice(0, 4).map((x: any) => x?.name || x).filter(Boolean).join(" \xb7 ") || null,
    credentialLine: military ? `U.S. ${military[1]} veteran`.toUpperCase() : null,
    employerSublines: arr(v.employerDescriptions).filter((e: any) => e?.employer && e?.description),
    skillGroups: [{ label: "Skills", items: working }, ...(inProgress.length ? [{ label: "In progress", items: inProgress }] : [])],
  };

  if (doc.kind === "cv") {
    return { kind: "cv", bytes: renderCvPdf(content, contact, template, extras),
             filename: `${contact.name.replace(/\s+/g, "-")}-Resume.pdf` };
  }
  let company: string | null = null;
  if (doc.job_uuid) {
    const j = await env.DB.prepare("SELECT company_name FROM jobs WHERE uuid = ?").bind(doc.job_uuid).first<any>();
    company = j?.company_name ?? null;
  }
  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  return { kind: "cover_letter", bytes: renderCoverPdf(content, contact, { company, date }, template, extras),
           filename: `${contact.name.replace(/\s+/g, "-")}-Cover-Letter.pdf` };
}
