import type { Signal } from '@angular/core';
import type {
  AdminMoney,
  AdminUserDetail,
  AdminUserFilters,
  AdminUserRow,
  AiConnectionView,
  AiRouteInfo,
  ProAiAdmin,
  CompanyResearch,
  Entitlements,
  Feature,
  MarketSignals,
  ModelChoice,
  PrepSheet,
  ProviderId,
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
  PoolPostingFacts,
  InterviewRow,
  AppErrorRow,
  ContactRow,
  RoleContactRow,
  ContactTouchRow,
  MessageKind,
  TouchChannel,
  TouchDirection,
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
  /** What the shared pool knows about each role's posting, by role id. */
  abstract readonly postingFacts: Signal<Record<string, PoolPostingFacts>>;

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

/** What the interview form sends; the role is required on create. */
export type InterviewInput = Partial<
  Omit<InterviewRow, 'id' | 'user_id' | 'created_at' | 'updated_at'>
>;

export abstract class InterviewsRepo {
  /** Every interview round of the signed-in user, soonest first. */
  abstract readonly interviews: Signal<InterviewRow[]>;
  abstract readonly loaded: Signal<boolean>;
  abstract load(): Promise<void>;
  /**
   * Creates (id null, role_id required) or updates a round. Scheduling a
   * round moves a role still before Interview to Interview.
   */
  abstract save(
    id: string | null,
    input: InterviewInput,
  ): Promise<InterviewRow>;
  abstract remove(id: string): Promise<void>;
  /**
   * Drafts the thank-you note from the round's debrief and the voice samples
   * (model with a key, local template otherwise) and stores it on the round.
   */
  abstract draftThankYou(id: string, model?: string): Promise<LetterResult>;
}

export type ContactInput = Partial<
  Omit<
    ContactRow,
    'id' | 'user_id' | 'created_at' | 'updated_at' | 'last_touch_at'
  >
>;

export interface TouchInput {
  contact_id: string;
  role_id?: string | null;
  channel: TouchChannel;
  direction: TouchDirection;
  note?: string;
  at?: string;
}

export interface MessageRequest {
  contactId: string;
  kind: MessageKind;
  roleId?: string | null;
  /** The recruiter's message being answered. */
  incoming?: string;
  /** What the user wants said, in their words. */
  ask?: string;
  model?: string;
}

export abstract class PeopleRepo {
  /** Every person of the signed-in user, by name. */
  abstract readonly contacts: Signal<ContactRow[]>;
  /** Every person-to-role link. */
  abstract readonly links: Signal<RoleContactRow[]>;
  abstract readonly loaded: Signal<boolean>;
  abstract load(): Promise<void>;
  /** Creates (id null; name required) or updates a person. */
  abstract save(id: string | null, input: ContactInput): Promise<ContactRow>;
  abstract remove(id: string): Promise<void>;
  abstract link(roleId: string, contactId: string): Promise<void>;
  abstract unlink(roleId: string, contactId: string): Promise<void>;
  /** The person's touches, newest first. */
  abstract touches(contactId: string): Promise<ContactTouchRow[]>;
  /**
   * Logs a message, call or reply and sets (or clears, with null) the date to
   * get back to them; undefined leaves it as it is.
   */
  abstract logTouch(
    input: TouchInput,
    nextTouchOn?: string | null,
  ): Promise<void>;
  /** Drafts a message to the person (model with a key, a template otherwise). Not stored. */
  abstract draftMessage(req: MessageRequest): Promise<LetterResult>;
}

/** One role read from a spreadsheet (see shared/csv.ts previewImport). */
export interface ImportRoleInput {
  company: string;
  title: string;
  url: string;
  status: RoleStatus;
  location: string;
  salary: string;
  notes: string;
}

export abstract class AccountDataRepo {
  /** Every row the user owns, by table, for a JSON download. */
  abstract exportAll(): Promise<Record<string, unknown[]>>;
  /** Adds roles from a spreadsheet; ones already tracked are counted, not changed. */
  abstract importRoles(
    roles: ImportRoleInput[],
  ): Promise<{ added: number; duplicates: number; failed: number }>;
  /** Deletes the account and everything in it, then signs out. */
  abstract deleteAccount(): Promise<void>;
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
  /** Provider ids of the user's AI connections, in their order. */
  ai_providers?: string[];
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

/** One account's plan as an admin sees it. */
export interface AdminPlan extends Entitlements {
  id: string;
  /** The reason given with the last grant or removal. */
  note: string;
  /** Billing gates are on for this account while off for everyone else. */
  preview: boolean;
}

/**
 * Thrown when the server refuses a call the plan does not cover (HTTP 402
 * from an Edge Function). Carries the feature so the caller can say what to
 * upgrade for.
 */
export class UpgradeRequiredError extends Error {
  constructor(
    message: string,
    readonly feature: Feature,
  ) {
    super(message);
    this.name = 'UpgradeRequiredError';
  }
}

/** What the signed-in account may use (plan, features, credits). */
export abstract class PlanRepo {
  /** Open (everything on) until the server has answered. */
  abstract readonly entitlements: Signal<Entitlements>;
  /** AI on credits for this account; "no route" until the server says otherwise. */
  abstract readonly route: Signal<AiRouteInfo>;
  abstract readonly loaded: Signal<boolean>;
  abstract load(): Promise<void>;
}

/** What an admin may change about the Pro route. */
export interface ProAiPatch {
  enabled?: boolean;
  monthly_budget_usd?: number;
  daily_credit_cap?: number;
}

export abstract class AdminRepo {
  abstract overview(): Promise<{ users: AdminUser[]; totals: AdminTotals }>;
  /** The Pro route (AI on credits): its switch, limits and this month's spend. */
  abstract proAi(): Promise<ProAiAdmin>;
  abstract setProAi(patch: ProAiPatch): Promise<ProAiAdmin>;
  /** Every account's plan and credits, and whether billing is switched on. */
  abstract plans(): Promise<{ enabled: boolean; users: AdminPlan[] }>;
  /** Puts an account on a plan by hand; `until` null means no end date. */
  abstract setPlan(
    userId: string,
    plan: 'free' | 'pro',
    reason: string,
    until?: string | null,
  ): Promise<void>;
  /** Adds credits (negative takes them back); resolves with the new balance. */
  abstract addCredits(
    userId: string,
    amount: number,
    reason: string,
  ): Promise<number>;
  /** Turns the billing gates on or off for one account. */
  abstract setBillingPreview(userId: string, on: boolean): Promise<void>;
  /** The users table: search, filters, one page. Every call is audited. */
  abstract users(
    filters: AdminUserFilters,
  ): Promise<{ total: number; users: AdminUserRow[] }>;
  /** Every account that matches, for the CSV. */
  abstract exportUsers(filters: AdminUserFilters): Promise<AdminUserRow[]>;
  /** One account: profile, billing, AI usage, activity. Null when unknown. */
  abstract user(id: string): Promise<AdminUserDetail | null>;
  abstract money(): Promise<AdminMoney>;
  /** Blocks sign-in, AI calls and scheduled matching for the account. */
  abstract suspend(userId: string, reason: string): Promise<void>;
  abstract unsuspend(userId: string): Promise<void>;
  /** Emails the account a sign-in link. */
  abstract sendLoginLink(userId: string): Promise<void>;
  /** Deletes the account for good; `confirmEmail` must be its email. */
  abstract deleteUser(userId: string, confirmEmail: string): Promise<void>;
  /** Error reports from the last `days`, newest first (admins only). */
  abstract errors(days: number): Promise<AppErrorRow[]>;
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

/** A key being connected in Settings. */
export interface NewAiConnection {
  provider: ProviderId;
  key: string;
  /** '' or missing: the provider's default model. */
  model?: string;
  /** The user ticked the provider's data terms (needed where the catalog says so). */
  consent?: boolean;
}

/** One job of a connection's full check. */
export interface AiCheckResult {
  job: string;
  label: string;
  ok: boolean;
  /** What was wrong; '' when it passed. */
  detail: string;
  model: string;
  ms: number;
  /** Stopped by the provider's rate limit: says nothing about the model. */
  limited?: boolean;
}

export interface AiCheck {
  /** "4 of 4 passed". */
  summary: string;
  results: AiCheckResult[];
}

export abstract class SettingsRepo {
  abstract readonly profile: Signal<ProfileRow | null>;
  /** The user's AI connections in the order they are tried (never the keys). */
  abstract readonly connections: Signal<AiConnectionView[]>;
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
    /** 'own': never spend credits on AI work. */
    ai_route?: 'auto' | 'own';
    /** Until when an admin may see the roles and resume; null closes it. */
    support_access_until?: string | null;
  }): Promise<void>;
  /**
   * Checks the key with its provider and stores it server-side (Vault).
   * Resolves with a note for the user ('' when there is nothing to add).
   */
  abstract saveConnection(input: NewAiConnection): Promise<string>;
  /** Runs the provider check again; resolves with how it went. */
  abstract testConnection(id: string): Promise<string>;
  /**
   * The full check: scoring, reading a posting, tailoring and a letter, once
   * each on the connection (real calls on the user's key).
   */
  abstract checkConnection(id: string): Promise<AiCheck>;
  /** Changes the connection's model ('' = the provider's default) once it answers. */
  abstract setConnectionModel(id: string, model: string): Promise<string>;
  /** The order connections are tried in: every id, first one first. */
  abstract reorderConnections(ids: string[]): Promise<void>;
  /** Deletes the stored key and the connection. */
  abstract removeConnection(id: string): Promise<void>;
  abstract revokeIngestKey(id: string): Promise<void>;
}
