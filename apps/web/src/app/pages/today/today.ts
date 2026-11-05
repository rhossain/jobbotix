import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { RoleEventRow, RoleRow } from '@jobbotix/shared-types';
import { RolesRepo } from '../../core/data/repos';
import { daysSince, relativeDay } from '../../shared/format';
import { RoleCard } from '../../shared/role-card';

interface Reminder {
  event: RoleEventRow;
  role: RoleRow;
  days: number;
}

/** Morning view: what the last run found, and what has gone quiet. */
@Component({
  selector: 'jb-today',
  imports: [RouterLink, RoleCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="flex flex-col gap-8">
      <header>
        <h1 class="text-2xl font-semibold tracking-tight">Today</h1>
        @if (run(); as r) {
          <p
            class="mt-1 font-mono text-sm text-neutral-600 dark:text-neutral-300"
          >
            Last run {{ runWhen() }} · {{ r.searched }} listings reviewed ·
            {{ r.added }} added · {{ r.excluded }} excluded
          </p>
        } @else {
          <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
            No search run has reported yet.
          </p>
        }
      </header>

      @if (reminders().length) {
        <section aria-labelledby="stale-heading">
          <h2 id="stale-heading" class="jb-section-title">Waiting on you</h2>
          <ul class="mt-2 flex flex-col gap-2">
            @for (r of reminders(); track r.event.id) {
              <li
                class="jb-card flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <span>
                  <a
                    [routerLink]="['/roles', r.role.id]"
                    class="font-medium hover:underline"
                    >{{ r.role.title }}</a
                  >
                  at {{ r.role.company }} has been in <b>To apply</b> for
                  {{ r.days }} days.
                </span>
                <span class="flex gap-2">
                  <a [routerLink]="['/roles', r.role.id]" class="jb-btn-primary"
                    >Apply now</a
                  >
                  <button
                    type="button"
                    class="jb-btn"
                    (click)="dismiss(r.event.id)"
                  >
                    Dismiss
                  </button>
                </span>
              </li>
            }
          </ul>
        </section>
      }

      <section aria-labelledby="new-heading">
        <h2 id="new-heading" class="jb-section-title">
          New roles
          <span class="font-normal text-neutral-500"
            >({{ fresh().length }})</span
          >
        </h2>
        @if (!repo.loaded()) {
          <p class="mt-2 text-sm text-neutral-500" role="status">Loading…</p>
        } @else if (fresh().length === 0) {
          <div class="jb-empty mt-2">
            <b>Nothing new since the last run.</b>
            The next run adds roles here, highest score first. Roles you have
            already triaged are under
            <a routerLink="/roles" class="underline">Roles</a> and
            <a routerLink="/board" class="underline">Board</a>.
          </div>
        } @else {
          <div class="mt-2 flex flex-col gap-2">
            @for (role of fresh(); track role.id) {
              <jb-role-card [role]="role" />
            }
          </div>
        }
      </section>

      @if (inFlight().length) {
        <section aria-labelledby="flight-heading">
          <h2 id="flight-heading" class="jb-section-title">In flight</h2>
          <div class="mt-2 flex flex-col gap-2">
            @for (role of inFlight(); track role.id) {
              <jb-role-card [role]="role" [showReasons]="false" />
            }
          </div>
        </section>
      }
    </section>
  `,
})
export class Today {
  protected readonly repo = inject(RolesRepo);

  readonly run = this.repo.lastRun;
  readonly runWhen = computed(() => relativeDay(this.run()?.at));

  readonly fresh = computed(() =>
    this.repo
      .roles()
      .filter((r) => r.status === 'new')
      .sort((a, b) => b.score - a.score),
  );

  readonly inFlight = computed(() =>
    this.repo
      .roles()
      .filter(
        (r) =>
          r.status === 'applied' ||
          r.status === 'interview' ||
          r.status === 'offer',
      )
      .sort((a, b) => b.status_changed_at.localeCompare(a.status_changed_at)),
  );

  readonly reminders = computed<Reminder[]>(() => {
    const byId = new Map(this.repo.roles().map((r) => [r.id, r]));
    return this.repo
      .reminders()
      .map((event) => ({
        event,
        role: event.role_id ? byId.get(event.role_id) : undefined,
      }))
      .filter(
        (x): x is { event: RoleEventRow; role: RoleRow } =>
          !!x.role && x.role.status === 'shortlist',
      )
      .map((x) => ({ ...x, days: daysSince(x.role.status_changed_at) }));
  });

  constructor() {
    void this.repo.load();
  }

  dismiss(id: string) {
    void this.repo.dismissReminder(id);
  }
}
