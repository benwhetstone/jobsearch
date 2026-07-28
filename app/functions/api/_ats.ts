// ATS layer — the part that makes "apply" mean something.
//
// Aggregators (Adzuna, Jooble, Careerjet) are referral businesses: their links
// point at their own interstitial pages, and they 403 anything automated. You
// can never submit an application through them. What they ARE good at is
// breadth — they tell us a company name and a job title for any industry.
//
// So we use them for discovery only, then resolve the COMPANY to its real
// applicant tracking system. Greenhouse, Lever, Ashby and Workable all publish
// keyless APIs where the application form itself is data: verbatim labels,
// field types, required flags, and option lists. That is what we can mirror,
// prefill and submit.
//
// Nothing here is a curated company list. Board tokens are derived from company
// names that came out of the user's own search, then verified against the API.
import type { Env } from "./_lib";
import type { RawJob } from "./_jobs";

export type AtsKind = "greenhouse" | "lever" | "ashby" | "workable";

export interface AtsRef { ats: AtsKind; token: string; jobId?: string; }

// One normalized field, whatever ATS it came from. Mirrors the shape the UI
// renders and the fill algorithm writes into.
export interface AtsField {
  key: string;                 // stable id within the application
  type: "text" | "textarea" | "select" | "multiselect" | "boolean" | "file" | "number" | "date";
  label: string;               // the employer's verbatim question
  required: boolean;
  options: { value: string; label: string }[];
  placeholder?: string | null;
}

const norm = (s: string) => (s || "").toLowerCase().trim();

// Candidate board tokens for a company name. Cheap string variants only — the
// API call is what decides truth, so guessing wide costs nothing but a 404.
export function boardTokens(company: string): string[] {
  const base = norm(company)
    .replace(/[’']/g, "")
    .replace(/\b(inc|incorporated|llc|l\.l\.c|corp|corporation|ltd|limited|llp|plc|pllc|pc|lp|co)\b\.?/g, " ")
    .replace(/\b(the|and)\b/g, " ")
    .trim();
  const compact = base.replace(/[^a-z0-9]/g, "");
  const dashed = base.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return [...new Set([compact, dashed].filter((t) => t.length >= 2 && t.length <= 40))];
}

async function ok(url: string, init?: RequestInit, ms = 9000): Promise<any | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

const PROBES: { ats: AtsKind; url: (t: string) => string; valid: (d: any) => boolean }[] = [
  { ats: "greenhouse", url: (t) => `https://boards-api.greenhouse.io/v1/boards/${t}/jobs`, valid: (d) => Array.isArray(d?.jobs) },
  { ats: "lever",      url: (t) => `https://api.lever.co/v0/postings/${t}?mode=json`,       valid: (d) => Array.isArray(d) },
  { ats: "ashby",      url: (t) => `https://api.ashbyhq.com/posting-api/job-board/${t}`,     valid: (d) => Array.isArray(d?.jobs) },
];

// Resolve a company name to its ATS board, caching hits AND misses — a miss is
// worth remembering so we don't re-probe four URLs for every staffing agency.
export async function resolveBoard(env: Env, company: string): Promise<AtsRef | null> {
  const key = norm(company);
  if (!key) return null;

  const cached = await env.DB.prepare("SELECT ats, token FROM ats_boards WHERE company_key = ?")
    .bind(key).first<{ ats: string | null; token: string | null }>();
  if (cached) return cached.ats && cached.token ? { ats: cached.ats as AtsKind, token: cached.token } : null;

  for (const token of boardTokens(company)) {
    for (const p of PROBES) {
      const d = await ok(p.url(token));
      if (d && p.valid(d)) {
        await env.DB.prepare(
          "INSERT OR REPLACE INTO ats_boards (company_key, ats, token, checked_at) VALUES (?, ?, ?, ?)"
        ).bind(key, p.ats, token, new Date().toISOString()).run();
        return { ats: p.ats, token };
      }
    }
  }
  await env.DB.prepare(
    "INSERT OR REPLACE INTO ats_boards (company_key, ats, token, checked_at) VALUES (?, NULL, NULL, ?)"
  ).bind(key, new Date().toISOString()).run();
  return null;
}

// ---- pull a company's real postings (these carry a submittable form) --------
export async function boardJobs(ref: AtsRef, keywords: string): Promise<RawJob[]> {
  const kw = norm(keywords).split(/\s+/).filter((w) => w.length > 2);
  const hit = (title: string) => !kw.length || kw.some((w) => norm(title).includes(w));

  if (ref.ats === "greenhouse") {
    const d = await ok(`https://boards-api.greenhouse.io/v1/boards/${ref.token}/jobs`);
    return (d?.jobs ?? []).filter((j: any) => hit(j.title)).map((j: any): RawJob => ({
      source: "greenhouse", externalId: String(j.id), title: j.title,
      company: ref.token, location: j.location?.name ?? null,
      remote: /remote/i.test(j.location?.name || ""),
      salaryMin: null, salaryMax: null, currency: null,
      url: j.absolute_url, applyUrl: j.absolute_url,
      category: null, description: null, postedAt: j.updated_at ?? null,
    }));
  }
  if (ref.ats === "lever") {
    const d = await ok(`https://api.lever.co/v0/postings/${ref.token}?mode=json`);
    return (d ?? []).filter((j: any) => hit(j.text)).map((j: any): RawJob => ({
      source: "lever", externalId: String(j.id), title: j.text,
      company: ref.token, location: j.categories?.location ?? null,
      remote: /remote/i.test(j.categories?.location || ""),
      salaryMin: null, salaryMax: null, currency: null,
      url: j.hostedUrl, applyUrl: j.applyUrl || j.hostedUrl,
      category: j.categories?.team ?? null,
      description: (j.descriptionPlain || "").slice(0, 2000),
      postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
    }));
  }
  const d = await ok(`https://api.ashbyhq.com/posting-api/job-board/${ref.token}`);
  return (d?.jobs ?? []).filter((j: any) => hit(j.title)).map((j: any): RawJob => ({
    source: "ashby", externalId: String(j.id), title: j.title,
    company: ref.token, location: j.location ?? null, remote: !!j.isRemote,
    salaryMin: null, salaryMax: null, currency: null,
    url: j.jobUrl, applyUrl: j.applyUrl || j.jobUrl,
    category: j.department ?? null, description: (j.descriptionPlain || "").slice(0, 2000),
    postedAt: j.publishedAt ?? null,
  }));
}

// ---- the application form itself -------------------------------------------

// Greenhouse question -> our normalized field. Their `fields[]` carries the real
// input type; a question with options is a select even when typed as a string.
function fromGreenhouse(q: any, i: number): AtsField | null {
  const f = (q.fields || [])[0];
  if (!f) return null;
  const opts = (f.values || []).map((v: any) => ({ value: String(v.value), label: String(v.label) }));
  const t = String(f.type || "");
  const type: AtsField["type"] =
    t === "input_file" ? "file" :
    t === "textarea" ? "textarea" :
    t === "multi_value_multi_select" ? "multiselect" :
    t === "multi_value_single_select" || opts.length ? "select" :
    "text";
  return { key: String(f.name || `q${i}`), type, label: String(q.label || f.name || "").trim(),
           required: !!q.required, options: opts };
}

export async function fetchForm(ref: AtsRef): Promise<AtsField[]> {
  if (ref.ats === "greenhouse" && ref.jobId) {
    const d = await ok(`https://boards-api.greenhouse.io/v1/boards/${ref.token}/jobs/${ref.jobId}?questions=true`);
    return ((d?.questions ?? []).map(fromGreenhouse).filter(Boolean) as AtsField[]);
  }
  if (ref.ats === "lever" && ref.jobId) {
    const d = await ok(`https://api.lever.co/v0/postings/${ref.token}/${ref.jobId}?mode=json`);
    const out: AtsField[] = [
      { key: "name",  type: "text", label: "Full name",    required: true,  options: [] },
      { key: "email", type: "text", label: "Email",        required: true,  options: [] },
      { key: "phone", type: "text", label: "Phone",        required: false, options: [] },
      { key: "resume", type: "file", label: "Resume/CV",   required: true,  options: [] },
    ];
    for (const card of d?.customQuestions ?? []) {
      for (const [i, f] of (card.fields ?? []).entries()) {
        const opts = (f.options ?? []).map((o: any) => ({ value: String(o.text ?? o), label: String(o.text ?? o) }));
        out.push({
          key: `${card.id || "q"}_${i}`,
          type: f.type === "textarea" ? "textarea" : f.type === "multiple-select" ? "multiselect"
              : opts.length ? "select" : "text",
          label: String(f.text || "").trim(), required: !!f.required, options: opts,
        });
      }
    }
    return out;
  }
  // Ashby and anything else: we know the standard fields; the rest needs the
  // browser step on the desktop client rather than a guess.
  return [
    { key: "name",  type: "text", label: "Full name", required: true,  options: [] },
    { key: "email", type: "text", label: "Email",     required: true,  options: [] },
    { key: "phone", type: "text", label: "Phone",     required: false, options: [] },
    { key: "resume", type: "file", label: "Resume/CV", required: true, options: [] },
  ];
}

// Recover an ATS reference from a posting URL, so a job we already stored can be
// upgraded to a real application without re-running discovery.
export function refFromUrl(url: string): AtsRef | null {
  if (!url) return null;
  let m = url.match(/boards\.greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/i)
       || url.match(/job-boards\.greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/i);
  if (m) return { ats: "greenhouse", token: m[1], jobId: m[2] };
  m = url.match(/gh_jid=(\d+)/i);
  if (m) {
    const host = url.match(/^https?:\/\/(?:www\.)?([^./]+)\./i);
    if (host) return { ats: "greenhouse", token: host[1], jobId: m[1] };
  }
  m = url.match(/jobs\.lever\.co\/([^/?#]+)\/([0-9a-f-]{8,})/i);
  if (m) return { ats: "lever", token: m[1], jobId: m[2] };
  m = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)\/([0-9a-f-]{8,})/i);
  if (m) return { ats: "ashby", token: m[1], jobId: m[2] };
  return null;
}
