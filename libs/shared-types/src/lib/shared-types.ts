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

export const EMPLOYMENT_TYPES: readonly EmploymentType[] = [
  'full_time',
  'contract',
  'freelance',
  'part_time',
] as const;

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: 'Full-time',
  contract: 'Contract',
  freelance: 'Freelance',
  part_time: 'Part-time',
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
  type?: 'Full-time' | 'Contract' | 'Freelance' | 'Part-time' | EmploymentType;
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

/** Summary of the recent search runs, shown at the top of Today. */
export interface RunSummary {
  /** When the latest run finished. */
  at: string;
  searched: number;
  added: number;
  excluded: number;
  /** How many runs this sums (Jobbotix matches hourly; a scheduled task once a day). */
  runs: number;
  /** Listings that were another kind of job; present once a run reports it. */
  notRelevant?: number;
  /** Of the excluded, those that were the right job but scored too low. */
  lowMatch?: number;
  /**
   * The AI check on titles the rules were unsure about: how many it looked
   * at, turned down and brought in. Present once a run used it.
   */
  aiCheck?: { looked: number; turnedDown: number; broughtIn: number };
  /** Runs whose AI step failed, with the first reason given. */
  aiTrouble?: { runs: number; reason: string };
}

/** One board a posting was seen on, with the page to credit and open. */
export interface PostingSeenOn {
  sourceId: string;
  name: string;
  url: string;
}
