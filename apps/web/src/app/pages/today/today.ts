import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  Button,
  CopyButton,
  EmptyState,
  Icon,
  PageHeader,
  Skeleton,
} from '../../ui';
import type { RoleEventRow, RoleRow } from '@jobbotix/shared-types';
import { Auth } from '../../core/auth';
import { RolesRepo } from '../../core/data/repos';
import { Toast } from '../../shared/toast';
import { daysSince, relativeDay } from '../../shared/format';
import { RoleCard } from '../../shared/role-card';

interface Reminder {
  event: RoleEventRow;
  role: RoleRow;
  days: number;
  kind: 'stale' | 'follow_up';
}

/** Morning view: what the last run found, and what has gone quiet. */
@Component({
  selector: 'jb-today',
  imports: [
    Button,
    CopyButton,
    EmptyState,
    Icon,
    PageHeader,
    RoleCard,
    RouterLink,
    Skeleton,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <jb-page-header [title]="greeting()">
      <p eyebrow class="mb-1.5 text-sm font-medium text-brand-ink">
        {{ dateLine }}
      </p>
      <p lead class="mt-2 max-w-[var(--reading-max)] text-ink-muted md:text-lg">
        @if (run(); as r) {
          {{ runPhrase() }} reviewed {{ r.searched }} listings and added
          <b class="font-semibold text-ink">{{ r.added }}</b>
          worth a look; {{ r.excluded }} were excluded.
        } @else {
          No search run has reported yet. Your scheduled task posts here after
          its first run.
        }
      </p>
      <div actions class="hidden gap-2 md:flex">
        <a jbButton routerLink="/roles/new"
          ><jb-icon name="plus" /> Add a role</a
        >
        <a jbButton="primary" routerLink="/roles"> Open all roles </a>
      </div>
    </jb-page-header>

    <div class="mt-8 flex flex-col gap-10 md:mt-12 md:gap-12">
      @if (reminders().length) {
        <section aria-labelledby="waiting-heading">
          <h2
            id="waiting-heading"
            class="flex items-center gap-2 text-lg font-semibold text-ink"
          >
            Waiting on you
            <span class="jb-count">{{ reminders().length }}</span>
          </h2>
          <ul class="mt-3 flex flex-col gap-2.5">
            @for (r of reminders(); track r.event.id) {
              <li
                class="jb-card flex flex-col gap-3 p-4 md:flex-row md:items-center md:gap-5 md:px-5"
              >
                <div
                  class="flex min-w-0 flex-1 items-start gap-3 md:items-center md:gap-4"
                >
                  <span
                    class="grid size-10 shrink-0 place-items-center rounded-full bg-signal-tint text-signal-ink"
                    aria-hidden="true"
                  >
                    <jb-icon
                      [name]="r.kind === 'follow_up' ? 'send' : 'clock'"
                      [size]="19"
                    />
                  </span>
                  <p class="min-w-0 flex-1 text-sm text-ink-muted">
                    <a
                      [routerLink]="['/roles', r.role.id]"
                      class="font-semibold text-ink no-underline hover:underline"
                      >{{ r.role.title }}</a
                    >
                    at {{ r.role.company }}
                    @if (r.kind === 'follow_up') {
                      : applied {{ r.days }} days ago with no reply. A short
                      follow-up now is normal; after 14 days, move on.
                    } @else {
                      has waited in To apply for {{ r.days }} days.
                    }
                  </p>
                </div>
                <div class="flex gap-2 md:shrink-0">
                  @if (r.kind === 'follow_up') {
                    <jb-copy-button
                      class="flex-1 md:flex-none"
                      variant="primary"
                      label="Copy follow-up"
                      confirm="Follow-up copied"
                      [text]="followUp(r)"
                    />
                  } @else {
                    <a
                      jbButton="primary"
                      class="flex-1 md:flex-none"
                      [routerLink]="['/roles', r.role.id]"
                      >Apply now</a
                    >
                  }
                  <button
                    type="button"
                    jbButton
                    class="flex-1 md:flex-none"
                    (click)="dismiss(r.event.id)"
                  >
                    Dismiss
                  </button>
                </div>
              </li>
            }
          </ul>
        </section>
      }

      <section aria-labelledby="new-heading">
        <div class="flex items-baseline justify-between gap-4">
          <h2
            id="new-heading"
            class="flex items-center gap-2 text-lg font-semibold text-ink"
          >
            New roles
            @if (repo.loaded()) {
              <span class="jb-count">{{ fresh().length }}</span>
            }
          </h2>
          @if (fresh().length) {
            <span class="text-sm text-ink-muted">Best match first</span>
          }
        </div>
        <div class="mt-3">
          @if (!repo.loaded()) {
            <jb-skeleton shape="card" [count]="3" />
          } @else if (fresh().length === 0) {
            <jb-empty-state title="Nothing new since the last run" icon="inbox">
              The next run adds roles here, highest score first. Roles you have
              already triaged are under Roles and Board.
              <div actions>
                <a jbButton routerLink="/board"
                  ><jb-icon name="square-kanban" /> Open the board</a
                >
                <a jbButton="ghost" routerLink="/roles/new"
                  ><jb-icon name="plus" /> Add a role</a
                >
              </div>
            </jb-empty-state>
          } @else {
            <div class="flex flex-col gap-3">
              @for (role of fresh(); track role.id) {
                <jb-role-card [role]="role" />
              }
            </div>
          }
        </div>
      </section>

      @if (inFlight().length) {
        <section aria-labelledby="flight-heading">
          <h2
            id="flight-heading"
            class="flex items-center gap-2 text-lg font-semibold text-ink"
          >
            In flight
            <span class="jb-count">{{ inFlight().length }}</span>
          </h2>
          <div class="mt-3 grid gap-3 lg:grid-cols-2">
            @for (role of inFlight(); track role.id) {
              <jb-role-card
                [role]="role"
                [showReasons]="false"
                [compact]="true"
              />
            }
          </div>
        </section>
      }
    </div>
  `,
})
export class Today {
  protected readonly repo = inject(RolesRepo);
  private readonly auth = inject(Auth);
  private readonly toast = inject(Toast);

  readonly run = this.repo.lastRun;
  readonly dateLine = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  readonly greeting = computed(() => {
    const h = new Date().getHours();
    const part = h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
    const first = (this.auth.profile()?.name ?? '').split(/\s+/)[0];
    return first ? `Good ${part}, ${first}` : `Good ${part}`;
  });
  /** "Today's 06:45 run", "Yesterday's 06:45 run", "The run 3 days ago". */
  readonly runPhrase = computed(() => {
    const at = this.run()?.at;
    if (!at) return '';
    const rel = relativeDay(at);
    const time = new Date(at).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
    if (rel === 'today') return `Today's ${time} run`;
    if (rel === 'yesterday') return `Yesterday's ${time} run`;
    return `The run ${rel}`;
  });

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
    return (
      this.repo
        .reminders()
        .map((event) => ({
          event,
          role: event.role_id ? byId.get(event.role_id) : undefined,
        }))
        .filter((x): x is { event: RoleEventRow; role: RoleRow } => !!x.role)
        .map((x) => {
          const reason = (x.event.payload as { reason?: string } | null)
            ?.reason;
          const kind: Reminder['kind'] =
            reason === 'follow_up' ? 'follow_up' : 'stale';
          return { ...x, kind, days: daysSince(x.role.status_changed_at) };
        })
        // a reminder only stands while the role is still where it was flagged
        .filter((r) =>
          r.kind === 'follow_up'
            ? r.role.status === 'applied'
            : r.role.status === 'shortlist',
        )
        .sort((a, b) => b.days - a.days)
    );
  });

  constructor() {
    void this.repo.load();
  }

  async dismiss(id: string) {
    try {
      await this.repo.dismissReminder(id);
      this.toast.show('Reminder dismissed');
    } catch {
      this.toast.error('Could not dismiss the reminder');
    }
  }

  /** A short, non-pushy follow-up the user can paste into email or LinkedIn. */
  followUp(r: Reminder): string {
    const applied = new Date(r.role.status_changed_at).toLocaleDateString(
      'en',
      { day: 'numeric', month: 'long' },
    );
    return (
      `Hi,\n\nI applied for the ${r.role.title} role at ${r.role.company} on ${applied} and wanted to check in: is the position still open, and is there anything you need from me to move forward?\n\n` +
      `Happy to do a short call or a take-home whenever suits your team.\n\nThanks,\n${this.auth.profile()?.name || ''}`
    ).trim();
  }
}
