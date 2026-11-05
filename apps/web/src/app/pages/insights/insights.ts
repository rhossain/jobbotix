import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  computeInsights,
  type MarketSignals,
  type RoleEventRow,
} from '@jobbotix/shared-types';
import { MarketRepo, RolesRepo } from '../../core/data/repos';
import { StatusLabelPipe } from '../../shared/format';
import {
  BarRow,
  Button,
  EmptyState,
  Icon,
  PageHeader,
  Skeleton,
  Stat,
} from '../../ui';

const WEEKS = 8;

/** Applications per week, response rate, time in each status, score bands. */
@Component({
  selector: 'jb-insights',
  imports: [
    BarRow,
    Button,
    EmptyState,
    Icon,
    PageHeader,
    RouterLink,
    Skeleton,
    Stat,
    StatusLabelPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <jb-page-header
      title="Insights"
      [lead]="
        'The last ' +
        weeks +
        ' weeks of your search, from the roles and status changes in the tracker.'
      "
    />

    <div class="mt-8 flex flex-col gap-6 md:gap-8">
      @if (!repo.loaded()) {
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <jb-skeleton shape="tile" [count]="1" />
          <jb-skeleton shape="tile" [count]="1" />
          <jb-skeleton shape="tile" [count]="1" />
          <jb-skeleton shape="tile" [count]="1" />
        </div>
        <jb-skeleton shape="line" [count]="6" />
      } @else if (repo.roles().length === 0) {
        <jb-empty-state title="Nothing to measure yet" icon="chart-column">
          Once roles land and you move them through the board, this page shows
          how many you apply to each week, how often you hear back, and where
          time goes.
          <div actions>
            <a jbButton="primary" routerLink="/roles/new"
              ><jb-icon name="plus" /> Add a role</a
            >
          </div>
        </jb-empty-state>
      } @else {
        @let i = insights();
        <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <jb-stat
            label="Applied"
            [value]="i.applied"
            [sub]="appliedThisWeek() + ' this week'"
            tone="brand"
          />
          <jb-stat
            label="Response rate"
            [value]="
              i.responseRate === null
                ? '–'
                : (i.responseRate * 100).toFixed(0) + '%'
            "
            [sub]="
              i.responded +
              ' of ' +
              i.applied +
              ' heard back' +
              (i.medianDaysToResponse !== null
                ? ', median ' + i.medianDaysToResponse + ' days'
                : '')
            "
          />
          <jb-stat
            label="Interviewing"
            [value]="i.interviews"
            [sub]="i.offers + ' offer' + (i.offers === 1 ? '' : 's')"
            tone="signal"
          />
          <jb-stat
            label="In the tracker"
            [value]="repo.roles().length"
            [sub]="foundThisWeek() + ' found this week'"
          />
        </div>

        <!-- Per week -->
        <section class="jb-card p-5 md:p-6">
          <div class="flex flex-wrap items-end justify-between gap-3">
            <h2 class="text-lg font-semibold text-ink">Per week</h2>
            <p class="flex gap-4 text-xs text-ink-muted">
              <span class="inline-flex items-center gap-1.5"
                ><span class="size-2.5 rounded-sm bg-line-strong"></span>Found
                by runs</span
              >
              <span class="inline-flex items-center gap-1.5"
                ><span class="size-2.5 rounded-sm bg-brand"></span>Applied</span
              >
            </p>
          </div>
          <div
            class="mt-6 flex h-48 items-stretch gap-1 sm:gap-2"
            role="img"
            [attr.aria-label]="weeksLabel()"
          >
            @for (w of i.weeks; track w.weekStart) {
              <div class="flex min-w-0 flex-1 flex-col">
                <div
                  class="flex flex-1 items-end justify-center gap-0.5 sm:gap-1"
                >
                  <span
                    class="jb-bar bg-line-strong"
                    [style.height.%]="pct(w.found, maxBar())"
                  ></span>
                  <span
                    class="jb-bar relative bg-brand"
                    [style.height.%]="pct(w.applied, maxBar())"
                  >
                    @if (w.applied) {
                      <span
                        class="absolute -top-5 left-1/2 -translate-x-1/2 text-xs font-semibold text-ink"
                        >{{ w.applied }}</span
                      >
                    }
                  </span>
                </div>
                <span
                  class="mt-2 truncate border-t border-line pt-2 text-center text-[0.6875rem] text-ink-muted sm:text-xs"
                >
                  {{ weekLabel(w.weekStart) }}
                </span>
              </div>
            }
          </div>
        </section>

        <div class="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8">
          <section class="jb-card p-5 md:p-6">
            <h2 class="text-lg font-semibold text-ink">Where roles are</h2>
            <div class="mt-4 flex flex-col gap-3">
              @for (f of i.funnel; track f.status) {
                <jb-bar-row
                  [label]="$any(f.status | statusLabel)"
                  [value]="f.count"
                  [max]="maxFunnel()"
                />
              }
            </div>
          </section>

          <section class="jb-card p-5 md:p-6">
            <h2 class="text-lg font-semibold text-ink">Score distribution</h2>
            <div class="mt-4 flex flex-col gap-3">
              @for (b of i.scores; track b.label) {
                <jb-bar-row
                  [label]="b.label"
                  [value]="b.count"
                  [max]="maxScore()"
                  [tone]="
                    b.min >= 85
                      ? 'good'
                      : b.min >= 70
                        ? 'brand'
                        : b.min >= 50
                          ? 'signal'
                          : 'muted'
                  "
                />
              }
            </div>
            <p class="mt-4 text-xs text-ink-muted">
              If most roles sit under 70, tighten the search profile; if most
              sit at 85 and up, the weights are too generous to be useful.
            </p>
          </section>
        </div>

        @if (market(); as m) {
          <section class="jb-card p-5 md:p-6">
            <h2 class="text-lg font-semibold text-ink">
              Across Jobbotix, last 30 days
            </h2>
            @if (!m.enough) {
              <p class="mt-2 text-sm text-ink-muted">
                Shown once at least two people's runs have landed, so nothing
                here can point at one person. For now this is your own
                {{ m.roles }} roles: {{ m.ai_share }}% mention AI-assisted work,
                {{ m.contract_share }}% are contracts, median score
                {{ m.median_score }}.
              </p>
            } @else {
              <p class="mt-1 text-sm text-ink-muted">
                {{ m.roles }} postings found by {{ m.users }} people; counts
                only, nobody's rows. {{ m.ai_share }}% mention AI-assisted work,
                {{ m.contract_share }}% are contracts, median score
                {{ m.median_score }}.
              </p>
              <div class="mt-5 grid gap-8 md:grid-cols-2">
                <div>
                  <h3 class="text-sm font-semibold text-ink">
                    Most-asked stacks
                  </h3>
                  <div class="mt-3 flex flex-col gap-3">
                    @for (st of m.stacks; track st.name) {
                      <jb-bar-row
                        [label]="st.name"
                        [value]="st.count"
                        [max]="m.stacks[0].count"
                      />
                    }
                  </div>
                </div>
                <div>
                  <h3 class="text-sm font-semibold text-ink">Remote scope</h3>
                  <div class="mt-3 flex flex-col gap-3">
                    @for (r of m.remote; track r.scope) {
                      <jb-bar-row
                        [label]="r.scope"
                        [value]="r.count"
                        [max]="m.remote[0].count"
                        tone="signal"
                      />
                    }
                  </div>
                </div>
              </div>
            }
          </section>
        }

        <section class="jb-card p-5 md:p-6">
          <h2 class="text-lg font-semibold text-ink">Time in each status</h2>
          @if (i.dwell.length === 0) {
            <p class="mt-2 text-sm text-ink-muted">
              No status changes recorded yet. Move a role on the board and this
              fills in.
            </p>
          } @else {
            <table class="mt-4 w-full text-sm">
              <thead>
                <tr
                  class="border-b border-line text-left text-xs text-ink-muted"
                >
                  <th class="py-2 pr-4 font-medium">Status</th>
                  <th class="py-2 pr-4 text-right font-medium">
                    Mean days before moving on
                  </th>
                  <th class="py-2 text-right font-medium">Roles</th>
                </tr>
              </thead>
              <tbody>
                @for (d of i.dwell; track d.status) {
                  <tr class="border-b border-line last:border-b-0">
                    <td class="py-2.5 pr-4 text-ink">
                      {{ d.status | statusLabel }}
                    </td>
                    <td class="py-2.5 pr-4 text-right text-ink tabular-nums">
                      {{ d.meanDays }}
                    </td>
                    <td class="py-2.5 text-right text-ink-muted tabular-nums">
                      {{ d.samples }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
            @if (shortlistDwell(); as sd) {
              @if (sd > 3) {
                <p
                  class="mt-4 flex items-start gap-2 rounded-control bg-warn-tint px-3 py-2.5 text-sm text-warn"
                >
                  <jb-icon name="clock" [size]="17" class="mt-px" />
                  Shortlisted roles wait {{ sd }} days on average before you
                  act. Postings close; aim for under three.
                </p>
              }
            }
          }
        </section>
      }
    </div>
  `,
  styles: `
    .jb-bar {
      display: block;
      flex: 1;
      max-width: 1.75rem;
      min-height: 2px;
      border-radius: 4px 4px 0 0;
      transition: height var(--dur-slow) var(--motion-ease);
    }
  `,
})
export class InsightsPage {
  protected readonly repo = inject(RolesRepo);
  readonly weeks = WEEKS;
  private readonly marketRepo = inject(MarketRepo);
  readonly events = signal<RoleEventRow[]>([]);
  readonly market = signal<MarketSignals | null>(null);
  readonly insights = computed(() =>
    computeInsights(this.repo.roles(), this.events(), { weeks: WEEKS }),
  );
  readonly appliedThisWeek = computed(
    () => this.insights().weeks[WEEKS - 1]?.applied ?? 0,
  );
  readonly foundThisWeek = computed(
    () => this.insights().weeks[WEEKS - 1]?.found ?? 0,
  );
  readonly maxFunnel = computed(() =>
    Math.max(1, ...this.insights().funnel.map((f) => f.count)),
  );
  readonly maxScore = computed(() =>
    Math.max(1, ...this.insights().scores.map((s) => s.count)),
  );
  readonly shortlistDwell = computed(
    () =>
      this.insights().dwell.find((d) => d.status === 'shortlist')?.meanDays ??
      0,
  );
  readonly weeksLabel = computed(() =>
    this.insights()
      .weeks.map(
        (w) => `week of ${w.weekStart}: ${w.applied} applied, ${w.found} found`,
      )
      .join('; '),
  );

  readonly maxBar = computed(() =>
    Math.max(1, ...this.insights().weeks.flatMap((w) => [w.applied, w.found])),
  );

  constructor() {
    void this.repo.load();
    void this.repo
      .statusEvents(WEEKS * 7 + 60)
      .then((evs) => this.events.set(evs));
    void this.marketRepo
      .signals()
      .then((m) => this.market.set(m))
      .catch(() => this.market.set(null));
  }

  pct(n: number, max: number): number {
    return Math.round((100 * n) / max);
  }
  weekLabel(iso: string): string {
    const d = new Date(iso + 'T00:00:00Z');
    return `${d.getUTCDate()} ${d.toLocaleString('en', { month: 'short', timeZone: 'UTC' })}`;
  }
}
