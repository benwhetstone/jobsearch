// Canonical job identity.
//
// One real-world posting -> ONE job_id, everywhere in the pipeline (feed, queue,
// application), no matter which board surfaced it or how thin the data is. This
// replaces fuzzy company+title+location suppression (which over-collapsed and
// hid real openings) with an exact, deterministic key.
//
// NAMING SCHEMA (always prefixed `jid_`, always lowercase, url-safe):
//   ATS-anchored (authoritative — the employer's requisition IS the identity):
//     jid_greenhouse-<board>-<reqId>     e.g. jid_greenhouse-doximity-4012345
//     jid_lever-<org>-<reqId>            e.g. jid_lever-sardine-6f1e2a3b90
//     jid_ashby-<org>-<reqId>
//     jid_workday-<host>-<reqId>         e.g. jid_workday-raymondjames-r0011925
//   Signature fallback (no ATS req known — derived from the posting itself):
//     jid_sig-<hash>   hash = 14-hex FNV-1a over company | title | location
//
// The server is the single source of truth: anyone (Cowork) who needs a job_id
// asks POST /api/v1/job-id rather than reimplementing this.
import { refFromUrl } from "./_ats";

export interface JobIdInput {
  ats?: string | null; atsToken?: string | null; atsJobId?: string | null;
  url?: string | null; applyUrl?: string | null;
  company?: string | null; title?: string | null; location?: string | null;
  remote?: boolean | number | null;
}

// url-safe slug: lowercase, accents stripped, non-alphanumerics -> single dash.
function slug(s: string): string {
  return (s || "")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Company identity: drop legal suffixes and punctuation so "Acme, Inc." and
// "Acme LLC" are the same employer.
export function normCompany(s: string): string {
  return slug((s || "").replace(/\b(inc|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|gmbh|plc|group|holdings|international)\b/gi, ""))
    .replace(/-+/g, "-");
}

// Title identity: punctuation-insensitive, whitespace-collapsed. Kept faithful
// otherwise (we do NOT strip seniority — "Senior Data Analyst" is a different
// req from "Data Analyst").
export function normTitle(s: string): string { return slug(s); }

// Location identity: every remote variant collapses to "remote" (so "Remote",
// "Remote, US" and "" don't split one job three ways); on-site keeps city/state
// so genuinely different-city reqs stay distinct.
function normLoc(loc: string | null | undefined, remote?: boolean | number | null): string {
  const s = (loc || "").toLowerCase();
  if (remote || !s.trim() || /\bremote\b|anywhere|work from home|\bwfh\b|distributed/.test(s)) return "remote";
  return slug(s.replace(/\b(united states|usa|u\.s\.a?\.?|remote)\b/g, ""));
}

// Deterministic 14-hex FNV-1a (sync, dependency-free). Determinism is what
// matters — same input, same id, in the site and in the /job-id endpoint.
function fnv14(str: string): string {
  // two interleaved 32-bit FNV-1a streams -> 56 bits -> 14 hex chars
  let h1 = 0x811c9dc5, h2 = 0x811c9dc5 ^ 0x9e3779b9;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + 0x27), 0x01000193) >>> 0;
  }
  return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).slice(0, 14);
}

// Pull an ATS requisition out of whatever we have: explicit fields first, then
// the apply/posting URL (Greenhouse/Lever/Ashby via refFromUrl, plus a Workday
// req-number pattern the shared parser doesn't cover).
function atsRef(input: JobIdInput): { ats: string; token: string; reqId: string } | null {
  if (input.ats && input.atsJobId) {
    return { ats: slug(input.ats), token: slug(input.atsToken || "x"), reqId: slug(input.atsJobId) };
  }
  for (const u of [input.applyUrl, input.url]) {
    if (!u) continue;
    const ref = refFromUrl(u);
    if (ref?.jobId) return { ats: slug(ref.ats), token: slug(ref.token), reqId: slug(ref.jobId) };
    // Workday: host is the tenant, path carries an R-#### requisition number.
    const wd = u.match(/([a-z0-9-]+)\.(?:wd\d+\.)?myworkdayjobs?\.com/i);
    const req = u.match(/\bR-?\d{4,}\b/i) || u.match(/\/job\/[^/]*\/[^/]*_(R-?\d{3,})/i);
    if (wd && req) return { ats: "workday", token: slug(wd[1]), reqId: slug(req[1] || req[0]) };
    const more = extraAtsRef(u);
    if (more) return more;
  }
  return null;
}

// Host parsers beyond the big four. Added 2026-08-22 after an audit found 13 of
// 15 legitimate employer URLs falling back to jid_sig hashes. Each returns the
// employer's real requisition as the identity, matching the jid_<ats>-<org>-<req>
// schema. Query params are checked before path shapes where an ATS uses both.
function extraAtsRef(u: string): { ats: string; token: string; reqId: string } | null {
  let m: RegExpMatchArray | null;
  const param = (name: string) => {
    const r = u.match(new RegExp("[?&]" + name + "=([^&#]+)", "i"));
    return r ? decodeURIComponent(r[1]) : null;
  };

  // ADP — myjobs.adp.com/<tenant>/cx/job-details?...&jobId=123456
  if (/myjobs\.adp\.com/i.test(u)) {
    m = u.match(/myjobs\.adp\.com\/([^/?#]+)/i);
    const req = param("jobId") || (u.match(/\/job[s-]*(?:-details|-listing)?\/(\d{4,})/i) || [])[1];
    if (m && req) return { ats: "adp", token: slug(m[1]), reqId: slug(req) };
  }
  // Oracle Recruiting Cloud — <tenant>.fa.<region>.oraclecloud.com/.../job/12345
  if ((m = u.match(/([a-z0-9-]+)\.fa\.[a-z0-9.-]*oraclecloud\.com/i))) {
    const req = (u.match(/\/job\/(\d{3,})/i) || [])[1] || (u.match(/\/requisitions\/preview\/(\d{3,})/i) || [])[1];
    if (req) return { ats: "oracle", token: slug(m[1]), reqId: slug(req) };
  }
  // iCIMS — <tenant>.icims.com/jobs/12345/...  (careers- prefix stripped)
  if ((m = u.match(/([a-z0-9-]+)\.icims\.com/i))) {
    const req = (u.match(/\/jobs\/(\d{3,})/i) || [])[1];
    if (req) return { ats: "icims", token: slug(m[1].replace(/^careers?-/i, "")), reqId: slug(req) };
  }
  // SuccessFactors — careerN.successfactors.com/... company=XYZ ... career_job_req_id=12345
  if (/successfactors\.(?:com|eu)/i.test(u) || /\.sapsf\./i.test(u)) {
    const req = param("career_job_req_id") || param("job_req_id") || (u.match(/\/job\/[^/]*\/(\d{3,})/i) || [])[1];
    const co = param("company");
    if (req) return { ats: "successfactors", token: slug(co || "sf"), reqId: slug(req) };
  }
  // Paylocity — recruiting.paylocity.com/recruiting/jobs/Details/1234567/<Company>/...
  if (/recruiting\.paylocity\.com/i.test(u)) {
    m = u.match(/\/Details\/(\d{4,})(?:\/([^/?#]+))?/i);
    if (m) return { ats: "paylocity", token: slug(m[2] || "paylocity"), reqId: slug(m[1]) };
  }
  // Taleo — <tenant>.taleo.net/careersection/...?job=12345 (or /jobdetail.ftl?job=ABC-123)
  if ((m = u.match(/([a-z0-9-]+)\.taleo\.net/i))) {
    const req = param("job") || (u.match(/\/jobdetail[^?#]*[?&]job=([^&#]+)/i) || [])[1];
    if (req) return { ats: "taleo", token: slug(m[1]), reqId: slug(req) };
  }
  // SmartRecruiters — jobs.smartrecruiters.com/<Company>/743999999999999-title
  if ((m = u.match(/jobs\.smartrecruiters\.com\/(?:oneclick-ui\/company\/)?([^/?#]+)\/(\d{9,})/i))) {
    return { ats: "smartrecruiters", token: slug(m[1]), reqId: slug(m[2]) };
  }
  return null;
}

export function canonicalJobId(input: JobIdInput): string {
  const ref = atsRef(input);
  if (ref) return `jid_${ref.ats}-${ref.token}-${ref.reqId}`.slice(0, 120);
  const sig = fnv14([normCompany(input.company || ""), normTitle(input.title || ""), normLoc(input.location, input.remote)].join(""));
  return `jid_sig-${sig}`;
}
