import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  Button,
  CopyButton,
  EmptyState,
  Icon,
  PageHeader,
  PullRefresh,
  Skeleton,
  SwipeRow,
  type SwipeAction,
} from '../../ui';
import {
  CONTACT_RELATION_LABELS,
  addDays,
  daysBetweenDays,
  dueContacts,
  isoDay,
  type ContactRow,
  formatInterviewTime,
  interviewLabel,
  needsDebrief,
  upcomingInterviews,
  type InterviewRow,
  type RoleEventRow,
  type RoleRow,
  type RoleStatus,
} from '@jobbotix/shared-types';
import { Auth } from '../../core/auth';
import { InterviewsRepo, PeopleRepo, RolesRepo } from '../../core/data/repos';
import { Toast } from '../../shared/toast';
import {
  clockTime,
  dayMonth,
  daysSince,
  longDate,
  relativeDay,
} from '../../shared/format';
import { RoleCard } from '../../shared/role-card';
import { SetupChecklist } from './setup-checklist';
import { RoleMover } from '../../shared/role-mover';
import { copyText } from '../../ui/copy-button';

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
    PullRefresh,
    RoleCard,
    SetupChecklist,
    RouterLink,
    Skeleton,
    SwipeRow,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <jb-pull-refresh [action]="refresh" />
    <jb-page-header [title]="greeting()" data-tour="today-summary">
      <p eyebrow class="mb-1.5 text-sm font-medium text-brand-ink">
        {{ dateLine }}
      </p>
      <p lead class="mt-2 max-w-[var(--reading-max)] text-ink-muted md:text-lg">
        @if (run(); as r) {
          {{ runPhrase() }} reviewed {{ r.searched }} listings and added
          <b class="font-semibold text-ink">{{ r.added }}</b>
          worth a look; {{ r.excluded }} were excluded.
        } @else {
          Nothing has been searched yet. Jobbotix checks job boards several
          times a day; new roles appear here within the hour.
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
      <jb-setup-checklist class="empty:hidden" />
      @if (interviews().length) {
        <section aria-labelledby="interviews-heading">
          <h2
            id="interviews-heading"
            class="flex items-center gap-2 text-lg font-semibold text-ink"
          >
            Interviews
            <span class="jb-count">{{ interviews().length }}</span>
          </h2>
          <ul class="mt-3 flex flex-col gap-2.5">
            @for (x of interviews(); track x.iv.id) {
              <li
                class="jb-card flex flex-col gap-3 p-4 md:flex-row md:items-center md:gap-5 md:px-5"
              >
                <div
                  class="flex min-w-0 flex-1 items-start gap-3 md:items-center md:gap-4"
                >
                  <span
                    class="grid size-10 shrink-0 place-items-center rounded-full"
                    [class.bg-brand-tint]="x.kind === 'upcoming'"
                    [class.text-brand-ink]="x.kind === 'upcoming'"
                    [class.bg-signal-tint]="x.kind === 'debrief'"
                    [class.text-signal-ink]="x.kind === 'debrief'"
                    aria-hidden="true"
                  >
                    <jb-icon
                      [name]="x.kind === 'upcoming' ? 'calendar' : 'pencil'"
                      [size]="19"
                    />
                  </span>
                  <p class="min-w-0 flex-1 text-sm text-ink-muted">
                    <a
                      [routerLink]="['/roles', x.role.id]"
                      [queryParams]="{ tab: 'interviews' }"
                      class="font-semibold text-ink no-underline hover:underline"
                      >{{ label(x.iv) }}</a
                    >
                    with {{ x.role.company }}
                    @if (x.kind === 'upcoming') {
                      <span class="font-medium text-ink">
                        · {{ when(x.iv.scheduled_at) }}</span
                      >
                      @if (x.iv.interviewers) {
                        · {{ x.iv.interviewers }}
                      }
                    } @else {
                      ended {{ ago(x.iv.scheduled_at) }}. Write down what they
                      asked while it is fresh, then send a thank-you note.
                    }
                  </p>
                </div>
                <div class="flex gap-2 md:shrink-0">
                  @if (x.kind === 'upcoming' && isLink(x.iv.location)) {
                    <a
                      jbButton
                      class="flex-1 md:flex-none"
                      [href]="x.iv.location"
                      target="_blank"
                      rel="noopener"
                      >Join link</a
                    >
                  }
                  <a
                    jbButton="primary"
                    class="flex-1 md:flex-none"
                    [routerLink]="['/roles', x.role.id]"
                    [queryParams]="{
                      tab: x.kind === 'upcoming' ? 'prep' : 'interviews',
                    }"
                    >{{ x.kind === 'upcoming' ? 'Prepare' : 'Debrief' }}</a
                  >
                </div>
              </li>
            }
          </ul>
        </section>
      }

      @if (people().length) {
        <section aria-labelledby="people-heading">
          <h2
            id="people-heading"
            class="flex items-center gap-2 text-lg font-semibold text-ink"
          >
            Get back to
            <span class="jb-count">{{ people().length }}</span>
          </h2>
          <ul class="mt-3 flex flex-col gap-2.5">
            @for (c of people(); track c.id) {
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
                    <jb-icon name="users" [size]="19" />
                  </span>
                  <p class="min-w-0 flex-1 text-sm text-ink-muted">
                    <a
                      [routerLink]="['/people', c.id]"
                      class="font-semibold text-ink no-underline hover:underline"
                      >{{ c.name }}</a
                    >
                    · {{ relationLabels[c.relation]
                    }}{{ c.company ? ' at ' + c.company : '' }}:
                    {{ overdue(c) }}
                  </p>
                </div>
                <div class="flex gap-2 md:shrink-0">
                  <a
                    jbButton="primary"
                    class="flex-1 md:flex-none"
                    [routerLink]="['/people', c.id]"
                    [queryParams]="{ draft: 1 }"
                    >Message</a
                  >
                  <button
                    type="button"
                    jbButton
                    class="flex-1 md:flex-none"
                    (click)="snooze(c)"
                  >
                    In a week
                  </button>
                </div>
              </li>
            }
          </ul>
        </section>
      }

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
              <li>
                <jb-swipe-row
                  [start]="r.kind === 'follow_up' ? copyAction : openAction"
                  [end]="dismissAction"
                  (startAction)="swipeStart(r)"
                  (endAction)="dismiss(r.event.id)"
                >
                  <div
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
                  </div>
                </jb-swipe-row>
              </li>
            }
          </ul>
        </section>
      }

      <section aria-labelledby="new-heading" data-tour="today-new">
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
                <jb-swipe-row
                  [start]="shortlistAction"
                  [end]="skipAction"
                  (startAction)="move(role, 'shortlist')"
                  (endAction)="move(role, 'skipped')"
                >
                  <jb-role-card [role]="role" />
                </jb-swipe-row>
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
          <!-- Below the fold on phones: built when it scrolls into view. -->
          @defer (on viewport; prefetch on idle) {
            <div class="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
              @for (role of inFlight(); track role.id) {
                <jb-role-card
                  [role]="role"
                  [showReasons]="false"
                  [compact]="true"
                />
              }
            </div>
          } @placeholder {
            <div class="mt-3 h-32 rounded-card bg-sunken/60"></div>
          }
        </section>
      }
    </div>
  `,
})
export class Today {
  protected readonly repo = inject(RolesRepo);
  private readonly interviewsRepo = inject(InterviewsRepo);
  private readonly peopleRepo = inject(PeopleRepo);
  readonly relationLabels = CONTACT_RELATION_LABELS;
  private readonly today = isoDay(new Date());
  /** People whose get-back-to date is today or earlier. */
  readonly people = computed(() =>
    dueContacts(this.peopleRepo.contacts(), this.today),
  );
  private readonly auth = inject(Auth);
  readonly label = interviewLabel;
  private readonly toast = inject(Toast);
  private readonly router = inject(Router);
  private readonly mover = inject(RoleMover);

  // Touch shortcuts; the buttons on each row do the same.
  readonly copyAction: SwipeAction = {
    label: 'Copy follow-up',
    icon: 'copy',
    tone: 'brand',
  };
  readonly openAction: SwipeAction = {
    label: 'Open',
    icon: 'arrow-up-right',
    tone: 'brand',
  };
  readonly dismissAction: SwipeAction = {
    label: 'Dismiss',
    icon: 'x',
    tone: 'muted',
  };
  readonly shortlistAction: SwipeAction = {
    label: 'To apply',
    icon: 'bookmark',
    tone: 'brand',
  };
  readonly skipAction: SwipeAction = {
    label: 'Skip',
    icon: 'x',
    tone: 'muted',
  };

  readonly refresh = () => this.repo.load();

  async swipeStart(r: Reminder) {
    if (r.kind !== 'follow_up') {
      await this.router.navigate(['/roles', r.role.id]);
      return;
    }
    if (await copyText(this.followUp(r)))
      this.toast.success('Follow-up copied');
    else this.toast.error('Could not reach the clipboard; use the Copy button');
  }

  move(role: RoleRow, to: RoleStatus) {
    return this.mover.move(role, to);
  }

  readonly run = this.repo.lastRun;
  readonly dateLine = longDate(new Date());
  readonly greeting = computed(() => {
    const h = new Date().getHours();
    const part = h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
    const first = (this.auth.profile()?.name ?? '').split(/\s+/)[0];
    return first ? `Good ${part}, ${first}` : `Good ${part}`;
  });
  /** "In the last 24 hours, 6 runs", "Today's 06:45 run", "The run 3 days ago". */
  readonly runPhrase = computed(() => {
    const r = this.run();
    const at = r?.at;
    if (!at) return '';
    if (r.runs > 1) return `In the last 24 hours, ${r.runs} runs`;
    const rel = relativeDay(at);
    const time = clockTime(new Date(at));
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

  /** Rounds in the next week, then ended rounds with no debrief yet. */
  readonly interviews = computed(() => {
    const byId = new Map(this.repo.roles().map((r) => [r.id, r]));
    const now = new Date();
    const all = this.interviewsRepo.interviews();
    const pick = (list: InterviewRow[], kind: 'upcoming' | 'debrief') =>
      list
        .map((iv) => ({ iv, kind, role: byId.get(iv.role_id) }))
        .filter(
          (x): x is { iv: InterviewRow; kind: typeof kind; role: RoleRow } =>
            !!x.role,
        );
    return [
      ...pick(upcomingInterviews(all, now, 7), 'upcoming'),
      ...pick(needsDebrief(all, now), 'debrief'),
    ];
  });

  overdue(c: ContactRow) {
    const d = daysBetweenDays(c.next_touch_on ?? this.today, this.today);
    return d <= 0 ? 'due today' : `${d} ${d === 1 ? 'day' : 'days'} overdue`;
  }

  async snooze(c: ContactRow) {
    try {
      await this.peopleRepo.save(c.id, {
        next_touch_on: addDays(this.today, 7),
      });
      this.toast.show(`${c.name}: in a week`);
    } catch {
      this.toast.error('Could not move the reminder');
    }
  }

  when(iso: string | null) {
    return iso ? formatInterviewTime(iso) : '';
  }

  ago(iso: string | null) {
    return iso ? relativeDay(iso) : '';
  }

  isLink(s: string) {
    return /^https?:\/\//i.test(s.trim());
  }

  constructor() {
    void this.repo.load();
    if (!this.interviewsRepo.loaded())
      void this.interviewsRepo.load().catch(() => undefined);
    if (!this.peopleRepo.loaded())
      void this.peopleRepo.load().catch(() => undefined);
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
    const applied = dayMonth(new Date(r.role.status_changed_at));
    return (
      `Hi,\n\nI applied for the ${r.role.title} role at ${r.role.company} on ${applied} and wanted to check in: is the position still open, and is there anything you need from me to move forward?\n\n` +
      `Happy to do a short call or a take-home whenever suits your team.\n\nThanks,\n${this.auth.profile()?.name || ''}`
    ).trim();
  }
}
