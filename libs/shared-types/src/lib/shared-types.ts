/**
 * Application-level types shared by the Angular app, the Edge Functions and the
 * scheduled-task prompt. Database row shapes live in database.types.ts; this
 * file holds the wire formats and constants built on top of them.
 */
import type { EmploymentType, RoleStatus } from './database.types';

export const ROLE_STATUSES: readonly RoleStatus[] = [
  'new',
  'shortlist',
  'applied',
  'interview',
  'offer',
  'rejected',
  'skipped',
] as const;

export const ROLE_STATUS_LABELS: Record<RoleStatus, string> = {
  new: 'New',
  shortlist: 'To apply',
  applied: 'Applied',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  skipped: 'Skipped',
};

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: 'Full-time',
  contract: 'Contract',
};

export interface ScreeningAnswer {
  q: string;
  a: string;
}

/**
 * One role as a search run posts it to `POST /functions/v1/ingest-roles`.
 * This is deliberately close to the tracker artifact's document shape so the
 * existing scheduled task needs only a destination change.
 */
export interface IngestRole {
  company: string;
  title: string;
  url: string;
  source?: string;
  location?: string;
  /** "Full-time" | "Contract" as the task writes them, or the enum value. */
  type?: 'Full-time' | 'Contract' | EmploymentType;
  salary?: string;
  /** ISO date or '' */
  posted?: string;
  /** Comma-separated line or array; stored as an array. */
  stack?: string | string[];
  score: number;
  aiMatch?: boolean;
  reasons?: string[];
  gaps?: string[];
  coverLetter?: string;
  qa?: ScreeningAnswer[];
  postingText?: string;
}

export interface IngestExcluded {
  company?: string;
  title?: string;
  url?: string;
  reason: string;
}

/** Body of one ingest call: everything one run found. */
export interface IngestPayload {
  /** ISO timestamp of the run. */
  runAt: string;
  searched: number;
  roles: IngestRole[];
  excluded?: IngestExcluded[];
}

export interface IngestResult {
  inserted: number;
  updated: number;
  skipped: number;
  excludedStored: number;
  errors: { url: string; message: string }[];
}

/** Summary of the last run, shown at the top of Today. */
export interface RunSummary {
  at: string;
  searched: number;
  added: number;
  excluded: number;
}
