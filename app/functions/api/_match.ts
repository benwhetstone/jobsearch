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
}

export interface MatchResult {
  total: number;                // 0..1
  skills: number; experience: number; compensation: number; terms: number; company: number;
  compFlag: "ok" | "negotiation" | "dropped" | "undisclosed";
  missing: string[];
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
  return {
    hardSkills, softSkills, domains, desiredTitles,
    yearsExperience: Math.round((months / 12) * 10) / 10,
    salaryFloor,
    remoteOnly: !!prefs?.remoteOnly,
    locationCity: prefs?.locationCity || profileCity || null,
    locationState: profileState,
  };
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

function scoreSkills(p: ProfileForMatch, hay: string, missing: string[]): number {
  const skills = [...p.hardSkills, ...p.domains];
  if (!skills.length) { missing.push("skills"); return 0.5; }
  // A posting names a handful of tools, never your whole toolkit. Scoring hits
  // against the FULL skill list makes a good match mathematically unreachable,
  // so measure against how many skills a posting realistically mentions.
  // Tightened: five expected hits, soft-skill credit capped, so a high skills
  // number means the posting genuinely names your tools.
  const expected = Math.min(5, skills.length);
  const hits = skills.filter((s) => skillAppears(s, hay)).length;
  const soft = Math.min(2, p.softSkills.filter((s) => skillAppears(s, hay)).length);
  return clamp01(hits / expected + soft * 0.04);
}

function scoreExperience(p: ProfileForMatch, job: JobForMatch, missing: string[]): number {
  const jt = norm(job.title);
  // A role whose title shares nothing with the titles you're after starts
  // from nearly zero — relevance has to be earned, not assumed.
  let s = 0.18;
  if (!p.desiredTitles.length) missing.push("desired job titles");
  // strong signal: a desired-title word overlaps the job title
  const titleWords = new Set(p.desiredTitles.flatMap((t) => tokens(t)));
  const overlap = tokens(job.title).filter((w) => titleWords.has(w)).length;
  if (overlap >= 2) s += 0.62; else if (overlap === 1) s += 0.42;
  // domain relevance in the body
  const hay = norm(job.title + " " + (job.description || ""));
  if (p.domains.some((d) => hay.includes(norm(d)))) s += 0.1;
  // seniority mismatch: senior roles need real tenure
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

export function scoreJob(p: ProfileForMatch, job: JobForMatch): MatchResult {
  const missing: string[] = [];
  const hay = norm(job.title + " " + (job.description || ""));
  const skills = scoreSkills(p, hay, missing);
  const experience = scoreExperience(p, job, missing);
  const comp = scoreCompensation(p, job, missing);
  const terms = scoreTerms(p, job);
  const company = 0.8; // neutral until we add employer-reputation data

  // globalwork's EXACT formula, fitted to 16 live samples in the teardown
  // (README): totalScore = (0.55*skills + 0.45*experience) * (0.91 + 0.09*comp).
  // Location/terms is a FILTER (runSweep drops geographic impossibilities),
  // not a multiplier; freshness and company never touch the number.
  const total = clamp01((0.55 * skills + 0.45 * experience) * (0.91 + 0.09 * comp.score));

  return { total, skills, experience, compensation: comp.score, terms, company, compFlag: comp.flag, missing };
}
