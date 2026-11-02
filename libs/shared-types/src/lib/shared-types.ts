/**
 * Shared types for Jobbotix, used by the Angular app and the Supabase Edge
 * Functions. Keep this file free of runtime dependencies.
 *
 * The database schema is the source of truth; these types will be regenerated
 * from it (supabase gen types) once the Phase 0 migrations land. Until then
 * they mirror the data model in the plan.
 */

export type RoleStatus =
  | 'new'
  | 'shortlist'
  | 'applied'
  | 'interview'
  | 'offer'
  | 'rejected'
  | 'skipped';

export const ROLE_STATUSES: readonly RoleStatus[] = [
  'new',
  'shortlist',
  'applied',
  'interview',
  'offer',
  'rejected',
  'skipped',
] as const;

export type EmploymentType = 'Full-time' | 'Contract';

/** One job posting as it is stored per user. */
export interface Role {
  id: string;
  userId: string;
  company: string;
  title: string;
  url: string;
  source: string;
  location: string;
  type: EmploymentType;
  salary: string;
  /** ISO date the posting went live, or empty when unknown. */
  posted: string;
  stack: string;
  /** 0-100 fit score against the user's search profile. */
  score: number;
  aiMatch: boolean;
  status: RoleStatus;
  reasons: string[];
  gaps: string[];
  coverLetter: string;
  qa: ScreeningAnswer[];
  notes: string;
  /** ISO timestamp of the run that found it. */
  foundAt: string;
  updatedAt: string;
}

export interface ScreeningAnswer {
  q: string;
  a: string;
}

/** Summary of one scheduled search run, shown at the top of the tracker. */
export interface RunSummary {
  at: string;
  searched: number;
  added: number;
  excluded: string;
}
