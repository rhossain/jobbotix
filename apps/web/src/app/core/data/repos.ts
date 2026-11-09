import type { Signal } from '@angular/core';
import type {
  CompanyResearch,
  MarketSignals,
  ModelChoice,
  PrepSheet,
  SharedView,
  VariantDiff,
} from '@jobbotix/shared-types';
import type { ResumeAiResult } from '@jobbotix/shared-types/resume-import';
import type {
  AiUsageRow,
  CoverLetterRow,
  InviteRequestRow,
  ShareRow,
  IngestKeyRow,
  ProfileRow,
  Json,
  RoleEventRow,
  RoleRow,
  ResumeRow,
  ResumeSections,
  ResumeVariantRow,
  RoleStatus,
  PostingSeenOn,
  RunSummary,
  SavedViewRow,
  ScreeningAnswerRow,
  SearchProfileRow,
  SourceCatalogRow,
  AtsKind,
  CompanyRow,
} from '@jobbotix/shared-types';

/**
 * The app talks to data only through these two classes. Two implementations
 * exist: MemoryRepos (demo mode, no backend) and SupabaseRepos (real project).
 * Pages never import either directly; app.config picks one.
 */
export abstract class RolesRepo {
  /** Every role of the signed-in user, newest found first. */
  abstract readonly roles: Signal<RoleRow[]>;
  abstract readonly loaded: Signal<boolean>;
  abstract readonly lastRun: Signal<RunSummary | null>;
  /** Reminder events (stale shortlist etc.) not yet dismissed. */
  abstract readonly reminders: Signal<RoleEventRow[]>;

  abstract load(): Promise<void>;
  abstract setStatus(id: string, status: RoleStatus): Promise<void>;
  abstract setNotes(id: string, notes: string): Promise<void>;
  abstract setCoverLetter(id: string, body: string): Promise<void>;
  abstract eventsFor(roleId: string): Promise<RoleEventRow[]>;
  /** All status_change events in the last `days`, oldest first. */
  abstract statusEvents(days: number): Promise<RoleEventRow[]>;
  abstract screeningAnswersFor(roleId: string): Promise<ScreeningAnswerRow[]>;
  /** Every board the role's posting was seen on, first seen first. */
  abstract seenOn(role: RoleRow): Promise<PostingSeenOn[]>;
  abstract dismissReminder(eventId: string): Promise<void>;
  /**
   * Adds a role by posting URL. `text` is the pasted posting when the page
   * cannot be fetched. Resolves with the new (or existing) role id.
   */
  abstract addFromUrl(
    url: string,
    text?: string,
  ): Promise<{ id: string; existed: boolean }>;
  /**
   * Scores (or re-scores) the role against the current search profile, as the
   * scheduled run would. `aiError` says why the model step was skipped.
   */
  abstract rescore(
    id: string,
  ): Promise<{ score: number; method: 'heuristic' | 'ai'; aiError?: string }>;
  /**
   * Researches the employer (web search on the user's key, the posting and
   * company site otherwise) and stores it on the role. `reused` when another
   * role at the same company had recent research.
   */
  abstract researchCompany(
    id: string,
    opts?: { model?: string; refresh?: boolean },
  ): Promise<{ research: CompanyResearch; reused: boolean }>;
}

export type SearchProfileInput = Omit<
  SearchProfileRow,
  'id' | 'user_id' | 'created_at' | 'updated_at' | 'active' | 'last_matched_at'
>;

export abstract class SearchProfileRepo {
  abstract readonly profile: Signal<SearchProfileRow | null>;
  abstract readonly loaded: Signal<boolean>;
  abstract load(): Promise<void>;
  abstract save(input: SearchProfileInput): Promise<void>;
  /** Returns the plain ingest key once; the app stores only its hash. */
  abstract createIngestKey(label: string): Promise<string>;
}

export abstract class SavedViewsRepo {
  abstract readonly views: Signal<SavedViewRow[]>;
  abstract load(): Promise<void>;
  /** Creates or replaces the view with this name. */
  abstract save(name: string, filters: Json, sort: string): Promise<void>;
  abstract remove(id: string): Promise<void>;
}

export abstract class ResumesRepo {
  /** All versions, newest first. The master is the one with is_master. */
  abstract readonly resumes: Signal<ResumeRow[]>;
  abstract readonly master: Signal<ResumeRow | null>;
  abstract readonly loaded: Signal<boolean>;
  abstract load(): Promise<void>;
  /** Saves a new version and makes it the master. Returns the new row id. */
  abstract saveMaster(sections: ResumeSections, name?: string): Promise<string>;
  /** Makes an older version the master again (no copy). */
  abstract restore(id: string): Promise<void>;
  abstract remove(id: string): Promise<void>;
  /**
   * Reads resume text with the user's own model key, for layouts the
   * built-in reader gets wrong. Nothing is saved. Demo mode answers with
   * the built-in reader.
   */
  abstract readWithAi(
    text: string,
    model?: string,
  ): Promise<ResumeAiResult & { model?: string }>;
}

export abstract class VariantsRepo {
  /** The tailored variant for one role, or null. */
  abstract variantFor(roleId: string): Promise<ResumeVariantRow | null>;
  /**
   * Proposes changes for the role from the current master (model when the
   * user has a key, local heuristics in demo) and stores them as a draft.
   * Existing decisions on unchanged proposals are kept.
   */
  abstract generate(
    roleId: string,
    model?: string,
  ): Promise<ResumeVariantRow & { method?: 'ai' | 'local'; model?: string }>;
  /** Persists decisions and the resulting sections. */
  abstract saveDiff(
    variantId: string,
    diff: VariantDiff,
    sections: ResumeSections,
  ): Promise<ResumeVariantRow>;
  abstract approve(variantId: string): Promise<ResumeVariantRow>;
}

export interface LetterResult {
  body: string;
  method: 'ai' | 'local';
  model?: string;
}

export abstract class LettersRepo {
  /** Letters the user wrote themselves, used to steer tone (max 3). */
  abstract readonly voiceSamples: Signal<CoverLetterRow[]>;
  abstract load(): Promise<void>;
  abstract addVoiceSample(body: string): Promise<void>;
  abstract removeVoiceSample(id: string): Promise<void>;
  /**
   * Drafts the role's letter from the master resume and the voice samples
   * (model with a key, local template otherwise) and stores it on the role.
   * `rewrite` asks for an improved version of the current letter instead.
   */
  abstract generate(
    roleId: string,
    opts?: { model?: string; rewrite?: boolean },
  ): Promise<LetterResult>;
}

export abstract class ScreeningRepo {
  abstract addQuestion(roleId: string, question: string): Promise<void>;
  abstract updateAnswer(id: string, answer: string): Promise<void>;
  abstract remove(id: string): Promise<void>;
  /**
   * Fills the listed answers (or every empty one) from the master resume:
   * model with a key, local templates otherwise.
   */
  abstract answer(
    roleId: string,
    opts?: { ids?: string[]; model?: string },
  ): Promise<{ answered: number; method: 'ai' | 'local'; model?: string }>;
}

export abstract class PrepRepo {
  /** Builds the sheet (model with a key, local otherwise) and stores it on the role. */
  abstract generate(roleId: string, model?: string): Promise<PrepSheet>;
  /** Saves the user's edits (notes, practised ticks) without regenerating. */
  abstract save(roleId: string, prep: PrepSheet): Promise<void>;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  is_admin: boolean;
  created_at: string;
  timezone: string;
  has_ai_key: boolean;
  roles: number;
  applied: number;
  last_run: string | null;
  runs_30d: number;
  ai_calls_30d: number;
  ingest_keys: number;
}

export interface AdminTotals {
  users: number;
  roles: number;
  events: number;
  runs_30d: number;
  ai_calls_30d: number;
  db_bytes: number;
  open_requests: number;
  open_codes: number;
}

export abstract class AdminRepo {
  abstract overview(): Promise<{ users: AdminUser[]; totals: AdminTotals }>;
  abstract requests(): Promise<InviteRequestRow[]>;
  /** Creates an invite code for a request and links it; returns the code. */
  abstract inviteRequest(id: string): Promise<string>;
  abstract signupOpen(): Promise<boolean>;
  abstract setSignupOpen(open: boolean): Promise<void>;
}

export abstract class SharesRepo {
  abstract readonly shares: Signal<ShareRow[]>;
  abstract load(): Promise<void>;
  /** Creates (or returns the existing live) link; returns the token. */
  abstract create(kind: 'role' | 'board', roleId?: string): Promise<string>;
  abstract revoke(id: string): Promise<void>;
  /** Public read by token; null when unknown or revoked. */
  abstract view(token: string): Promise<SharedView | null>;
}

export abstract class MarketRepo {
  abstract signals(): Promise<MarketSignals>;
}

/** A company the user follows, with what the last poll found. */
export interface FollowedCompany {
  company: CompanyRow;
  followedAt: string;
}

/** Companies whose own careers pages Jobbotix checks every hour for the user. */
export abstract class WatchlistRepo {
  abstract followed(): Promise<FollowedCompany[]>;
  abstract follow(kind: AtsKind, slug: string, name: string): Promise<void>;
  abstract unfollow(companyId: string): Promise<void>;
  /** The careers system behind a role, from its pooled posting or its link. */
  abstract companyFor(
    role: RoleRow,
  ): Promise<{ kind: AtsKind; slug: string; name: string } | null>;
}

/** The boards and feeds Jobbotix reads, with their health. */
export abstract class SourcesRepo {
  abstract list(): Promise<SourceCatalogRow[]>;
}

export type { ModelChoice };

export abstract class SettingsRepo {
  abstract readonly profile: Signal<ProfileRow | null>;
  abstract readonly models: Signal<ModelChoice[]>;
  abstract readonly usage: Signal<AiUsageRow[]>;
  abstract readonly ingestKeys: Signal<IngestKeyRow[]>;
  abstract load(): Promise<void>;
  /**
   * The user's AI calls from the last `days` days (all time when null),
   * newest first, for the Usage page.
   */
  abstract loadUsage(days: number | null): Promise<AiUsageRow[]>;
  abstract updateProfile(patch: {
    name?: string;
    timezone?: string;
    default_model?: string;
  }): Promise<void>;
  /** Stores the key server-side (Vault). Resolves with the last 4 characters for display. */
  abstract setAnthropicKey(key: string): Promise<string>;
  abstract clearAnthropicKey(): Promise<void>;
  abstract revokeIngestKey(id: string): Promise<void>;
}
