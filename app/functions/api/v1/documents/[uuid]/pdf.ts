// GET /api/v1/documents/:uuid/pdf?template=classic|modern|compact|executive
// The tailored (or base) document as a real PDF — the file that gets uploaded
// to the ATS. Template defaults to the user's Résumé & Voice choice.
import { err, currentUser, type Env, type CtxUser } from "../../../_lib";
import { renderCvPdf, renderCoverPdf, TEMPLATE_NAMES, type Contact, type CvExtras } from "../../../_pdf";

export const onRequestGet: PagesFunction<Env, string, { user?: CtxUser }> = async ({ params, request, env, data }) => {
  const user = currentUser(data);
  const uuid = String(params.uuid);
  const doc = await env.DB.prepare(
    "SELECT kind, title, content_json, job_uuid, verify_passed FROM documents WHERE uuid = ? AND user_id = ?"
  ).bind(uuid, user.id).first<any>();
  if (!doc) return err(404, "No such document.");

  const vals = await env.DB.prepare(
    `SELECT field_key, value_json FROM profile_values WHERE user_id = ?
      AND field_key IN ('firstName','lastName','applicationFirstName','email','phone','city','state',
                        'linkedinProfile','portfolioLink','resumeTemplate','st_education','st_professionalCredential',
                        'st_hardSkills','st_workExperiences','employerDescriptions')`
  ).bind(user.id).all<{ field_key: string; value_json: string | null }>();
  const v: Record<string, string | null> = {};
  for (const r of vals.results ?? []) {
    try { v[r.field_key] = JSON.parse(r.value_json || "null"); } catch { v[r.field_key] = r.value_json; }
  }
  const contact: Contact = {
    name: [v.applicationFirstName || v.firstName, v.lastName].filter(Boolean).join(" ") || user.name || "Candidate",
    email: v.email || user.email, phone: v.phone, city: v.city, state: v.state, linkedin: v.linkedinProfile,
    website: v.portfolioLink,
  };

  const url = new URL(request.url);
  const qt = (url.searchParams.get("template") || "").toLowerCase();
  const template = TEMPLATE_NAMES.includes(qt) ? qt : String(v.resumeTemplate || "classic").toLowerCase();

  let content: any;
  try { content = JSON.parse(doc.content_json); } catch { return err(500, "Document content is corrupted."); }

  // extra sections every template renders, straight from the profile
  const arr = (x: any) => (Array.isArray(x) ? x : []);
  const work = arr(v.st_workExperiences);
  const military = work.map((w: any) => `${w.employer || ""} ${w.title || ""}`).join(" ")
    .match(/\b(army|navy|air force|marine|coast guard)\b/i);
  // Skills grouped by level: working skills vs the ones still being earned.
  // BEGINNER-level entries and "(in progress)" credentials form the second line.
  const hard = arr(v.st_hardSkills);
  const working = hard.filter((s: any) => (s?.level || "") !== "BEGINNER").map((s: any) => s?.name || s).filter(Boolean);
  const inProgress = [
    ...hard.filter((s: any) => s?.level === "BEGINNER").map((s: any) => s?.name || s),
    ...arr(v.st_professionalCredential).map((c: any) => c?.name || c)
      .filter((n: any) => typeof n === "string" && /\(in progress\)/i.test(n))
      .map((n: string) => n.replace(/\s*\(in progress\)\s*/i, "")),
  ].filter(Boolean);
  const extras: CvExtras = {
    education: arr(v.st_education),
    certs: arr(v.st_professionalCredential).map((c: any) => c?.name || c)
      .filter((n: any) => typeof n === "string" && !/\(in progress\)/i.test(n)),
    tagline: hard.slice(0, 4).map((x: any) => x?.name || x).filter(Boolean).join(" \xb7 ") || null,
    credentialLine: military ? `U.S. ${military[1]} veteran`.toUpperCase() : null,
    employerSublines: arr(v.employerDescriptions).filter((e: any) => e?.employer && e?.description),
    skillGroups: [
      { label: "Skills", items: working },
      ...(inProgress.length ? [{ label: "In progress", items: inProgress }] : []),
    ],
  };

  let bytes: Uint8Array;
  let filename: string;
  if (doc.kind === "cv") {
    bytes = renderCvPdf(content, contact, template, extras);
    filename = `${contact.name.replace(/\s+/g, "-")}-Resume.pdf`;
  } else {
    let company: string | null = null;
    if (doc.job_uuid) {
      const j = await env.DB.prepare("SELECT company_name FROM jobs WHERE uuid = ?").bind(doc.job_uuid).first<any>();
      company = j?.company_name ?? null;
    }
    const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    bytes = renderCoverPdf(content, contact, { company, date }, template, extras);
    filename = `${contact.name.replace(/\s+/g, "-")}-Cover-Letter.pdf`;
  }
  return new Response(bytes.buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
};
