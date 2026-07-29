// GET /api/v1/documents/:uuid/pdf?template=classic|modern|compact|executive
// The tailored (or base) document as a real PDF — the file that gets uploaded
// to the ATS. Template defaults to the user's Résumé & Voice choice.
import { err, currentUser, type Env, type CtxUser } from "../../../_lib";
import { renderDocumentPdf } from "../../../_docpdf";

export const onRequestGet: PagesFunction<Env, string, { user?: CtxUser }> = async ({ params, request, env, data }) => {
  const user = currentUser(data);
  const uuid = String(params.uuid);
  const url = new URL(request.url);
  const rendered = await renderDocumentPdf(env, uuid, {
    userId: user.id, templateOverride: url.searchParams.get("template") || undefined,
  });
  if (!rendered) return err(404, "No such document.");
  return new Response(rendered.bytes.buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${rendered.filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
};
