import type { ContactRelation, TouchChannel, TouchDirection } from './contacts';
import type {
  InterviewKind,
  InterviewOutcome,
  InterviewStatus,
} from './interviews';
import type { PoolPostingFacts } from './posting-health';
/**
 * Database types for Jobbotix, in the shape `supabase gen types typescript`
 * produces, so the client is fully typed today and the file can be replaced by
 * the generated one without touching callers:
 *
 *   supabase gen types typescript --local > libs/shared-types/src/lib/database.types.ts
 *
 * Keep in step with supabase/migrations.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type RoleStatus =
  | 'new'
  | 'shortlist'
  | 'applied'
  | 'interview'
  | 'offer'
  | 'rejected'
  | 'skipped';
export type EmploymentType =
  'full_time' | 'contract' | 'freelance' | 'part_time';
export type RoleEventKind =
  'status_change' | 'note' | 'generated' | 'reminder' | 'run' | 'ingested';
export type AiJob =
  | 'extract'
  | 'score'
  | 'tailor'
  | 'letter'
  | 'answer'
  | 'prep'
  | 'import'
  | 'research'
  | 'thank_you'
  | 'message';
export type VariantStatus = 'draft' | 'approved';
export type RemotePolicy =
  'worldwide' | 'region_locked' | 'hybrid' | 'onsite' | 'unknown';
export type SourceKind =
  'board' | 'aggregator' | 'ats' | 'community' | 'capture';
export type SourceAccess = 'public_api' | 'keyed_api' | 'rss' | 'manual';

type Timestamps = { created_at: string; updated_at: string };

export type ProfileRow = Timestamps & {
  id: string;
  email: string;
  name: string;
  timezone: string;
  invite_code: string | null;
  anthropic_key_ref: string | null;
  default_model: string;
  is_admin: boolean;
  /** 'own': AI work never spends credits (missing before migration 0035). */
  ai_route?: 'auto' | 'own';
  /** Set by an admin (missing before migration 0037). */
  suspended_at?: string | null;
  /** Until then an admin may see the account's roles and resume. */
  support_access_until?: string | null;
  /** The look of the resume (missing before migration 0038). */
  resume_template?: string;
};

export type InviteCodeRow = {
  code: string;
  created_by: string | null;
  note: string;
  max_uses: number;
  uses: number;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export type InviteRequestRow = {
  id: string;
  email: string;
  note: string;
  created_at: string;
  invited_code: string | null;
};

export type SettingRow = {
  key: string;
  value: Json;
  updated_at: string;
};

export type IngestKeyRow = {
  id: string;
  user_id: string;
  key_hash: string;
  label: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export type SearchProfileRow = Timestamps & {
  id: string;
  user_id: string;
  name: string;
  target_roles: string[];
  stacks: string[];
  remote_rules: Json;
  exclusions: Json;
  languages: string[];
  min_seniority: string;
  scoring_weights: Json;
  employment_types: EmploymentType[];
  digest_time: string;
  digest_days: number[];
  digest_min_score: number;
  digest_enabled: boolean;
  active: boolean;
  /** ISO 3166-1 alpha-2, e.g. 'BD'. */
  home_country: string | null;
  /** Further countries the user can legally work in or for. */
  allowed_countries: string[];
  remote_only: boolean;
  last_matched_at: string | null;
  /** Email right away when a new role scores at least this; null = off. */
  alert_min_score: number | null;
};

export type RoleRow = Timestamps & {
  id: string;
  user_id: string;
  company: string;
  title: string;
  url: string;
  source: string;
  location: string;
  remote_scope: string;
  type: EmploymentType;
  salary: string;
  posted_at: string | null;
  found_at: string;
  stack: string[];
  score: number;
  score_breakdown: Json;
  reasons: string[];
  gaps: string[];
  ai_match: boolean;
  status: RoleStatus;
  cover_letter: string;
  notes: string;
  posting_text: string;
  posting_hash: string;
  status_changed_at: string;
  follow_up_days: number;
  prep: Json;
  posting_id: string | null;
  source_id: string | null;
  /**
   * The search profile that filed the role; null for a role added by hand,
   * and once that profile is deleted. Absent on rows read before migration 0047.
   */
  search_profile_id?: string | null;
  remote_policy: RemotePolicy;
  hiring_countries: string[];
  /** CompanyResearch (company.ts); {} until researched. */
  company_research: Json;
};

export type SourceCatalogRow = Timestamps & {
  id: string;
  name: string;
  kind: SourceKind;
  access: SourceAccess;
  homepage: string;
  country: string | null;
  enabled: boolean;
  max_requests_per_run: number;
  attribution: string;
  notes: string;
  last_run_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  last_fetched: number;
  last_new: number;
};

export type SourceRunRow = {
  id: number;
  source_id: string;
  started_at: string;
  finished_at: string | null;
  requests: number;
  fetched: number;
  inserted: number;
  updated: number;
  error: string | null;
};

export type PostingRow = {
  id: string;
  dedupe_key: string;
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
  first_seen_at: string;
  last_seen_at: string;
};

export type AtsKind = 'greenhouse' | 'lever' | 'ashby' | 'workable';

export type CompanyRow = {
  id: string;
  ats_kind: AtsKind;
  ats_slug: string;
  name: string;
  first_seen_at: string;
  last_polled_at: string | null;
  last_error: string | null;
  open_roles: number;
};

export type CompanyFollowRow = {
  user_id: string;
  company_id: string;
  created_at: string;
};

export type PostingSourceRow = {
  source_id: string;
  external_id: string;
  posting_id: string;
  url: string;
  first_seen_at: string;
  last_seen_at: string;
};

export type RoleEventRow = {
  id: string;
  user_id: string;
  role_id: string | null;
  kind: RoleEventKind;
  payload: Json;
  created_at: string;
};

export type ScreeningAnswerRow = {
  id: string;
  user_id: string;
  role_id: string;
  question: string;
  answer: string;
  position: number;
  created_at: string;
};

export type AppErrorRow = {
  id: string;
  fingerprint: string;
  day: string;
  user_id: string | null;
  source: 'web' | 'function';
  name: string;
  message: string;
  stack: string;
  path: string;
  user_agent: string;
  count: number;
  first_seen: string;
  last_seen: string;
};

export type ContactRow = {
  id: string;
  user_id: string;
  name: string;
  company: string;
  title: string;
  relation: ContactRelation;
  email: string;
  linkedin_url: string;
  notes: string;
  next_touch_on: string | null;
  last_touch_at: string | null;
  created_at: string;
  updated_at: string;
};

export type RoleContactRow = {
  role_id: string;
  contact_id: string;
  user_id: string;
  created_at: string;
};

export type ContactTouchRow = {
  id: string;
  user_id: string;
  contact_id: string;
  role_id: string | null;
  at: string;
  channel: TouchChannel;
  direction: TouchDirection;
  note: string;
  created_at: string;
};

export type InterviewRow = {
  id: string;
  user_id: string;
  role_id: string;
  kind: InterviewKind;
  title: string;
  scheduled_at: string | null;
  duration_min: number;
  location: string;
  interviewers: string;
  status: InterviewStatus;
  outcome: InterviewOutcome;
  notes: string;
  debrief: string;
  thank_you: string;
  thank_you_sent_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ExcludedRoleRow = {
  id: string;
  user_id: string;
  company: string;
  title: string;
  url: string;
  reason: string;
  found_at: string;
};

export type ResumeRow = Timestamps & {
  id: string;
  user_id: string;
  name: string;
  is_master: boolean;
  sections: Json;
};

export type ResumeVariantRow = Timestamps & {
  id: string;
  user_id: string;
  role_id: string;
  base_resume_id: string | null;
  sections: Json;
  diff: Json;
  keyword_report: Json;
  pdf_path: string | null;
  status: VariantStatus;
  /** This copy's own template; null or missing means the account's choice. */
  template?: string | null;
};

/** The resume photo: a small JPEG as a data URL (migration 0039). */
export type ResumePhotoRow = {
  user_id: string;
  data: string;
  updated_at: string;
};

export type CoverLetterRow = Timestamps & {
  id: string;
  user_id: string;
  role_id: string | null;
  body: string;
  word_count: number | null;
  status: VariantStatus;
  voice_sample: boolean;
};

export type SavedViewRow = {
  id: string;
  user_id: string;
  name: string;
  filters: Json;
  sort: string;
  created_at: string;
};

export type ShareRow = {
  id: string;
  user_id: string;
  token: string;
  kind: 'role' | 'board';
  role_id: string | null;
  created_at: string;
  revoked_at: string | null;
  views: number;
};

/**
 * One AI provider a user connected with their own key. The key is in Vault;
 * the app can read every column but key_ref (column grants, migration 0034).
 */
export type AiConnectionRow = {
  id: string;
  user_id: string;
  /** A provider id from the catalog in providers.ts. */
  provider: string;
  /** Vault secret name; service role only. */
  key_ref?: string;
  /** Last four characters of the key. */
  key_hint: string;
  /** '' means the provider's default model. */
  model: string;
  /** The order connections are tried in, lowest first. */
  position: number;
  status: 'untested' | 'ok' | 'error';
  last_error: string;
  last_checked_at: string | null;
  /** The provider's rate limit holds until then. */
  limited_until: string | null;
  consented_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AiUsageRow = {
  id: string;
  user_id: string;
  job: AiJob;
  /** The provider that answered ('anthropic' for rows from before 0034). */
  provider?: string;
  /** Whose key paid: the user's own, or Jobbotix's (on credits). */
  route?: 'own' | 'platform';
  model: string;
  /** The whole prompt, the cached part included. */
  tokens_in: number;
  tokens_out: number;
  /** Of tokens_in: read from the provider's prompt cache (from 0040). */
  cache_read_tokens?: number;
  /** Of tokens_in: written to the prompt cache by this call (from 0040). */
  cache_write_tokens?: number;
  cost_usd: number;
  /** Web searches billed during the call (company research). */
  web_searches: number;
  created_at: string;
};

export type PlanRow = {
  id: string;
  name: string;
  position: number;
  monthly_credits: number;
  features: string[];
  limits: Json;
};

export type SubscriptionRow = Timestamps & {
  id: string;
  user_id: string;
  plan_id: string;
  status: 'trialing' | 'active' | 'past_due' | 'canceled';
  source: 'admin' | 'polar';
  current_period_start: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  grace_until: string | null;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  granted_by: string | null;
  note: string;
};

export type PaymentRow = {
  id: string;
  user_id: string;
  provider: 'polar';
  provider_ref: string;
  kind: 'subscription' | 'topup' | 'refund';
  product: string;
  /** Negative for a refund. */
  amount_cents: number;
  currency: string;
  status: 'paid' | 'refunded' | 'failed';
  paid_at: string;
  created_at: string;
};

export type CreditLedgerRow = {
  id: string;
  user_id: string;
  /** Positive rows grant credits, negative rows spend them. */
  delta: number;
  kind: 'trial' | 'monthly' | 'topup' | 'admin' | 'spend' | 'refund' | 'expire';
  reason: string;
  ref: string | null;
  created_by: string | null;
  created_at: string;
};

/** Columns with a database default, optional on insert. */
type Insertable<Row, Defaulted extends keyof Row> = Omit<Row, Defaulted> &
  Partial<Pick<Row, Defaulted>>;

type Table<Row, Insert, Relationships extends unknown[] = []> = {
  Row: Row;
  Insert: Insert;
  Update: Partial<Insert>;
  Relationships: Relationships;
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<
        ProfileRow,
        Insertable<
          ProfileRow,
          | 'name'
          | 'timezone'
          | 'invite_code'
          | 'anthropic_key_ref'
          | 'default_model'
          | 'is_admin'
          | 'created_at'
          | 'updated_at'
        >
      >;
      invite_codes: Table<
        InviteCodeRow,
        Insertable<
          InviteCodeRow,
          | 'created_by'
          | 'note'
          | 'max_uses'
          | 'uses'
          | 'expires_at'
          | 'revoked_at'
          | 'created_at'
        >
      >;
      invite_requests: Table<
        InviteRequestRow,
        Insertable<
          InviteRequestRow,
          'id' | 'note' | 'created_at' | 'invited_code'
        >
      >;
      settings: Table<
        SettingRow,
        Insertable<SettingRow, 'value' | 'updated_at'>
      >;
      resume_photos: Table<
        ResumePhotoRow,
        Insertable<ResumePhotoRow, 'updated_at'>
      >;
      ingest_keys: Table<
        IngestKeyRow,
        Insertable<
          IngestKeyRow,
          'id' | 'label' | 'last_used_at' | 'revoked_at' | 'created_at'
        >
      >;
      search_profiles: Table<
        SearchProfileRow,
        Insertable<
          SearchProfileRow,
          | 'id'
          | 'name'
          | 'target_roles'
          | 'stacks'
          | 'remote_rules'
          | 'exclusions'
          | 'languages'
          | 'min_seniority'
          | 'scoring_weights'
          | 'employment_types'
          | 'digest_time'
          | 'digest_days'
          | 'digest_min_score'
          | 'digest_enabled'
          | 'active'
          | 'home_country'
          | 'allowed_countries'
          | 'remote_only'
          | 'last_matched_at'
          | 'alert_min_score'
          | 'created_at'
          | 'updated_at'
        >
      >;
      roles: Table<
        RoleRow,
        Insertable<
          RoleRow,
          | 'id'
          | 'source'
          | 'location'
          | 'remote_scope'
          | 'type'
          | 'salary'
          | 'posted_at'
          | 'found_at'
          | 'stack'
          | 'score'
          | 'score_breakdown'
          | 'reasons'
          | 'gaps'
          | 'ai_match'
          | 'status'
          | 'cover_letter'
          | 'notes'
          | 'posting_text'
          | 'posting_hash'
          | 'status_changed_at'
          | 'follow_up_days'
          | 'prep'
          | 'posting_id'
          | 'source_id'
          | 'remote_policy'
          | 'hiring_countries'
          | 'company_research'
          | 'created_at'
          | 'updated_at'
        >
      >;
      role_events: Table<
        RoleEventRow,
        Insertable<RoleEventRow, 'id' | 'role_id' | 'payload' | 'created_at'>
      >;
      app_errors: Table<AppErrorRow, Partial<AppErrorRow>>;
      // Read-only for users; the service role and admin functions write them.
      plans: Table<PlanRow, Partial<PlanRow>>;
      subscriptions: Table<SubscriptionRow, Partial<SubscriptionRow>>;
      payments: Table<PaymentRow, Partial<PaymentRow>>;
      credit_ledger: Table<CreditLedgerRow, Partial<CreditLedgerRow>>;
      contacts: Table<
        ContactRow,
        Insertable<
          ContactRow,
          | 'id'
          | 'company'
          | 'title'
          | 'relation'
          | 'email'
          | 'linkedin_url'
          | 'notes'
          | 'next_touch_on'
          | 'last_touch_at'
          | 'created_at'
          | 'updated_at'
        >
      >;
      role_contacts: Table<
        RoleContactRow,
        Insertable<RoleContactRow, 'created_at'>
      >;
      contact_touches: Table<
        ContactTouchRow,
        Insertable<
          ContactTouchRow,
          | 'id'
          | 'role_id'
          | 'at'
          | 'channel'
          | 'direction'
          | 'note'
          | 'created_at'
        >
      >;
      interviews: Table<
        InterviewRow,
        Insertable<
          InterviewRow,
          | 'id'
          | 'kind'
          | 'title'
          | 'scheduled_at'
          | 'duration_min'
          | 'location'
          | 'interviewers'
          | 'status'
          | 'outcome'
          | 'notes'
          | 'debrief'
          | 'thank_you'
          | 'thank_you_sent_at'
          | 'created_at'
          | 'updated_at'
        >
      >;
      screening_answers: Table<
        ScreeningAnswerRow,
        Insertable<
          ScreeningAnswerRow,
          'id' | 'answer' | 'position' | 'created_at'
        >
      >;
      excluded_roles: Table<
        ExcludedRoleRow,
        Insertable<
          ExcludedRoleRow,
          'id' | 'company' | 'title' | 'url' | 'found_at'
        >
      >;
      resumes: Table<
        ResumeRow,
        Insertable<
          ResumeRow,
          'id' | 'name' | 'is_master' | 'sections' | 'created_at' | 'updated_at'
        >
      >;
      resume_variants: Table<
        ResumeVariantRow,
        Insertable<
          ResumeVariantRow,
          | 'id'
          | 'base_resume_id'
          | 'sections'
          | 'diff'
          | 'keyword_report'
          | 'pdf_path'
          | 'status'
          | 'created_at'
          | 'updated_at'
        >
      >;
      cover_letters: Table<
        CoverLetterRow,
        Insertable<
          CoverLetterRow,
          | 'id'
          | 'role_id'
          | 'body'
          | 'word_count'
          | 'status'
          | 'voice_sample'
          | 'created_at'
          | 'updated_at'
        >
      >;
      saved_views: Table<
        SavedViewRow,
        Insertable<SavedViewRow, 'id' | 'filters' | 'sort' | 'created_at'>
      >;
      shares: Table<
        ShareRow,
        Insertable<
          ShareRow,
          'id' | 'token' | 'role_id' | 'created_at' | 'revoked_at' | 'views'
        >
      >;
      source_catalog: Table<
        SourceCatalogRow,
        Insertable<
          SourceCatalogRow,
          | 'homepage'
          | 'country'
          | 'enabled'
          | 'max_requests_per_run'
          | 'attribution'
          | 'notes'
          | 'last_run_at'
          | 'last_success_at'
          | 'last_error'
          | 'last_fetched'
          | 'last_new'
          | 'created_at'
          | 'updated_at'
        >
      >;
      source_runs: Table<SourceRunRow, Partial<SourceRunRow>>;
      postings: Table<PostingRow, Partial<PostingRow>>;
      posting_sources: Table<PostingSourceRow, Partial<PostingSourceRow>>;
      companies: Table<CompanyRow, Partial<CompanyRow>>;
      company_follows: Table<CompanyFollowRow, Partial<CompanyFollowRow>>;
      // Read-only for users; set-ai-connection writes them.
      ai_connections: Table<AiConnectionRow, Partial<AiConnectionRow>>;
      ai_usage: Table<
        AiUsageRow,
        Insertable<
          AiUsageRow,
          | 'id'
          | 'provider'
          | 'tokens_in'
          | 'tokens_out'
          | 'cost_usd'
          | 'created_at'
        >
      >;
    };
    Views: Record<string, never>;
    Functions: {
      is_admin: { Args: Record<string, never>; Returns: boolean };
      invite_code_is_valid: { Args: { p_code: string }; Returns: boolean };
      admin_create_invite: {
        Args: {
          p_note?: string;
          p_max_uses?: number;
          p_expires_at?: string | null;
        };
        Returns: string;
      };
      vault_upsert_secret: {
        Args: { p_name: string; p_secret: string };
        Returns: undefined;
      };
      vault_delete_secret: { Args: { p_name: string }; Returns: undefined };
      request_invite: {
        Args: { p_email: string; p_note?: string };
        Returns: undefined;
      };
      admin_revoke_invite: { Args: { p_code: string }; Returns: undefined };
      admin_overview: { Args: Record<string, never>; Returns: Json };
      signup_is_open: { Args: Record<string, never>; Returns: boolean };
      shared_view: { Args: { p_token: string }; Returns: Json };
      market_signals: { Args: Record<string, never>; Returns: Json };
      report_error: { Args: { p: Json }; Returns: undefined };
      entitlements: { Args: Record<string, never>; Returns: Json };
      ai_route_info: { Args: Record<string, never>; Returns: Json };
      admin_pro_ai: { Args: Record<string, never>; Returns: Json };
      admin_set_pro_ai: { Args: { p_patch: Json }; Returns: Json };
      entitlements_for: { Args: { p_user: string }; Returns: Json };
      credit_balance: { Args: { p_user: string }; Returns: number };
      admin_plans: { Args: Record<string, never>; Returns: Json };
      admin_set_plan: {
        Args: {
          p_user: string;
          p_plan: string;
          p_reason: string;
          p_until?: string | null;
        };
        Returns: Json;
      };
      admin_add_credits: {
        Args: { p_user: string; p_amount: number; p_reason: string };
        Returns: number;
      };
      admin_set_billing: { Args: { p_enabled: boolean }; Returns: undefined };
      admin_set_billing_preview: {
        Args: { p_user: string; p_on: boolean };
        Returns: undefined;
      };
      posting_health: {
        Args: Record<string, never>;
        Returns: PoolPostingFacts[];
      };
      follow_company: {
        Args: { p_kind: string; p_slug: string; p_name?: string };
        Returns: string;
      };
      admin_set_open_signup: { Args: { p_open: boolean }; Returns: undefined };
      create_ingest_key: { Args: { p_label?: string }; Returns: string };
      resolve_ingest_key: { Args: { p_key: string }; Returns: string | null };
      keep_alive: { Args: Record<string, never>; Returns: undefined };
      flag_stale_shortlist: { Args: Record<string, never>; Returns: undefined };
      flag_follow_ups: { Args: Record<string, never>; Returns: undefined };
    };
    Enums: {
      role_status: RoleStatus;
      employment_type: EmploymentType;
      role_event_kind: RoleEventKind;
      ai_job: AiJob;
      variant_status: VariantStatus;
      remote_policy: RemotePolicy;
      source_kind: SourceKind;
      source_access: SourceAccess;
    };
    CompositeTypes: Record<string, never>;
  };
};
