// Extracted verbatim (deminified) from globalwork.ai bundle /v2/assets/index-BPiZ4L5P.js
// This is their entire "explain the match score in English" layer.
// 4 rankers shown in UI; a 5th ("company") is computed server-side but hidden.

export const RANKER_ORDER = ['skills', 'experience', 'compensation', 'terms'] as const;

export const RANKER_LABELS = {
  skills: 'Skills',
  experience: 'Experience',
  compensation: 'Compensation',
  terms: 'Terms',
} as const;

type Band = { min: number; max: number; color: 'success' | 'caution' | 'critical'; description: string };

export const RANKER_BANDS: Record<string, Band[]> = {
  skills: [
    { min: 90, max: 100, color: 'success',  description: "You've got all the key skills this role is looking for" },
    { min: 75, max: 89,  color: 'success',  description: 'You have most of the key skills this role needs' },
    { min: 55, max: 74,  color: 'caution',  description: 'You have about half the key skills for this role' },
    { min: 0,  max: 54,  color: 'critical', description: "Most of the must-have skills for this role aren't a match" },
  ],
  experience: [
    { min: 90, max: 100, color: 'success',  description: 'Your experience level and work history are a great fit for this role' },
    { min: 75, max: 89,  color: 'success',  description: 'Your experience is a good fit for what this role needs' },
    { min: 55, max: 74,  color: 'caution',  description: "Your background is relevant, even if it's not a perfect fit" },
    { min: 0,  max: 54,  color: 'critical', description: 'Your experience is a bit far from what this role is looking for' },
  ],
  compensation: [
    { min: 95, max: 100, color: 'success',  description: "The pay here meets or beats what you're looking for" },
    { min: 80, max: 94,  color: 'success',  description: 'A little under your target, but still in a comfortable range' },
    { min: 60, max: 79,  color: 'caution',  description: 'Pay comes in a bit below your target' },
    { min: 0,  max: 59,  color: 'critical', description: "This role likely won't meet your pay expectations" },
  ],
  terms: [
    { min: 90, max: 100, color: 'success',  description: "Work style, schedule and location all match what you're after" },
    { min: 60, max: 89,  color: 'caution',  description: 'Mostly a fit, with a small difference in the work setup' },
    { min: 0,  max: 59,  color: 'critical', description: "The format, schedule or location doesn't line up with your preferences" },
  ],
};

// Original resolver, deminified:
export function resolveRanker(key: keyof typeof RANKER_BANDS, rawScore: number) {
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));
  const bands = RANKER_BANDS[key];
  const band = bands.find(b => score >= b.min && score <= b.max) ?? bands[0];
  return { label: RANKER_LABELS[key], description: band.description, score, color: band.color };
}

// Overall headline color threshold (from the summary component):
//   score > 80 -> 'success' ; else 'caution'

// ---------------------------------------------------------------------------
// SOLVED: the combination formula, fitted to 16 live samples (mean abs error < 0.0002)
// The API returns rankers in 0..1; the bands above resolve on 0..100, so multiply by 100.
// ---------------------------------------------------------------------------

export function totalScore(r: {
  skills: number; experience: number;
  compensation: number; terms: number; company: number;
}): number {
  const core = 0.55 * r.skills + 0.45 * r.experience;
  // compensation is only a 9% multiplicative gate. terms/company were 1.0 on all
  // 120 observed jobs, so their weights are unidentifiable; same shape assumed.
  return core * (0.91 + 0.09 * r.compensation);
}

// Evidence (total | 0.55*sk + 0.45*ex | compensation):
//   0.9887 | 0.9887 | 1.0000
//   0.9586 | 0.9586 | 1.0000
//   0.8699 | 0.8699 | 1.0000
//   0.4050 | 0.4051 | 1.0000
//   0.8157 | 0.8964 | 0.0000   <- gate fires, residual resolves exactly at w=0.09
//   0.7332 | 0.7559 | 0.6667
//   0.6550 | 0.7198 | 0.0000
//
// relevanceScore fits with weight -0.00 -> it is NOT part of totalScore.

// ---------------------------------------------------------------------------
// RECOMMENDED DEVIATION for Ben: a 9% haircut is the wrong instrument for a
// hard pay floor. Replace the compensation gate with a step function.
// ---------------------------------------------------------------------------

export function compMultiplier(jobSalaryMax: number | null): number {
  if (jobSalaryMax == null) return 0.85;   // undisclosed: penalize, don't eliminate
  if (jobSalaryMax < 54000) return 0.0;    // hard drop
  if (jobSalaryMax < 60000) return 0.6;    // surfaced, flagged "negotiation candidate"
  return 1.0;
}

export function totalScoreForBen(r: {
  skills: number; experience: number; terms: number; company: number;
}, jobSalaryMax: number | null): number {
  const core = 0.55 * r.skills + 0.45 * r.experience;
  const gates = (0.7 + 0.3 * r.terms) * (0.85 + 0.15 * r.company);
  return core * gates * compMultiplier(jobSalaryMax);
}
