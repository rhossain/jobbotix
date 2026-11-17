import { Injectable, computed, inject, signal } from '@angular/core';
import type { SearchProfileRow } from '@jobbotix/shared-types';
import { RolesRepo, SearchProfileRepo } from './data/repos';

/**
 * A search that has something to look for and has not been run since it was
 * made or last changed (saving a change clears `last_matched_at`).
 */
export function awaitsSearch(
  p: Pick<SearchProfileRow, 'target_roles' | 'stacks' | 'last_matched_at'>,
): boolean {
  return (
    p.last_matched_at === null &&
    (p.target_roles.length > 0 || p.stacks.length > 0)
  );
}

/** A search is read a stretch at a time; this many is more than any backlog needs. */
const MAX_STRETCHES = 30;
/** How long to wait when the hourly search is on the account already. */
const BUSY_WAIT_MS = 4000;

type State = 'idle' | 'running' | 'finished' | 'unavailable';

/**
 * Runs the account's searches now, instead of leaving them to the hourly
 * search: when job preferences are saved, and when a page finds a search
 * that has not been run yet. Without it a new account saved its preferences
 * and looked at an empty page until the hour came round.
 *
 * One run at a time for the whole app; pages read its progress to say what
 * is going on. If the server cannot do it (offline, or not updated yet) it
 * ends quietly as 'unavailable' and the hourly search does the work.
 */
@Injectable({ providedIn: 'root' })
export class SearchRunner {
  private readonly profiles = inject(SearchProfileRepo);
  private readonly roles = inject(RolesRepo);

  private readonly _state = signal<State>('idle');
  private readonly _searched = signal(0);
  private readonly _added = signal(0);
  /** Asked for while a run was going: run once more when it ends. */
  private again = false;
  /** Searches already run for in this visit, so a page does not ask twice. */
  private readonly asked = new Set<string>();

  readonly state = this._state.asReadonly();
  readonly running = computed(() => this._state() === 'running');
  /** Job posts read, and jobs added, by the run in progress or the last one. */
  readonly searched = this._searched.asReadonly();
  readonly added = this._added.asReadonly();

  /** Test seam: the pause between asks while the account is busy. */
  protected pause = (ms: number) =>
    new Promise<void>((done) => setTimeout(done, ms));

  /**
   * Starts a run if one of the account's searches is waiting for its first
   * (or, after a change, its next) one. Safe to call from every page: each
   * waiting search is run for once.
   */
  async ensure(): Promise<void> {
    if (this.running()) return;
    if (!this.profiles.loaded())
      await this.profiles.load().catch(() => undefined);
    const waiting = this.profiles
      .profiles()
      .filter(awaitsSearch)
      .filter((p) => !this.asked.has(key(p)));
    if (!waiting.length) return;
    for (const p of waiting) this.asked.add(key(p));
    await this.start();
  }

  /** Runs the searches now. Called while a run is going, it runs once more after it. */
  async start(): Promise<void> {
    if (this.running()) {
      this.again = true;
      return;
    }
    this._state.set('running');
    this._searched.set(0);
    this._added.set(0);
    let outcome: State = 'finished';
    try {
      do {
        this.again = false;
        for (let i = 0; i < MAX_STRETCHES; i++) {
          const r = await this.profiles.searchNow();
          this._searched.update((n) => n + r.searched);
          this._added.update((n) => n + r.added);
          // jobs show up as they are found, not all at the end
          if (r.added) await this.roles.load().catch(() => undefined);
          if (r.done) break;
          if (r.busy) await this.pause(BUSY_WAIT_MS);
        }
      } while (this.again);
    } catch {
      // What was found so far stands; the hourly search does the rest.
      outcome = this._searched() > 0 ? 'finished' : 'unavailable';
    }
    // The last run's summary and the searches' new watermarks, before any
    // page is told the run has ended.
    await Promise.all([
      this.roles.load().catch(() => undefined),
      this.profiles.load().catch(() => undefined),
    ]);
    for (const p of this.profiles.profiles()) this.asked.add(key(p));
    this._state.set(outcome);
  }
}

/** A search as it stands: saving a change makes it a new one to run for. */
function key(p: Pick<SearchProfileRow, 'id' | 'updated_at'>): string {
  return `${p.id}@${p.updated_at}`;
}
