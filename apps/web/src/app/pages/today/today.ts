import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
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
import {
  InterviewsRepo,
  PeopleRepo,
  RolesRepo,
  SearchProfileRepo,
} from '../../core/data/repos';
import { SearchRunner } from '../../core/search-runner';
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
      <p
        lead
        class="mt-2 max-w-[var(--reading-max)] text-ink-muted md:text-lg"
        aria-live="polite"
      >
        @if (search.running()) {
          Jobbotix is checking the last 30 days of job posts against your job
          preferences. This can take a minute or two.
          @if (search.searched() > 0) {
            <span class="mt-1 block text-base">
              {{ search.searched() }} job posts checked so far,
              <b class="font-semibold text-ink">{{ search.added() }}</b>
              {{ search.added() === 1 ? 'job' : 'jobs' }} found.
            </span>
          }
        } @else if (run(); as r) {
          @if (r.added > 0) {
            Jobbotix found
            <b class="font-semibold text-ink">{{ r.added }}</b>
            new {{ r.added === 1 ? 'job' : 'jobs' }} for you {{ runWhen() }}.
          } @else {
            No new jobs for you {{ runWhen() }}. Jobbotix keeps looking.
          }
          <button
            type="button"
            class="cursor-pointer border-0 bg-transparent p-0 text-base text-brand-ink underline"
            aria-controls="today-search-details"
            [attr.aria-expanded]="detailsOpen()"
            (click)="detailsOpen.set(!detailsOpen())"
          >
            {{ detailsOpen() ? 'Hide details' : 'See details' }}
          </button>
          @if (detailsOpen()) {
            <span id="today-search-details" class="mt-2 block text-base">
              {{ runPhrase() }} looked at {{ r.searched }} job posts and added
              {{ r.added }};
              <a class="text-brand-ink underline" routerLink="/passed-over"
                >{{ r.excluded }} were filtered out</a
              >{{ passedOver() }}.
              @if (r.aiCheck; as c) {
                AI took a second look at {{ c.looked }}
                {{ c.looked === 1 ? 'job title' : 'job titles' }} it was unsure
                about: {{ c.turnedDown }}
                {{ c.turnedDown === 1 ? 'was' : 'were' }} not your kind of job,
                {{ c.confirmed }} {{ c.confirmed === 1 ? 'was' : 'were' }}, and
                {{ c.broughtIn }} of those
                {{ c.broughtIn === 1 ? 'was' : 'were' }} added.
              }
            </span>
          }
          @if (r.aiTrouble; as t) {
            <span class="mt-1 block text-sm text-warn">
              AI could not help in {{ t.runs }}
              {{ t.runs === 1 ? 'search' : 'searches' }}, so your preferences
              decided alone{{ t.reason ? ': ' + t.reason : '' }}.
            </span>
          }
        } @else if (!profiles.loaded() || hasSearch()) {
          No searches yet. Jobbotix checks new job posts every hour; your first
          jobs appear within the hour.
        } @else {
          No searches yet. Tell Jobbotix what job you want in
          <a class="text-brand-ink underline" routerLink="/search"
            >Job preferences</a
          >
          and it starts looking right away. No AI setup is needed for that.
        }
      </p>
      <div actions class="hidden gap-2 md:flex">
        <a jbButton routerLink="/jobs/new"><jb-icon name="plus" /> Add a job</a>
        <a jbButton="primary" routerLink="/jobs"> Open all jobs </a>
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
                      [routerLink]="['/jobs', x.role.id]"
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
                    [routerLink]="['/jobs', x.role.id]"
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
                          [routerLink]="['/jobs', r.role.id]"
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
                          [routerLink]="['/jobs', r.role.id]"
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
            New jobs
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
            @if (search.running()) {
              <jb-empty-state title="Looking for your jobs" icon="search">
                Jobbotix is checking job posts against your job preferences
                right now. Jobs appear here as they are found, best match first.
              </jb-empty-state>
            } @else if (!hasSearch()) {
              <jb-empty-state title="No jobs yet" icon="inbox">
                Jobbotix finds jobs for you once you say what you are looking
                for: the job titles and skills you want.
                <div actions>
                  <a jbButton="primary" routerLink="/search"
                    >Set job preferences</a
                  >
                  <a jbButton="ghost" routerLink="/jobs/new"
                    ><jb-icon name="plus" /> Add a job</a
                  >
                </div>
              </jb-empty-state>
            } @else if (run() && repo.roles().length === 0) {
              <!-- The search ran and nothing matched: say so, and what to do. -->
              <jb-empty-state title="No matching jobs yet" icon="inbox">
                Jobbotix checked {{ run()?.searched }} job posts and none
                matched your job preferences. It keeps checking new job posts
                every hour. To get more, add other names for your job in Job
                preferences ("Preview what this finds" shows what each change
                brings in), or see what was filtered out and why.
                <div actions>
                  <a jbButton="primary" routerLink="/search"
                    >Open Job preferences</a
                  >
                  <a jbButton routerLink="/passed-over"
                    >See what was left out</a
                  >
                </div>
              </jb-empty-state>
            } @else {
              <jb-empty-state
                [title]="
                  run() ? 'Nothing new since the last search' : 'No jobs yet'
                "
                icon="inbox"
              >
                Jobbotix checks new job posts every hour and adds your matches
                here, best match first. Jobs you have already sorted are under
                Jobs and Applications.
                <div actions>
                  <a jbButton routerLink="/board"
                    ><jb-icon name="square-kanban" /> Open Applications</a
                  >
                  <a jbButton="ghost" routerLink="/jobs/new"
                    ><jb-icon name="plus" /> Add a job</a
                  >
                </div>
              </jb-empty-state>
            }
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
  protected readonly profiles = inject(SearchProfileRepo);
  /** The search started from the app: a new account's first one, or after a change. */
  protected readonly search = inject(SearchRunner);
  /** Some search of the account has a job title or a skill to look for. */
  readonly hasSearch = computed(() =>
    this.profiles
      .profiles()
      .some((p) => p.target_roles.length > 0 || p.stacks.length > 0),
  );
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
      await this.router.navigate(['/jobs', r.role.id]);
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
  /** Whether the line under the greeting shows the numbers behind it. */
  readonly detailsOpen = signal(false);
  /** "in the last 24 hours", "today", "yesterday", "3 days ago", "on 2 Nov". */
  readonly runWhen = computed(() => {
    const r = this.run();
    if (!r?.at) return '';
    if (r.runs > 1) return 'in the last 24 hours';
    const rel = relativeDay(r.at);
    return /^\d+ \w{3}/.test(rel) ? `on ${rel}` : rel;
  });
  /** "In the last 24 hours, 6 runs", "Today's 06:45 run", "The run 3 days ago". */
  readonly runPhrase = computed(() => {
    const r = this.run();
    const at = r?.at;
    if (!at) return '';
    if (r.runs > 1) return `In the last 24 hours, ${r.runs} searches`;
    const rel = relativeDay(at);
    const time = clockTime(new Date(at));
    if (rel === 'today') return `Today's ${time} search`;
    if (rel === 'yesterday') return `Yesterday's ${time} search`;
    return `The search ${rel}`;
  });

  /** ", 8 of them a close match that scored low. 440 were another kind of job" when the run reports it. */
  readonly passedOver = computed(() => {
    const r = this.run();
    if (!r) return '';
    const low = r.lowMatch
      ? `, ${r.lowMatch} of them the right job with a low score`
      : '';
    const other =
      r.notRelevant !== undefined
        ? `. ${r.notRelevant} were a different kind of job`
        : '';
    return `${low}${other}`;
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
    // A search that has not been run yet (a new account, or preferences just
    // changed) is run now, not on the hour.
    void this.search.ensure();
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
