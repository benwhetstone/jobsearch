#!/usr/bin/env node
// End-to-end ATS probe report.
//
// Drives the DEPLOYED browser-apply worker's probe endpoint against one real,
// current posting per ATS and writes an HTML report with, for each platform:
// the resolved field inventory, how many fields it auto-filled, whether the
// résumé uploaded, the learned insights, and a full-page screenshot.
//
//   ADMIN_TOKEN=...  [CLOUDFLARE_API_TOKEN=...]  node test/e2e-report.mjs
//
// Targets: uses test/targets.json if present (an array of {ats,url,title,
// company}); otherwise queries D1 for one live auto_apply posting per ATS
// (needs CLOUDFLARE_API_TOKEN for wrangler). Secrets are read from the
// environment only — never passed on the command line.
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const WORKER_URL = (process.env.WORKER_URL || "https://jobsearch-browser-apply.ben-322.workers.dev").replace(/\/$/, "");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const USER_ID = process.env.USER_ID || "user_ben";
if (!ADMIN_TOKEN) { console.error("Set ADMIN_TOKEN in the environment (the worker's admin bearer)."); process.exit(1); }

function targetsFromD1() {
  // one representative live auto_apply posting per ATS the sweep has found
  const sql = `SELECT ats, apply_url, title, company_name AS company FROM jobs
               WHERE auto_apply=1 AND apply_url IS NOT NULL AND apply_url != ''
               GROUP BY ats HAVING apply_url = MIN(apply_url)`;
  const out = execFileSync(
    "npx", ["wrangler", "d1", "execute", "jobsearch", "--remote", "--json", "--command", sql],
    { cwd: join(__dir, ".."), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  const parsed = JSON.parse(out);
  const rows = (Array.isArray(parsed) ? parsed[0]?.results : parsed?.results) || [];
  return rows.map((r) => ({ ats: r.ats, url: r.apply_url, title: r.title, company: r.company }));
}

function loadTargets() {
  const f = join(__dir, "targets.json");
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  try { return targetsFromD1(); }
  catch (e) {
    console.error("No test/targets.json and the D1 query failed (need CLOUDFLARE_API_TOKEN):", e.message);
    process.exit(1);
  }
}

async function probe(t) {
  const res = await fetch(`${WORKER_URL}/apply`, {
    method: "POST",
    headers: { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ probeUrl: t.url, userId: USER_ID, label: `${t.ats}:${t.company || ""}` }),
  });
  return await res.json().catch(() => ({ ok: false, reason: `HTTP ${res.status}` }));
}

const targets = loadTargets();
if (!targets.length) { console.error("No targets to probe."); process.exit(1); }
const outDir = join(__dir, "report");
mkdirSync(join(outDir, "img"), { recursive: true });

const results = [];
for (const t of targets) {
  process.stdout.write(`probing ${t.ats.padEnd(15)} ${t.company || t.url} ... `);
  let result;
  try { result = await probe(t); } catch (e) { result = { ok: false, reason: String(e.message) }; }
  const shot = result?.screenshot;
  let shotFile = null;
  if (shot && String(shot).startsWith("data:image")) {
    shotFile = `img/${t.ats}.png`;
    writeFileSync(join(outDir, shotFile), Buffer.from(String(shot).split(",")[1], "base64"));
  }
  console.log(result?.ok ? `OK  ${result.filledCount || 0}/${result.fields || 0} filled, ${result.uploaded || 0} upload` : `FAIL  ${result?.reason || ""}`);
  results.push({ ...t, result, shotFile });
}

// ---- render HTML -------------------------------------------------------------
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const badge = (ok, txt) => `<span class="b ${ok ? "ok" : "no"}">${esc(txt)}</span>`;

function card(r) {
  const res = r.result || {};
  const ok = !!res.ok;
  const inv = Array.isArray(res.inventory) ? res.inventory : [];
  const filled = inv.filter((f) => f.filled).length;
  const rows = inv.map((f) =>
    `<tr class="${f.filled ? "f" : f.required ? "r" : ""}"><td>${esc(f.label)}</td><td>${esc(f.type)}</td><td>${f.required ? "yes" : ""}</td><td>${f.filled ? "✓" : ""}</td></tr>`
  ).join("");
  const insights = (res.insights || []).map((i) => `<li><b>${esc(i.field_kind)}</b> — ${esc(i.strategy)}: ${esc(i.note)}</li>`).join("");
  return `
  <section class="card">
    <div class="hd">
      <h2>${esc(r.ats)} <span class="co">${esc(r.company || "")}</span></h2>
      <div>${ok ? badge(true, "reached form") : badge(false, "no form")}
        ${res.fields != null ? badge(res.filledCount > 0, `${res.filledCount || 0}/${res.fields} filled`) : ""}
        ${res.uploaded ? badge(true, `résumé uploaded (${res.uploaded})`) : badge(false, "no upload")}
        ${res.answered ? badge(true, `${res.answered} Q answered`) : ""}
        ${res.typed ? badge(true, `${res.typed} typeahead`) : ""}</div>
      <div class="meta">${esc(r.title || "")} · <a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url)}</a></div>
      ${res.reason ? `<div class="reason">${esc(res.reason)}</div>` : ""}
    </div>
    <div class="body">
      <div class="shot">${r.shotFile ? `<a href="${r.shotFile}" target="_blank"><img src="${r.shotFile}" loading="lazy"></a>` : `<div class="noshot">no screenshot</div>`}</div>
      <div class="fields">
        ${inv.length ? `<table><thead><tr><th>field (resolved label)</th><th>type</th><th>req</th><th>filled</th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="muted">no field inventory</p>`}
        ${insights ? `<h4>learned insights</h4><ul>${insights}</ul>` : ""}
      </div>
    </div>
  </section>`;
}

const passed = results.filter((r) => r.result?.ok).length;
const summaryRows = results.map((r) => {
  const res = r.result || {};
  return `<tr><td>${esc(r.ats)}</td><td>${esc(r.company || "")}</td><td>${res.ok ? "form reached" : "—"}</td><td>${res.fields != null ? `${res.filledCount || 0}/${res.fields}` : "—"}</td><td>${res.uploaded ? "✓" : ""}</td><td>${res.ok ? "" : esc(res.reason || "failed")}</td></tr>`;
}).join("");

const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ATS end-to-end probe report</title><style>
:root{color-scheme:light dark}
body{font:14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;background:#f4f6fa;color:#14181d}
header{padding:22px 28px;background:#111827;color:#fff}
header h1{margin:0 0 4px;font-size:20px}
header .sub{opacity:.8;font-size:13px}
.wrap{max-width:1100px;margin:0 auto;padding:22px}
table.sum{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06);margin-bottom:26px}
table.sum th,table.sum td{padding:9px 12px;text-align:left;border-bottom:1px solid #eef0f4;font-size:13px}
table.sum th{background:#f8fafc;font-weight:600}
.card{background:#fff;border-radius:12px;box-shadow:0 1px 5px rgba(0,0,0,.07);margin-bottom:22px;overflow:hidden}
.card .hd{padding:16px 18px;border-bottom:1px solid #eef0f4}
.card h2{margin:0;font-size:17px;text-transform:capitalize}
.card h2 .co{font-weight:400;color:#5c6875;font-size:14px;text-transform:none}
.meta{font-size:12px;color:#5c6875;margin-top:6px;word-break:break-all}
.meta a{color:#2563eb;text-decoration:none}
.reason{margin-top:8px;font-size:13px;color:#9a3412;background:#fff7ed;border-left:3px solid #ea580c;padding:7px 10px;border-radius:6px}
.b{display:inline-block;font-size:12px;font-weight:600;padding:2px 9px;border-radius:20px;margin:5px 5px 0 0}
.b.ok{background:#dcfce7;color:#166534}.b.no{background:#fee2e2;color:#991b1b}
.body{display:grid;grid-template-columns:minmax(260px,1fr) 1.3fr;gap:0}
@media(max-width:760px){.body{grid-template-columns:1fr}}
.shot{border-right:1px solid #eef0f4;background:#fafbfc;padding:12px}
.shot img{width:100%;border:1px solid #e5e7eb;border-radius:6px;display:block}
.noshot{color:#9aa4b2;padding:40px;text-align:center}
.fields{padding:12px 16px;overflow:auto}
.fields table{width:100%;border-collapse:collapse;font-size:12.5px}
.fields th,.fields td{padding:4px 8px;border-bottom:1px solid #f0f2f6;text-align:left}
.fields tr.f td{background:#f0fdf4}.fields tr.r td{background:#fef2f2}
.fields h4{margin:14px 0 6px;font-size:13px}
.muted{color:#9aa4b2}
</style></head><body>
<header><h1>ATS end-to-end probe report</h1>
<div class="sub">${passed}/${results.length} platforms reached a fillable form · user ${esc(USER_ID)} · worker ${esc(WORKER_URL)}</div></header>
<div class="wrap">
<table class="sum"><thead><tr><th>ATS</th><th>company</th><th>form</th><th>filled</th><th>résumé</th><th>note</th></tr></thead><tbody>${summaryRows}</tbody></table>
${results.map(card).join("")}
</div></body></html>`;

writeFileSync(join(outDir, "index.html"), html);
console.log(`\n${passed}/${results.length} reached a form. Report: ${join(outDir, "index.html")}`);
