// GET /api/v1/admin/pdf/:uuid  — admin-guarded document PDF, no user session.
// The browser-apply worker fetches tailored résumé/cover PDFs through this to
// attach them to the employer's live form. Self-guards with the admin bearer;
// the middleware treats /api/v1/admin/ as public so this runs without a cookie.
import { err, checkAdmin, type Env } from "../../../_lib";
import { renderDocumentPdf } from "../../../_docpdf";

export const onRequestGet: PagesFunction<Env> = async ({ params, request, env }) => {
  if (!checkAdmin(request, env)) return err(401, "Admin bearer required.");
  const rendered = await renderDocumentPdf(env, String(params.uuid));
  if (!rendered) return err(404, "No such document.");
  return new Response(rendered.bytes.buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${rendered.filename}"`,
      "Cache-Control": "no-store",
    },
  });
};
