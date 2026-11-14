// The adapter contract. One module per source; each turns that source's feed
// into PoolPosting rows that ingest_postings() (migration 0016) accepts.

import type { EmploymentType } from '../employment.ts';

export type RemotePolicy =
  'worldwide' | 'region_locked' | 'hybrid' | 'onsite' | 'unknown';

/** One posting as the pool stores it, plus where this source keeps it. */
export interface PoolPosting {
  dedupe_key: string;
  external_id: string;
  source_url: string;
  company: string;
  title: string;
  url: string;
  location: string;
  remote_policy: RemotePolicy;
  hiring_countries: string[];
  hiring_regions: string[];
  timezones: string;
  source_country: string | null;
  employment_type: EmploymentType;
  seniority: string;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string;
  salary_text: string;
  tags: string[];
  description: string;
  company_logo: string;
  ats_kind: string | null;
  ats_slug: string | null;
  posted_at: string | null;
  expires_at: string | null;
}

/** What an adapter produces before the shared finishing step (dedupe key, ATS). */
export type DraftPosting = Omit<
  PoolPosting,
  'dedupe_key' | 'ats_kind' | 'ats_slug'
>;

export interface AdapterContext {
  /** Search terms built from every active search profile ("angular", "frontend"). */
  queries: string[];
  /** Every distinct target role across active profiles, for sources that list all of a company's jobs. */
  roles?: string[];
  /** Postings older than this are not worth paging back to. */
  since: Date;
  /** Hard cap on HTTP requests for this run (source_catalog.max_requests_per_run). */
  maxRequests: number;
  /** Injected so tests can replay fixtures. */
  fetch: typeof fetch;
  /** Pause between requests; a no-op in tests. */
  sleep: (ms: number) => Promise<void>;
  /**
   * Countries users live in or can work for (ISO codes, most users first),
   * for country-scoped sources. Empty when no profile has set one.
   */
  countries?: string[];
  /** Function secrets an adapter may need (API keys); injected for tests. */
  secret?: (name: string) => string | undefined;
  /** For the company-careers source: which companies to poll this run. */
  companies?: CompanyTarget[];
}

export interface CompanyTarget {
  id: string;
  kind:
    'greenhouse' | 'lever' | 'ashby' | 'workable' | 'recruitee' | 'personio';
  slug: string;
  name: string;
  /** 'eu' when the board is known to live on the system's European host. */
  region?: '' | 'eu';
}

/** One polled company's outcome, written back to the companies table. */
export interface CompanyResult {
  id: string;
  error?: string;
  open_roles?: number;
  /** Roles this poll kept for the pool; decides how often the company is polled. */
  kept?: number;
  /** Set when the poll learned which host the board lives on. */
  region?: 'eu';
  name?: string;
}

export interface AdapterResult {
  postings: DraftPosting[];
  requests: number;
  /** Non-fatal problems (one page failed); a thrown error fails the run. */
  warnings: string[];
  companies?: CompanyResult[];
}

export interface SourceAdapter {
  id: string;
  run(ctx: AdapterContext): Promise<AdapterResult>;
}

export const USER_AGENT =
  'Jobbotix/1.0 (+https://jobbotix.com; job tracker that links back to every posting)';
