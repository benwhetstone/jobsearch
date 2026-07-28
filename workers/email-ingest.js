// Cloudflare Email Worker for jobs.benwhetstone.info.
// Route: catch-all on the domain -> this worker. It parses the message and
// hands it to the app's ingest endpoint, which classifies it and updates the
// application it belongs to. Deploy:
//   npx wrangler deploy workers/email-ingest.js --name jobsearch-email-ingest
//   then Dashboard -> zone -> Email -> Email Routing -> catch-all -> this worker
// Secrets: INGEST_URL (https://jobs.benwhetstone.info/api/v1/inbox/ingest),
//          ADMIN_TOKEN (the app's APP_ADMIN_TOKEN value).
export default {
  async email(message, env) {
    let text = "";
    try {
      const raw = await new Response(message.raw).text();
      // crude text extraction: prefer the text/plain part when present
      const m = raw.match(/Content-Type: text\/plain[\s\S]*?\r?\n\r?\n([\s\S]*?)(?:\r?\n--|$)/i);
      text = (m ? m[1] : raw).slice(0, 20000);
    } catch { /* keep empty */ }
    await fetch(env.INGEST_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.ADMIN_TOKEN}` },
      body: JSON.stringify({
        to: message.to, from: message.from,
        subject: message.headers.get("subject") || "", text,
      }),
    });
  },
};
