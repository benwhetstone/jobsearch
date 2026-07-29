// Per-user match scoring. Turns a user's profile_values + one job into the five
// explainable rankers (each 0..1) and a total, following globalwork's model but
// generalized so it works for ANY user in ANY field — the pay floor, desired
// titles and skills all come from that user's own profile, nothing is hardcoded.
//
// Rankers: skills, experience, compensation, terms, company. Each also reports
// what was missing from the profile that would have sharpened the score.

export interface JobForMatch {
  title: string;
  company: string | null;
  location: string | null;
  remote: boolean;
  salaryMin: number | null;
  salaryMax: number | null;
  description: string | null;
  postedAt?: string | null;
}

export interface ProfileForMatch {
  hardSkills: string[];
  softSkills: string[];
  domains: string[];
  desiredTitles: string[];
  yearsExperience: number;
  salaryFloor: number | null;   // the user's target base salary
  remoteOnly: boolean;
  locationCity: string | null;
  locationState: string | null;
  workRegions: string[];        // from workingOutside: US, EU, UK, CANADA, LATAM, GLOBAL_REMOTE_ONLY
}

export interface MatchResult {
  total: number;                // 0..1
  skills: number; experience: number; compensation: number; terms: number; company: number;
  compFlag: "ok" | "negotiation" | "dropped" | "undisclosed";
  missing: string[];
  onField: boolean;             // the role is actually in the user's field (not just tool overlap)
}

const val = (json: string | null | undefined): unknown => {
  if (json == null) return null;
  try { return JSON.parse(json); } catch { return json; }
};
const names = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x: any) => (typeof x === "string" ? x : x?.name)).filter(Boolean) : [];
const norm = (s: string) => (s || "").toLowerCase();
const tokens = (s: string) => norm(s).split(/[^a-z0-9+#.]+/).filter((t) => t.length > 1);

// Build the match-ready view of a user from their raw profile_values map.
export function buildProfileForMatch(
  values: Record<string, string | null>,
  prefs?: { remoteOnly?: boolean; salaryMin?: number | null; locationCity?: string | null }
): ProfileForMatch {
  const hardSkills = names(val(values.st_hardSkills));
  const softSkills = names(val(values.st_softSkills));
  const domains = names(val(values.st_industryDomainKnowledge));
  const desiredTitles = names(val(values.st_jobTitles));
  const floorRaw = prefs?.salaryMin ?? Number(val(values.baseSalary));
  const salaryFloor = Number.isFinite(floorRaw) && floorRaw ? Number(floorRaw) : null;

  // Total years of experience = the UNION of the work-history date ranges.
  // Summing them would double-count concurrent roles (two jobs held at once is
  // not two careers), which is exactly how a 26-year career reads as 28 years.
  const months = unionMonths(val(values.st_workExperiences));
  // Location lives as two free-text fields (city + state), not one object.
  const profileCity = typeof val(values.city) === "string" ? (val(values.city) as string) : null;
  const profileState = typeof val(values.state) === "string" ? (val(values.state) as string) : null;
  const wo = val(values.workingOutside);
  const workRegions = Array.isArray(wo) ? wo.map((x: any) => String(x).toUpperCase()) : ["US"];
  return {
    hardSkills, softSkills, domains, desiredTitles,
    yearsExperience: Math.round((months / 12) * 10) / 10,
    salaryFloor,
    remoteOnly: !!prefs?.remoteOnly,
    locationCity: prefs?.locationCity || profileCity || null,
    locationState: profileState,
    workRegions: workRegions.length ? workRegions : ["US"],
  };
}

// Foreign-market markers: country/region names and the German gender-notation
// suffixes (m/w/d, f/m/x) that flag EU postings. Used to keep non-US roles out
// of a US-only feed even when they're remote.
const FOREIGN_MARKERS = /\b(germany|deutschland|munich|münchen|berlin|hamburg|frankfurt|cologne|united kingdom|england|scotland|wales|london|manchester|edinburgh|ireland|dublin|france|paris|lyon|spain|madrid|barcelona|portugal|lisbon|porto|netherlands|amsterdam|belgium|brussels|italy|milan|rome|switzerland|zurich|zürich|geneva|austria|vienna|sweden|stockholm|denmark|copenhagen|norway|oslo|finland|helsinki|poland|warsaw|kraków|krakow|czech|prague|romania|bucharest|hungary|budapest|ukraine|kyiv|greece|athens|turkey|istanbul|israel|tel aviv|india|bangalore|bengaluru|hyderabad|mumbai|pune|delhi|gurgaon|noida|chennai|pakistan|lahore|karachi|philippines|manila|cebu|vietnam|indonesia|jakarta|malaysia|thailand|bangkok|singapore|hong kong|japan|tokyo|korea|seoul|china|shanghai|beijing|taiwan|australia|sydney|melbourne|brisbane|new zealand|auckland|canada|toronto|vancouver|ottawa|montreal|montréal|calgary|ontario|québec|quebec|british columbia|alberta|brazil|brasil|são paulo|sao paulo|mexico|méxico|guadalajara|argentina|buenos aires|chile|santiago|colombia|bogotá|bogota|peru|lima|uruguay|costa rica|nigeria|lagos|kenya|nairobi|south africa|egypt|cairo|uae|dubai|abu dhabi|latam|emea|apac|anz|\(m\/w\/d\)|m\/w\/d|f\/m\/x|f\/m\/d|w\/m\/d)\b/i;
const US_MARKERS = /\b(united states|u\.s\.a?\.?|\busa\b|\bus\b|remote us|remote, us|americas?|new york|san francisco|seattle|austin|boston|chicago|denver|atlanta|dallas|los angeles|washington|,\s*(?:al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy|dc)\b)/i;

// Is this posting acceptable given where the user will work? US-only users
// don't see non-US roles even when remote; broader region choices open it up.
export function regionAllowed(p: ProfileForMatch, job: JobForMatch): boolean {
  if (p.workRegions.includes("GLOBAL_REMOTE_ONLY")) return true;
  const nonUsRegions = p.workRegions.filter((r) => r !== "US");
  if (nonUsRegions.length) return true;   // user opted into other regions; don't filter
  // US-only: reject a posting that carries a foreign marker and no US marker.
  const text = `${job.title} ${job.location || ""}`;
  if (FOREIGN_MARKERS.test(text) && !US_MARKERS.test(text)) return false;
  return true;
}

// US state abbreviation -> full name, so "FL" also matches "Florida".
const STATE_NAMES: Record<string, string> = {
  al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california", co: "colorado",
  ct: "connecticut", de: "delaware", fl: "florida", ga: "georgia", hi: "hawaii", id: "idaho",
  il: "illinois", in: "indiana", ia: "iowa", ks: "kansas", ky: "kentucky", la: "louisiana",
  me: "maine", md: "maryland", ma: "massachusetts", mi: "michigan", mn: "minnesota",
  ms: "mississippi", mo: "missouri", mt: "montana", ne: "nebraska", nv: "nevada",
  nh: "new hampshire", nj: "new jersey", nm: "new mexico", ny: "new york", nc: "north carolina",
  nd: "north dakota", oh: "ohio", ok: "oklahoma", or: "oregon", pa: "pennsylvania",
  ri: "rhode island", sc: "south carolina", sd: "south dakota", tn: "tennessee", tx: "texas",
  ut: "utah", vt: "vermont", va: "virginia", wa: "washington", wv: "west virginia",
  wi: "wisconsin", wy: "wyoming", dc: "district of columbia",
};

// Merge overlapping [start,end) role intervals and total the covered months.
function unionMonths(exp: unknown): number {
  if (!Array.isArray(exp)) return 0;
  const mi = (d: Date) => d.getFullYear() * 12 + d.getMonth();
  const spans: [number, number][] = [];
  for (const e of exp as any[]) {
    const start = parseYm(e?.startDate);
    const end = e?.endDate ? parseYm(e.endDate) : new Date();
    if (!start || !end) continue;
    const a = mi(start), b = mi(end);
    if (b > a) spans.push([a, b]);
  }
  spans.sort((x, y) => x[0] - y[0]);
  let total = 0, curA = -1, curB = -1;
  for (const [a, b] of spans) {
    if (curB < 0) { curA = a; curB = b; continue; }
    if (a <= curB) curB = Math.max(curB, b);        // overlapping/contiguous → extend
    else { total += curB - curA; curA = a; curB = b; }
  }
  if (curB >= 0) total += curB - curA;
  return total;
}

function parseYm(s: unknown): Date | null {
  if (typeof s !== "string" || !s.trim()) return null;
  const m = s.match(/(\d{4})(?:[-/](\d{1,2}))?/);
  if (!m) return null;
  return new Date(Number(m[1]), m[2] ? Number(m[2]) - 1 : 0, 1);
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// ---- individual rankers ------------------------------------------------------

// A skill "appears" if its exact phrase is in the text, or every significant word
// of it is ("Relational Data Modeling" vs "...data modeling for relational...").
function skillAppears(skill: string, hay: string): boolean {
  const s = norm(skill);
  if (!s) return false;
  if (hay.includes(s)) return true;
  const parts = tokens(skill).filter((t) => t.length > 2);
  return parts.length > 1 && parts.every((t) => hay.includes(t));
}

// Words that appear in almost every job title or skills list and therefore
// carry NO relevance signal — matching on them is how "Sales Compensation
// Analyst" or "Assistant Account Payable" sneak in looking like data roles.
const GENERIC_TITLE = new Set([
  "analyst", "specialist", "manager", "coordinator", "associate", "assistant",
  "senior", "junior", "lead", "principal", "staff", "sr", "jr", "ii", "iii", "iv",
  "remote", "hybrid", "onsite", "full", "time", "the", "and", "of", "for", "job",
  "professional", "consultant", "representative", "officer", "director", "engineer",
]);
// Generic tools that appear in postings across every field; a hit on one of
// these alone is weak evidence, so they're worth a fraction of a distinctive skill.
const GENERIC_SKILL = new Set([
  "microsoft office", "microsoft excel", "excel", "google sheets", "data analysis",
  "data", "reporting", "business reporting", "communication", "office",
]);

function distinctiveTitleTokens(titles: string[]): Set<string> {
  const out = new Set<string>();
  for (const t of titles) for (const w of tokens(t)) if (!GENERIC_TITLE.has(w) && w.length > 2) out.add(w);
  return out;
}

function scoreSkills(p: ProfileForMatch, hay: string, missing: string[]): number {
  const skills = [...p.hardSkills, ...p.domains];
  if (!skills.length) { missing.push("skills"); return 0.5; }
  // Weight each hit: a distinctive skill (SQL, Power BI, T-SQL, KPI Definition)
  // is worth a full point; a ubiquitous one (Excel, "Data") a third. So a
  // posting that only says "Excel" and "reporting" no longer reads as a strong
  // skills match — it has to name your real, specific tools.
  const expected = Math.min(4, skills.filter((s) => !GENERIC_SKILL.has(norm(s))).length || skills.length);
  let hits = 0;
  for (const s of skills) if (skillAppears(s, hay)) hits += GENERIC_SKILL.has(norm(s)) ? 0.34 : 1;
  const soft = Math.min(1.5, p.softSkills.filter((s) => skillAppears(s, hay)).length * 0.5);
  return clamp01((hits + soft * 0.04) / Math.max(2, expected));
}

function scoreExperience(p: ProfileForMatch, job: JobForMatch, missing: string[]): number {
  const jt = norm(job.title);
  if (!p.desiredTitles.length) missing.push("desired job titles");
  // Relevance rides on DISTINCTIVE title words. "Data Analyst" vs "Insider
  // Threat Analyst" both contain "analyst" — worthless. What matters is
  // whether the posting shares "data" / "business" / "operations" with the
  // titles you're actually after.
  const distinctive = distinctiveTitleTokens(p.desiredTitles);
  const jobTokens = tokens(job.title);
  const distinctiveHits = jobTokens.filter((w) => distinctive.has(w)).length;
  const genericAnalyst = jobTokens.some((w) => /analyst|analytics/.test(w));
  // A shared distinctive word ("business", "data") only counts as a real match
  // when the role is actually analytics work. "Business Development
  // Representative" shares "business" but is sales, not analysis — half credit.
  const analyticsRole = /analy|data|report|insight|intelligence|dashboard|bi\b/.test(jt);

  let s = 0.12;
  const w = analyticsRole ? 1 : 0.4;
  if (distinctiveHits >= 2) s += 0.7 * w;
  else if (distinctiveHits === 1) s += 0.5 * w;
  else if (genericAnalyst) s += 0.18;   // an "X Analyst" with no shared domain: weak, not zero

  // domain relevance in the body (real estate / saas / operations)
  const hay = norm(job.title + " " + (job.description || ""));
  if (p.domains.some((d) => hay.includes(norm(d)))) s += 0.08;

  const senior = /(senior|sr\.?|lead|principal|staff|manager|director|head of)/.test(jt);
  const junior = /(junior|jr\.?|entry|intern|associate|assistant)/.test(jt);
  if (!p.yearsExperience) missing.push("work history (years of experience)");
  else {
    if (senior && p.yearsExperience < 5) s -= 0.25;
    if (junior && p.yearsExperience > 8) s -= 0.1;
  }
  return clamp01(s);
}

// Generalized pay gate over the user's own floor. Returns [rankerScore, multiplier, flag].
function scoreCompensation(p: ProfileForMatch, job: JobForMatch, missing: string[]): { score: number; mult: number; flag: MatchResult["compFlag"] } {
  const floor = p.salaryFloor;
  const top = job.salaryMax ?? job.salaryMin;
  if (!floor) missing.push("target salary");
  // Undisclosed pay is unknown, not bad — a light touch, not a 15% haircut,
  // or every posting that hides salary (most of them) reads as a weak match.
  if (top == null) return { score: 0.85, mult: 0.93, flag: "undisclosed" };
  if (!floor) return { score: 0.85, mult: 0.95, flag: "undisclosed" };
  if (top >= floor) return { score: 1.0, mult: 1.0, flag: "ok" };
  if (top >= floor * 0.9) return { score: 0.72, mult: 0.6, flag: "negotiation" };
  return { score: clamp01(top / floor) * 0.5, mult: 0.0, flag: "dropped" };
}

function scoreTerms(p: ProfileForMatch, job: JobForMatch): number {
  const hybrid = /hybrid/.test(norm(job.title + " " + (job.description || "")));
  if (p.remoteOnly) return job.remote ? 1.0 : hybrid ? 0.55 : 0.3;
  if (job.remote) return 0.95;
  if (hybrid && nearHome(p, job.location)) return 0.92;
  // On-site (or hybrid) is only a real option when it's actually near home. A
  // Berlin office is not an 82% terms match for someone in Tampa.
  const loc = norm(job.location || "");
  if (!loc) return 0.55;                       // location unknown: neutral, not friendly
  return nearHome(p, job.location) ? 0.88 : 0.15;
}

function nearHome(p: ProfileForMatch, jobLocation: string | null): boolean {
  const loc = norm(jobLocation || "");
  if (!loc) return false;
  if (p.locationCity && loc.includes(norm(p.locationCity))) return true;
  const st = norm(p.locationState || "");
  if (!st) return false;
  if (new RegExp(`\\b${st.replace(/[.*+?^${}()|[\]\\]/g, "")}\\b`).test(loc)) return true;
  const full = STATE_NAMES[st];
  return !!full && loc.includes(full);
}

// A months-old posting is usually filled or abandoned. Taper rather than cut, so
// a great stale match still shows up — just below a good fresh one.
function freshness(postedAt: string | null | undefined): number {
  if (!postedAt) return 0.97;                 // unknown date: barely penalised
  const days = (Date.now() - new Date(postedAt).getTime()) / 86400000;
  if (!Number.isFinite(days) || days < 0) return 0.97;
  if (days <= 14) return 1.0;
  if (days <= 30) return 0.95;
  if (days <= 60) return 0.88;
  if (days <= 120) return 0.78;
  return 0.68;
}

// ---- combine -----------------------------------------------------------------

// Pure filler in a job title — carries no professional meaning. Everything
// NOT in here that appears in the user's desired titles IS their profession
// (analyst, developer, nurse, designer…), and a job must share one of those
// words to be in the user's field at all. This is entirely profile-driven:
// change the user's titles and "on-field" changes with them.
const TITLE_FILLER = new Set([
  "senior", "junior", "sr", "jr", "i", "ii", "iii", "iv", "v", "mid", "level",
  "entry", "lead", "principal", "staff", "remote", "hybrid", "onsite", "on",
  "site", "full", "part", "time", "the", "and", "of", "for", "to", "a", "an",
  "job", "jobs", "new", "with", "in", "at",
]);

const sameFamily = (a: string, b: string) =>
  a === b || (a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5));

// The PROFESSION word in a title is its last meaningful token: "Data Analyst"
// -> analyst, "Business Analyst" -> analyst. "Data" is a modifier, not the
// profession — which is exactly why matching on it let Data Scientist and
// "Human Data" Program Manager through. We match on the profession head.
function professionHeads(titles: string[]): string[] {
  return titles.map((t) => {
    const toks = tokens(t).filter((w) => w.length > 2 && !TITLE_FILLER.has(w));
    return toks[toks.length - 1];
  }).filter(Boolean);
}

// On-field = the job's title carries the user's own profession. A user
// targeting "Data Analyst / Business Analyst" sees analyst/analytics/analysis
// roles — NOT Data Scientist, Data Engineer, or Program Manager, however much
// "data" they share. Fully profile-driven: the heads come from their titles.
function isOnField(p: ProfileForMatch, job: JobForMatch): boolean {
  const heads = professionHeads(p.desiredTitles);
  if (!heads.length) return true;   // no titles on file: don't over-filter
  return tokens(job.title).some((jw) => heads.some((h) => sameFamily(jw, h)));
}

export function scoreJob(p: ProfileForMatch, job: JobForMatch): MatchResult {
  const missing: string[] = [];
  const hay = norm(job.title + " " + (job.description || ""));
  const skills = scoreSkills(p, hay, missing);
  const experience = scoreExperience(p, job, missing);
  const comp = scoreCompensation(p, job, missing);
  const terms = scoreTerms(p, job);
  const company = 0.8; // neutral until we add employer-reputation data
  const onField = isOnField(p, job);

  // globalwork's fitted formula (teardown README, 16 live samples):
  // (0.55*skills + 0.45*experience) * (0.91 + 0.09*comp). Location/terms is a
  // keep-filter, not a multiplier; freshness and company never touch it.
  // ADDED: a title-fit gate so strong skills can't carry a wrong role — a
  // "Software Developer" that names your tools but isn't an analyst caps out
  // well below a real data role. Full credit once experience >= 0.6.
  const titleFit = 0.55 + 0.45 * Math.min(1, experience / 0.6);
  // Off-field roles (title shares nothing with the user's own titles) are never
  // a real match no matter how many tools overlap — they're dropped in runSweep.
  const total = clamp01((0.55 * skills + 0.45 * experience) * (0.91 + 0.09 * comp.score) * titleFit * (onField ? 1 : 0.4));

  return { total, skills, experience, compensation: comp.score, terms, company, compFlag: comp.flag, missing, onField };
}
