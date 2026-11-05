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
export type EmploymentType = 'full_time' | 'contract';
export type RoleEventKind =
  'status_change' | 'note' | 'generated' | 'reminder' | 'run' | 'ingested';
export type AiJob = 'extract' | 'score' | 'tailor' | 'letter';
export type VariantStatus = 'draft' | 'approved';

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
  active: boolean;
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
};

export type CoverLetterRow = Timestamps & {
  id: string;
  user_id: string;
  role_id: string;
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

export type AiUsageRow = {
  id: string;
  user_id: string;
  job: AiJob;
  model: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
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
          | 'active'
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
          | 'created_at'
          | 'updated_at'
        >
      >;
      role_events: Table<
        RoleEventRow,
        Insertable<RoleEventRow, 'id' | 'role_id' | 'payload' | 'created_at'>
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
      ai_usage: Table<
        AiUsageRow,
        Insertable<
          AiUsageRow,
          'id' | 'tokens_in' | 'tokens_out' | 'cost_usd' | 'created_at'
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
      request_invite: {
        Args: { p_email: string; p_note?: string };
        Returns: undefined;
      };
      admin_revoke_invite: { Args: { p_code: string }; Returns: undefined };
      create_ingest_key: { Args: { p_label?: string }; Returns: string };
      resolve_ingest_key: { Args: { p_key: string }; Returns: string | null };
      keep_alive: { Args: Record<string, never>; Returns: undefined };
      flag_stale_shortlist: { Args: Record<string, never>; Returns: undefined };
    };
    Enums: {
      role_status: RoleStatus;
      employment_type: EmploymentType;
      role_event_kind: RoleEventKind;
      ai_job: AiJob;
      variant_status: VariantStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};
