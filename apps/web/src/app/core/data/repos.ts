import type { Signal } from '@angular/core';
import type {
  RoleEventRow,
  RoleRow,
  RoleStatus,
  RunSummary,
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
