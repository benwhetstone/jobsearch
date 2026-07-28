// GET /api/v1/documents/:uuid/pdf?template=classic|modern|compact|executive
// The tailored (or base) document as a real PDF — the file that gets uploaded
// to the ATS. Template defaults to the user's Résumé & Voice choice.
import { err, currentUser, type Env, type CtxUser } from "../../../_lib";
import { renderCvPdf, renderCoverPdf, TEMPLATE_NAMES, type Contact } from "../../../_pdf";

export const onRequestGet: PagesFunction<Env, string, { user?: CtxUser }> = async ({ params, request, env, data }) => {
  const user = currentUser(data);
  const uuid = String(params.uuid);
  const doc = await env.DB.prepare(
    "SELECT kind, title, content_json, job_uuid, verify_passed FROM documents WHERE uuid = ? AND user_id = ?"
  ).bind(uuid, user.id).first<any>();
  if (!doc) return err(404, "No such document.");

  const vals = await env.DB.prepare(
    `SELECT field_key, value_json FROM profile_values WHERE user_id = ?
      AND field_key IN ('firstName','lastName','applicationFirstName','email','phone','city','state','linkedinProfile','resumeTemplate')`
  ).bind(user.id).all<{ field_key: string; value_json: string | null }>();
  const v: Record<string, string | null> = {};
  for (const r of vals.results ?? []) {
    try { v[r.field_key] = JSON.parse(r.value_json || "null"); } catch { v[r.field_key] = r.value_json; }
  }
  const contact: Contact = {
    name: [v.applicationFirstName || v.firstName, v.lastName].filter(Boolean).join(" ") || user.name || "Candidate",
    email: v.email || user.email, phone: v.phone, city: v.city, state: v.state, linkedin: v.linkedinProfile,
  };

  const url = new URL(request.url);
  const qt = (url.searchParams.get("template") || "").toLowerCase();
  const template = TEMPLATE_NAMES.includes(qt) ? qt : String(v.resumeTemplate || "classic").toLowerCase();

  let content: any;
  try { content = JSON.parse(doc.content_json); } catch { return err(500, "Document content is corrupted."); }

  let bytes: Uint8Array;
  let filename: string;
  if (doc.kind === "cv") {
    bytes = renderCvPdf(content, contact, template);
    filename = `${contact.name.replace(/\s+/g, "-")}-Resume.pdf`;
  } else {
    let company: string | null = null;
    if (doc.job_uuid) {
      const j = await env.DB.prepare("SELECT company_name FROM jobs WHERE uuid = ?").bind(doc.job_uuid).first<any>();
      company = j?.company_name ?? null;
    }
    const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    bytes = renderCoverPdf(content, contact, { company, date }, template);
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
