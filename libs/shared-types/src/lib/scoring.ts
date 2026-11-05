import type { Json } from './database.types';

/**
 * Scoring weights: how many points each signal adds (or removes) when a run
 * scores a posting. Defaults mirror settings.scoring_defaults in the database;
 * a user's search profile may override any of them.
 */
export type ScoringWeights = {
  framework_primary: number;
  framework_other: number;
  fullstack: number;
  remote_worldwide: number;
  remote_overlap: number;
  remote_vague: number;
  ai_assisted: number;
  senior: number;
  backend_heavy: number;
  remote_unclear: number;
  short_project: number;
};

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  framework_primary: 30,
  framework_other: 15,
  fullstack: 10,
  remote_worldwide: 25,
  remote_overlap: 15,
  remote_vague: 8,
  ai_assisted: 20,
  senior: 10,
  backend_heavy: -10,
  remote_unclear: -10,
  short_project: -15,
};

export const SCORING_WEIGHT_LABELS: Record<keyof ScoringWeights, string> = {
  framework_primary: 'Primary stack is the main framework',
  framework_other: 'Another senior frontend framework',
  fullstack: 'Full-stack with a frontend framework',
  remote_worldwide: 'Remote, worldwide',
  remote_overlap: 'Remote with a timezone-overlap requirement',
  remote_vague: 'Remote with vague restrictions',
  ai_assisted: 'Mentions AI-assisted development',
  senior: 'Senior or lead, 5+ years',
  backend_heavy: 'Backend-heavy (penalty)',
  remote_unclear: 'Unclear remote eligibility (penalty)',
  short_project: 'Project under 3 months (penalty)',
};

/** Merges a stored (possibly partial or malformed) weights value over the defaults. */
export function resolveScoringWeights(
  stored: Json | null | undefined,
): ScoringWeights {
  const out = { ...DEFAULT_SCORING_WEIGHTS };
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    for (const k of Object.keys(out) as (keyof ScoringWeights)[]) {
      const v = (stored as Record<string, unknown>)[k];
      if (typeof v === 'number' && Number.isFinite(v))
        out[k] = Math.max(-50, Math.min(50, Math.round(v)));
    }
  }
  return out;
}
