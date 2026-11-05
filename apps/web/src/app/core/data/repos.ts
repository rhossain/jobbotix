import type { Signal } from '@angular/core';
import type {
  Json,
  RoleEventRow,
  RoleRow,
  ResumeRow,
  ResumeSections,
  RoleStatus,
  RunSummary,
  SavedViewRow,
  ScreeningAnswerRow,
  SearchProfileRow,
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
  abstract screeningAnswersFor(roleId: string): Promise<ScreeningAnswerRow[]>;
  abstract dismissReminder(eventId: string): Promise<void>;
  /**
   * Adds a role by posting URL. `text` is the pasted posting when the page
   * cannot be fetched. Resolves with the new (or existing) role id.
   */
  abstract addFromUrl(
    url: string,
    text?: string,
  ): Promise<{ id: string; existed: boolean }>;
}

export type SearchProfileInput = Omit<
  SearchProfileRow,
  'id' | 'user_id' | 'created_at' | 'updated_at' | 'active'
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
}
