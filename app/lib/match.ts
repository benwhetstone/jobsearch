// Match scoring — the two-stage rerank layer, ready for Phase 2.
// Formula fitted to 16 live globalwork jobs (mean abs error < 0.0002) plus Ben's
// deliberate compensation deviation. Band copy is theirs, verbatim (good wording).
// Sources: PROJECT-BRIEF §5.2-5.4, code/match-score-bands.ts.
//
// Rankers return 0..1. Bands resolve on 0..100, so ×100 happens at display time.

export const RANKER_ORDER = ["skills", "experience", "compensation", "terms", "company"] as const;
export type RankerKey = (typeof RANKER_ORDER)[number];

export const RANKER_LABELS: Record<RankerKey, string> = {
  skills: "Skills",
  experience: "Experience",
  compensation: "Compensation",
  terms: "Terms",
  company: "Company",
};

type Band = { min: number; max: number; color: "success" | "caution" | "critical"; description: string };

export const RANKER_BANDS: Record<string, Band[]> = {
  skills: [
    { min: 90, max: 100, color: "success", description: "You've got all the key skills this role is looking for" },
    { min: 75, max: 89, color: "success", description: "You have most of the key skills this role needs" },
    { min: 55, max: 74, color: "caution", description: "You have about half the key skills for this role" },
    { min: 0, max: 54, color: "critical", description: "Most of the must-have skills for this role aren't a match" },
  ],
  experience: [
    { min: 90, max: 100, color: "success", description: "Your experience level and work history are a great fit for this role" },
    { min: 75, max: 89, color: "success", description: "Your experience is a good fit for what this role needs" },
    { min: 55, max: 74, color: "caution", description: "Your background is relevant, even if it's not a perfect fit" },
    { min: 0, max: 54, color: "critical", description: "Your experience is a bit far from what this role is looking for" },
  ],
  compensation: [
    { min: 95, max: 100, color: "success", description: "The pay here meets or beats what you're looking for" },
    { min: 80, max: 94, color: "success", description: "A little under your target, but still in a comfortable range" },
    { min: 60, max: 79, color: "caution", description: "Pay comes in a bit below your target" },
    { min: 0, max: 59, color: "critical", description: "This role likely won't meet your pay expectations" },
  ],
  terms: [
    { min: 90, max: 100, color: "success", description: "Work style, schedule and location all match what you're after" },
    { min: 60, max: 89, color: "caution", description: "Mostly a fit, with a small difference in the work setup" },
    { min: 0, max: 59, color: "critical", description: "The format, schedule or location doesn't line up with your preferences" },
  ],
};

export function resolveRanker(key: keyof typeof RANKER_BANDS, rawScore0to100: number) {
  const score = Math.max(0, Math.min(100, Math.round(rawScore0to100)));
  const bands = RANKER_BANDS[key];
  const band = bands.find((b) => score >= b.min && score <= b.max) ?? bands[0];
  return { label: RANKER_LABELS[key as RankerKey] ?? key, description: band.description, score, color: band.color };
}

export interface RankerScores {
  skills: number; experience: number; compensation: number; terms: number; company: number;
}

// Their exact combination, fitted to live data. Kept for calibration/reference.
export function totalScoreGlobalwork(r: RankerScores): number {
  const core = 0.55 * r.skills + 0.45 * r.experience;
  return core * (0.91 + 0.09 * r.compensation);
}

// Ben's compensation gate: a hard pay floor is not a 9% haircut. Step function
// over the job's max salary. PROJECT-BRIEF §5.3.
export function compMultiplier(jobSalaryMax: number | null): number {
  if (jobSalaryMax == null) return 0.85; // undisclosed: penalize, don't eliminate
  if (jobSalaryMax < 54000) return 0.0;  // hard drop
  if (jobSalaryMax < 60000) return 0.6;  // surfaced, flagged "negotiation candidate"
  return 1.0;
}

export function compensationFlag(jobSalaryMax: number | null): "dropped" | "negotiation" | "ok" | "undisclosed" {
  if (jobSalaryMax == null) return "undisclosed";
  if (jobSalaryMax < 54000) return "dropped";
  if (jobSalaryMax < 60000) return "negotiation";
  return "ok";
}

// Ben's total. terms/company kept as soft multiplicative gates (their weights were
// unidentifiable in the sample; same shape assumed). Returns 0..1.
export function totalScoreForBen(
  r: { skills: number; experience: number; terms: number; company: number },
  jobSalaryMax: number | null
): number {
  const core = 0.55 * r.skills + 0.45 * r.experience;
  const gates = (0.7 + 0.3 * r.terms) * (0.85 + 0.15 * r.company);
  return core * gates * compMultiplier(jobSalaryMax);
}

// Headline color threshold from their summary component.
export function headlineColor(totalScore0to100: number): "success" | "caution" {
  return totalScore0to100 > 80 ? "success" : "caution";
}
