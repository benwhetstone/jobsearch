// Job-source connectors. Each returns a normalized RawJob[]. Adding a source =
// adding one function here. Query-driven and industry-agnostic (the user's search
// terms are the query), so it works for any field, not just tech.
import type { Env } from "./_lib";

export interface RawJob {
  source: string;
  externalId: string;
  title: string;
  company: string | null;
  location: string | null;
  remote: boolean;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  url: string;
  applyUrl?: string | null;
  category?: string | null;
  description?: string | null;
  postedAt?: string | null;
}

export interface SearchQuery {
  keywords: string;
  location?: string;
  remoteOnly?: boolean;
  salaryMin?: number | null;
  country?: string;
  radiusMi?: number | null;   // search radius around `location`, in miles
  // Broader terms (title words + skills + domains) used ONLY to widen the
  // direct-employer board fetch, so roles like "Analytics Engineer" reach the
  // scorer even though their title isn't the literal search keyword.
  boardTerms?: string[];
}

const MI_TO_KM = 1.60934;

const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function boardFrom(url: string | null | undefined): string | null {
  if (!url) return null;
  const u = url.toLowerCase();
  if (u.includes("greenhouse.io")) return "greenhouse";
  if (u.includes("lever.co")) return "lever";
  if (u.includes("ashbyhq.com")) return "ashby";
  if (u.includes("workable.com")) return "workable";
  if (u.includes("smartrecruiters.com")) return "smartrecruiters";
  if (u.includes("myworkdayjobs.com") || u.includes("workday")) return "workday";
  if (u.includes("jazz.co") || u.includes("applytojob")) return "jazzhr";
  return null;
}

// Legal suffixes and boilerplate title tails differ between boards for the SAME
// posting ("Lucayan Technology Solutions LLC" vs "Lucayan Technology Solutions",
// "... with Security Clearance"), so strip them before comparing. Location is
// deliberately NOT part of the key: boards describe one metro many ways
// ("Tampa" vs "East Lake-Orient Park, Hillsborough County"), and a job seeker is
// far better served by one entry per real role than by four near-identical rows.
const COMPANY_SUFFIX = /\b(llc|l l c|inc|incorporated|corp|corporation|co|ltd|limited|llp|plc|gmbh|pllc|pc|lp)\b/g;
const TITLE_NOISE = /\b(with|w)\s+(security\s+clearance|ts\s*sci|clearance)\b|\bremote\b|\bhybrid\b|\bon\s?site\b|\b(full|part)\s?time\b|\burgent(ly)?\s+(hiring|needed)\b|\bhiring\s+now\b/g;

export function dedupeKey(company: string | null, title: string, _location?: string | null): string {
  const c = norm(company || "").replace(COMPANY_SUFFIX, " ").replace(/\s+/g, " ").trim();
  const t = norm(title).replace(TITLE_NOISE, " ").replace(/\s+/g, " ").trim();
  return `${c}|${t}`;
}

// Cheap fraud heuristic (0..2). No company, salary absurdly high, or free-mail contact.
export function scamScore(j: RawJob): number {
  let s = 0;
  if (!j.company) s++;
  if (j.salaryMax && j.salaryMax > 400000) s++;
  const d = (j.description || "").toLowerCase();
  if (/whats\s?app|telegram|@gmail\.com|@yahoo\.com|wire transfer|no experience needed.*\$\d{3,}/.test(d)) s++;
  return Math.min(2, s);
}

async function safeFetch(url: string, init?: RequestInit, ms = 12000): Promise<any | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// ---- Adzuna: the all-industry backbone (needs app_id + app_key) --------------
async function adzuna(env: Env, q: SearchQuery): Promise<RawJob[]> {
  if (!env.ADZUNA_APP_ID || !env.ADZUNA_APP_KEY) return [];
  const country = (q.country || "us").toLowerCase();
  const params = new URLSearchParams({
    app_id: env.ADZUNA_APP_ID, app_key: env.ADZUNA_APP_KEY,
    results_per_page: "50", what: q.keywords, "content-type": "application/json",
  });
  if (q.location) params.set("where", q.location);
  if (q.location && q.radiusMi) params.set("distance", String(Math.round(q.radiusMi * MI_TO_KM))); // Adzuna distance is km
  if (q.salaryMin) params.set("salary_min", String(q.salaryMin));
  const data = await safeFetch(`https://api.adzuna.com/v1/api/jobs/${country}/search/1?${params}`);
  if (!data?.results) return [];
  return data.results.map((r: any): RawJob => ({
    source: "adzuna",
    externalId: String(r.id),
    title: r.title || "",
    company: r.company?.display_name || null,
    location: r.location?.display_name || null,
    remote: /remote/i.test((r.title || "") + " " + (r.description || "")),
    salaryMin: r.salary_min ?? null,
    salaryMax: r.salary_max ?? null,
    currency: country === "us" ? "USD" : null,
    url: r.redirect_url,
    applyUrl: r.redirect_url,
    category: r.category?.label || null,
    description: r.description || null,
    postedAt: r.created || null,
  }));
}

// ---- Remotive: keyless, keyword-searchable (remote roles, many categories) ---
async function remotive(_env: Env, q: SearchQuery): Promise<RawJob[]> {
  const data = await safeFetch(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(q.keywords)}&limit=40`);
  if (!data?.jobs) return [];
  return data.jobs.map((r: any): RawJob => ({
    source: "remotive",
    externalId: String(r.id),
    title: r.title || "",
    company: r.company_name || null,
    location: r.candidate_required_location || "Remote",
    remote: true,
    salaryMin: null, salaryMax: null, currency: null,
    url: r.url,
    applyUrl: r.url,
    category: r.category || null,
    description: (r.description || "").replace(/<[^>]+>/g, " ").slice(0, 2000),
    postedAt: r.publication_date || null,
  }));
}

// ---- Arbeitnow: keyless (recent board; filter by keyword client-side) --------
async function arbeitnow(_env: Env, q: SearchQuery): Promise<RawJob[]> {
  const data = await safeFetch(`https://www.arbeitnow.com/api/job-board-api`);
  if (!Array.isArray(data?.data)) return [];
  const kw = norm(q.keywords).split(" ").filter(Boolean);
  return data.data
    .filter((r: any) => { const hay = norm((r.title || "") + " " + (r.description || "")); return kw.some((k) => hay.includes(k)); })
    .slice(0, 25)
    .map((r: any): RawJob => ({
      source: "arbeitnow",
      externalId: String(r.slug),
      title: r.title || "",
      company: r.company_name || null,
      location: (r.location || "") + (r.remote ? " (Remote)" : ""),
      remote: !!r.remote,
      salaryMin: null, salaryMax: null, currency: null,
      url: r.url,
      applyUrl: r.url,
      category: (r.tags || [])[0] || null,
      description: (r.description || "").replace(/<[^>]+>/g, " ").slice(0, 2000),
      postedAt: r.created_at ? new Date(r.created_at * 1000).toISOString() : null,
    }));
}

// ---- JSearch (RapidAPI): Google-for-Jobs → LinkedIn/Indeed/etc. (needs key) --
async function jsearch(env: Env, q: SearchQuery): Promise<RawJob[]> {
  if (!env.RAPIDAPI_KEY) return [];
  const query = [q.keywords, q.location].filter(Boolean).join(" in ");
  const data = await safeFetch(
    `https://jsearch.p.rapidapi.com/search?query=${encodeURIComponent(query)}&num_pages=1`,
    { headers: { "X-RapidAPI-Key": env.RAPIDAPI_KEY, "X-RapidAPI-Host": "jsearch.p.rapidapi.com" } }
  );
  if (!Array.isArray(data?.data)) return [];
  return data.data.map((r: any): RawJob => ({
    source: "jsearch",
    externalId: String(r.job_id),
    title: r.job_title || "",
    company: r.employer_name || null,
    location: [r.job_city, r.job_state, r.job_country].filter(Boolean).join(", ") || null,
    remote: !!r.job_is_remote,
    salaryMin: r.job_min_salary ?? null,
    salaryMax: r.job_max_salary ?? null,
    currency: r.job_salary_currency || null,
    url: r.job_apply_link,
    applyUrl: r.job_apply_link,
    category: r.job_category || null,
    description: (r.job_description || "").slice(0, 2000),
    postedAt: r.job_posted_at_datetime_utc || null,
  }));
}

// ---- ATS-direct: postings pulled straight from Greenhouse/Lever boards ------
// (Jooble was dropped: its links bounce through interstitials that can never
// be machine-filed. These jobs link to the employer's REAL application page
// and are 100% auto-applyable.) Boards accumulate in ats_boards as sweeps
// resolve companies, so this source gets richer every day.
async function atsDirect(env: Env, q: SearchQuery): Promise<RawJob[]> {
  const { boardJobs } = await import("./_ats");
  // Search EVERY known direct-employer board (Greenhouse/Lever/Ashby) for the
  // user's titles. These are the auto-applyable jobs — real companies, real
  // application pages — so we want the widest net, not a 25-board sample.
  const rows = await env.DB.prepare(
    "SELECT ats, token FROM ats_boards WHERE ats IN ('greenhouse','lever','ashby') AND token IS NOT NULL ORDER BY checked_at DESC LIMIT 200"
  ).all<{ ats: string; token: string }>();
  // Bound concurrency so a wide board set doesn't hammer the runtime at once.
  const boards = rows.results ?? [];
  // Widen the title filter to the user's whole field signal — desired-title
  // words, skills, domains — so "Analytics Engineer", "BI Developer" and
  // "Insights Analyst" all surface for scoring, not just literal "Data Analyst".
  const terms = (q.boardTerms && q.boardTerms.length ? q.boardTerms.join(" ") : q.keywords);
  const out: RawJob[] = [];
  const BATCH = 25;
  for (let i = 0; i < boards.length; i += BATCH) {
    const lists = await Promise.all(boards.slice(i, i + BATCH).map((r) =>
      boardJobs({ ats: r.ats as any, token: r.token }, terms).catch(() => [] as RawJob[])));
    out.push(...lists.flat());
  }
  return out;
}

// ---- Careerjet: broad public search across the open web (needs affid) --------
async function careerjet(env: Env, q: SearchQuery): Promise<RawJob[]> {
  if (!env.CAREERJET_AFFID) return [];
  const locale = (q.country || "us").toLowerCase() === "gb" ? "en_GB" : "en_US";
  const params = new URLSearchParams({
    locale_code: locale,
    keywords: q.keywords,
    location: q.location || "",
    affid: env.CAREERJET_AFFID,
    pagesize: "50",
    sort: "date",
    // Careerjet wants the end-user context; from a server we pass our own.
    user_ip: "8.8.8.8",
    user_agent: "jobs.benwhetstone.info",
    url: "https://jobs.benwhetstone.info",
  });
  // Careerjet rejects calls without a Referer ("Undeclared referrer").
  const data = await safeFetch(`https://public.api.careerjet.net/search?${params}`, {
    headers: { Referer: env.APP_BASE_URL || "https://jobs.benwhetstone.info/" },
  });
  if (!Array.isArray(data?.jobs)) return [];
  return data.jobs.map((r: any): RawJob => {
    // Careerjet gives a salary string ("$55,000 - $65,000 per year") + numeric min/max.
    const sMin = Number(r.salary_min); const sMax = Number(r.salary_max);
    return {
      source: "careerjet",
      externalId: String(r.url),
      title: r.title || "",
      company: r.company || null,
      location: r.locations || null,
      remote: /remote/i.test((r.title || "") + " " + (r.description || "")),
      salaryMin: Number.isFinite(sMin) && sMin > 0 ? sMin : null,
      salaryMax: Number.isFinite(sMax) && sMax > 0 ? sMax : null,
      currency: locale === "en_GB" ? "GBP" : "USD",
      url: r.url,
      applyUrl: r.url,
      category: null,
      description: (r.description || "").replace(/<[^>]+>/g, " ").slice(0, 2000),
      postedAt: r.date || null,
    };
  });
}

// ---- Findwork.dev: keyword/location/remote filtering (needs token) -----------
async function findwork(env: Env, q: SearchQuery): Promise<RawJob[]> {
  if (!env.FINDWORK_KEY) return [];
  // Findwork's `location` filter is exact-city and zeroes out almost every
  // query (0 for "Tampa", 104 without it). It's a remote-heavy tech board, so
  // we search by keyword only and let the local/remote split fall out of scoring.
  const params = new URLSearchParams({ search: q.keywords, sort_by: "relevance" });
  const data = await safeFetch(`https://findwork.dev/api/jobs/?${params}`, {
    headers: { Authorization: `Token ${env.FINDWORK_KEY}` },
  });
  if (!Array.isArray(data?.results)) return [];
  return data.results.map((r: any): RawJob => ({
    source: "findwork",
    externalId: String(r.id),
    title: r.role || "",
    company: r.company_name || null,
    location: r.location || (r.remote ? "Remote" : null),
    remote: !!r.remote,
    salaryMin: null, salaryMax: null, currency: null,
    url: r.url,
    applyUrl: r.url,
    category: (r.keywords || [])[0] || null,
    description: (r.text || "").replace(/<[^>]+>/g, " ").slice(0, 2000),
    postedAt: r.date_posted || null,
  }));
}

const kwTokens = (s: string) => (s || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);

// ---- The Muse: curated employer postings, keyless ---------------------------
async function themuse(env: Env, q: SearchQuery): Promise<RawJob[]> {
  const kw = kwTokens(q.keywords);
  const hit = (t: string) => !kw.length || kw.some((w) => t.toLowerCase().includes(w));
  // Muse filters by fixed category, not free text, so pull the data category
  // and a couple of pages, then keyword-filter to the user's search locally.
  const out: RawJob[] = [];
  for (const page of [0, 1]) {
    const data = await safeFetch(
      `https://www.themuse.com/api/public/jobs?category=${encodeURIComponent("Data and Analytics")}&category=${encodeURIComponent("Data Science")}&page=${page}`, {});
    for (const r of data?.results ?? []) {
      if (!hit(r.name || "")) continue;
      const loc = (r.locations || []).map((l: any) => l.name).filter(Boolean).join("; ");
      out.push({
        source: "themuse", externalId: String(r.id), title: r.name || "",
        company: r.company?.name || null, location: loc || null,
        remote: /remote|flexible/i.test(loc),
        salaryMin: null, salaryMax: null, currency: null,
        url: r.refs?.landing_page, applyUrl: r.refs?.landing_page,
        category: (r.categories || [])[0]?.name || null,
        description: (r.contents || "").replace(/<[^>]+>/g, " ").slice(0, 2000),
        postedAt: r.publication_date || null,
      });
    }
  }
  return out;
}

// ---- RemoteOK: remote-first board, keyless ----------------------------------
async function remoteok(env: Env, q: SearchQuery): Promise<RawJob[]> {
  const kw = kwTokens(q.keywords);
  const hit = (t: string) => !kw.length || kw.some((w) => t.toLowerCase().includes(w));
  const data = await safeFetch("https://remoteok.com/api", { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!Array.isArray(data)) return [];
  return data.filter((r: any) => r?.position && hit(`${r.position} ${(r.tags || []).join(" ")}`))
    .slice(0, 40).map((r: any): RawJob => ({
      source: "remoteok", externalId: String(r.id || r.slug), title: r.position || "",
      company: r.company || null, location: r.location || "Remote", remote: true,
      salaryMin: r.salary_min ?? null, salaryMax: r.salary_max ?? null, currency: "USD",
      url: r.url || r.apply_url, applyUrl: r.apply_url || r.url,
      category: (r.tags || [])[0] || null,
      description: (r.description || "").replace(/<[^>]+>/g, " ").slice(0, 2000),
      postedAt: r.date || null,
    }));
}

// ---- USAJOBS: federal jobs, strong for local government roles (needs key) -----
async function usajobs(env: Env, q: SearchQuery): Promise<RawJob[]> {
  if (!env.USAJOBS_KEY) return [];
  const params = new URLSearchParams({ Keyword: q.keywords, ResultsPerPage: "50" });
  if (q.location) { params.set("LocationName", q.location); params.set("Radius", String(Math.round(q.radiusMi || 50))); } // USAJOBS Radius is miles
  if (q.salaryMin) params.set("RemunerationMinimumAmount", String(q.salaryMin));
  const data = await safeFetch(`https://data.usajobs.gov/api/search?${params}`, {
    headers: {
      Host: "data.usajobs.gov",
      "User-Agent": env.USAJOBS_UA || "jobs.benwhetstone.info",
      "Authorization-Key": env.USAJOBS_KEY,
    },
  });
  const items = data?.SearchResult?.SearchResultItems;
  if (!Array.isArray(items)) return [];
  return items.map((it: any): RawJob => {
    const d = it.MatchedObjectDescriptor || {};
    const pay = (d.PositionRemuneration || [])[0] || {};
    const min = Number(pay.MinimumRange); const max = Number(pay.MaximumRange);
    // USAJOBS pay can be hourly; only treat as annual salary when it looks like one.
    const annual = (n: number) => (Number.isFinite(n) && n > 1000 ? n : null);
    return {
      source: "usajobs",
      externalId: String(d.PositionID || it.MatchedObjectId),
      title: d.PositionTitle || "",
      company: d.OrganizationName || d.DepartmentName || null,
      location: (d.PositionLocationDisplay || (d.PositionLocation || [])[0]?.LocationName) || null,
      remote: /remote|telework/i.test((d.PositionTitle || "") + " " + (d.QualificationSummary || "")),
      salaryMin: annual(min),
      salaryMax: annual(max),
      currency: "USD",
      url: d.PositionURI,
      applyUrl: (d.ApplyURI || [])[0] || d.PositionURI,
      category: (d.JobCategory || [])[0]?.Name || null,
      description: (d.UserArea?.Details?.JobSummary || d.QualificationSummary || "").slice(0, 2000),
      postedAt: d.PublicationStartDate || null,
    };
  });
}

// Boards ship descriptions full of HTML entities (&nbsp;, &amp;, &#39;). Decode
// once at ingestion so stored text is text.
const ENTITIES: Record<string, string> = {
  "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
  "&#39;": "'", "&#x27;": "'", "&apos;": "'", "&rsquo;": "'", "&lsquo;": "'",
  "&ldquo;": '"', "&rdquo;": '"', "&ndash;": "-", "&mdash;": "-", "&bull;": "\u2022", "&hellip;": "...",
};
export function decodeEntities(text: string | null | undefined): string {
  if (!text) return "";
  return text
    // some boards (arbeitnow especially) ship raw HTML: turn block ends into
    // real line breaks, list items into bullets, then strip every other tag
    .replace(/<\s*(?:br|\/p|\/div|\/h[1-6]|\/ul|\/ol)\s*\/?\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n• ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, (m) => {
      const low = m.toLowerCase();
      if (ENTITIES[low] != null) return ENTITIES[low];
      const num = low.match(/^&#x([0-9a-f]+);$/) || low.match(/^&#(\d+);$/);
      if (num) { const code = parseInt(num[1], low.startsWith("&#x") ? 16 : 10); return code ? String.fromCodePoint(code) : m; }
      return m;
    })
    .replace(/[ \t]{2,}/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Run every configured connector, in parallel. Keyless ones always run.
export async function fetchAllSources(env: Env, q: SearchQuery): Promise<{ jobs: RawJob[]; sources: Record<string, number> }> {
  const connectors: [string, Promise<RawJob[]>][] = [
    ["adzuna", adzuna(env, q)],
    ["remotive", remotive(env, q)],
    ["arbeitnow", arbeitnow(env, q)],
    ["ats", atsDirect(env, q)],
    ["themuse", themuse(env, q)],
    ["remoteok", remoteok(env, q)],
    ["careerjet", careerjet(env, q)],
    ["findwork", findwork(env, q)],
    ["usajobs", usajobs(env, q)],
    // jsearch (RapidAPI) removed: its /search path 404s — subscription is dead.
  ];
  const settled = await Promise.all(connectors.map(([, p]) => p.catch(() => [] as RawJob[])));
  const sources: Record<string, number> = {};
  let all: RawJob[] = [];
  connectors.forEach(([name], i) => { sources[name] = settled[i].length; all = all.concat(settled[i]); });
  if (q.remoteOnly) all = all.filter((j) => j.remote);
  // annotate board + attach scam score handled by caller
  all.forEach((j) => {
    j.applyUrl = j.applyUrl || j.url;
    j.description = decodeEntities(j.description);
    j.title = decodeEntities(j.title);
    j.company = j.company ? decodeEntities(j.company) : j.company;
  });
  return { jobs: all, sources };
}

export { boardFrom };
