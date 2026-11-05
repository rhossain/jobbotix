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

const WEEKS = 8;

/** Applications per week, response rate, time in each status, score bands. */
@Component({
  selector: 'jb-insights',
  imports: [RouterLink, StatusLabelPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="flex flex-col gap-8">
      <header>
        <h1 class="text-2xl font-semibold tracking-tight">Insights</h1>
        <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
          The last {{ weeks }} weeks of your search, from the roles and status
          changes in the tracker.
        </p>
      </header>

      @if (repo.roles().length === 0) {
        <div class="jb-empty">
          <b>Nothing to measure yet.</b>
          Once roles land and you move them through the board, this page shows
          how many you apply to each week, how often you hear back, and where
          time goes. <a routerLink="/roles/new" class="underline">Add a role</a>
          to start.
        </div>
      } @else {
        @let i = insights();
        <!-- headline numbers -->
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div class="jb-card p-4">
            <div class="text-xs uppercase tracking-wide text-neutral-500">
              Applied
            </div>
            <div class="mt-1 text-3xl font-semibold tabular-nums">
              {{ i.applied }}
            </div>
            <div class="text-xs text-neutral-500">
              {{ appliedThisWeek() }} this week
            </div>
          </div>
          <div class="jb-card p-4">
            <div class="text-xs uppercase tracking-wide text-neutral-500">
              Response rate
            </div>
            <div class="mt-1 text-3xl font-semibold tabular-nums">
              {{
                i.responseRate === null
                  ? '–'
                  : (i.responseRate * 100).toFixed(0) + '%'
              }}
            </div>
            <div class="text-xs text-neutral-500">
              {{ i.responded }} of {{ i.applied }} heard back
              @if (i.medianDaysToResponse !== null) {
                · median {{ i.medianDaysToResponse }} days
              }
            </div>
          </div>
          <div class="jb-card p-4">
            <div class="text-xs uppercase tracking-wide text-neutral-500">
              Interviewing
            </div>
            <div class="mt-1 text-3xl font-semibold tabular-nums">
              {{ i.interviews }}
            </div>
            <div class="text-xs text-neutral-500">
              {{ i.offers }} offer{{ i.offers === 1 ? '' : 's' }}
            </div>
          </div>
          <div class="jb-card p-4">
            <div class="text-xs uppercase tracking-wide text-neutral-500">
              In the tracker
            </div>
            <div class="mt-1 text-3xl font-semibold tabular-nums">
              {{ repo.roles().length }}
            </div>
            <div class="text-xs text-neutral-500">
              {{ foundThisWeek() }} found this week
            </div>
          </div>
        </div>

        <!-- per week -->
        <section>
          <h2 class="jb-section-title">Per week</h2>
          <p class="mt-1 text-xs text-neutral-500">
            Dark bars: applications sent. Light bars: roles found by the runs.
          </p>
          <svg
            class="mt-3 h-40 w-full max-w-2xl"
            [attr.viewBox]="'0 0 ' + chartW + ' ' + chartH"
            role="img"
            [attr.aria-label]="weeksLabel()"
          >
            @for (w of i.weeks; track w.weekStart; let idx = $index) {
              @let x = idx * slot + 8;
              <rect
                [attr.x]="x"
                [attr.y]="barY(w.found)"
                [attr.width]="barW"
                [attr.height]="barH(w.found)"
                class="fill-neutral-300 dark:fill-neutral-700"
                rx="2"
              />
              <rect
                [attr.x]="x + barW + 3"
                [attr.y]="barY(w.applied)"
                [attr.width]="barW"
                [attr.height]="barH(w.applied)"
                class="fill-brand-600"
                rx="2"
              />
              @if (w.applied) {
                <text
                  [attr.x]="x + barW + 3 + barW / 2"
                  [attr.y]="barY(w.applied) - 3"
                  text-anchor="middle"
                  class="fill-neutral-700 text-[9px] dark:fill-neutral-200"
                >
                  {{ w.applied }}
                </text>
              }
              <text
                [attr.x]="x + barW + 1.5"
                [attr.y]="chartH - 4"
                text-anchor="middle"
                class="fill-neutral-500 text-[9px]"
              >
                {{ weekLabel(w.weekStart) }}
              </text>
            }
          </svg>
        </section>

        <div class="grid gap-8 md:grid-cols-2">
          <!-- funnel -->
          <section>
            <h2 class="jb-section-title">Where roles are</h2>
            <ul class="mt-2 space-y-1.5 text-sm">
              @for (f of i.funnel; track f.status) {
                <li class="grid grid-cols-[6rem_1fr_2rem] items-center gap-2">
                  <span class="text-neutral-600 dark:text-neutral-300">{{
                    f.status | statusLabel
                  }}</span>
                  <span
                    class="h-3 rounded bg-neutral-200 dark:bg-neutral-800"
                    aria-hidden="true"
                  >
                    <span
                      class="block h-3 rounded bg-brand-600"
                      [style.width.%]="pct(f.count, maxFunnel())"
                    ></span>
                  </span>
                  <span class="text-right tabular-nums">{{ f.count }}</span>
                </li>
              }
            </ul>
          </section>

          <!-- scores -->
          <section>
            <h2 class="jb-section-title">Score distribution</h2>
            <ul class="mt-2 space-y-1.5 text-sm">
              @for (b of i.scores; track b.label) {
                <li class="grid grid-cols-[6rem_1fr_2rem] items-center gap-2">
                  <span class="text-neutral-600 dark:text-neutral-300">{{
                    b.label
                  }}</span>
                  <span
                    class="h-3 rounded bg-neutral-200 dark:bg-neutral-800"
                    aria-hidden="true"
                  >
                    <span
                      class="block h-3 rounded"
                      [class.bg-emerald-600]="b.min >= 85"
                      [class.bg-brand-600]="b.min >= 70 && b.min < 85"
                      [class.bg-amber-500]="b.min >= 50 && b.min < 70"
                      [class.bg-neutral-400]="b.min < 50"
                      [style.width.%]="pct(b.count, maxScore())"
                    ></span>
                  </span>
                  <span class="text-right tabular-nums">{{ b.count }}</span>
                </li>
              }
            </ul>
            <p class="mt-2 text-xs text-neutral-500">
              If most roles sit under 70, tighten the search profile; if most
              sit at 85+, the weights are too generous to be useful.
            </p>
          </section>
        </div>

        <!-- market -->
        @if (market(); as m) {
          <section>
            <h2 class="jb-section-title">Across Jobbotix, last 30 days</h2>
            @if (!m.enough) {
              <p class="mt-2 text-sm text-neutral-500">
                Shown once at least two people's runs have landed, so nothing
                here can point at one person. For now this is your own
                {{ m.roles }} roles: {{ m.ai_share }}% mention AI-assisted work,
                {{ m.contract_share }}% are contracts, median score
                {{ m.median_score }}.
              </p>
            } @else {
              <p class="mt-1 text-xs text-neutral-500">
                {{ m.roles }} postings found by {{ m.users }} people; counts
                only, nobody's rows. {{ m.ai_share }}% mention AI-assisted work,
                {{ m.contract_share }}% are contracts, median score
                {{ m.median_score }}.
              </p>
              <div class="mt-3 grid gap-6 md:grid-cols-2">
                <div>
                  <h3
                    class="text-xs font-semibold uppercase tracking-wide text-neutral-500"
                  >
                    Most-asked stacks
                  </h3>
                  <ul class="mt-2 space-y-1.5 text-sm">
                    @for (st of m.stacks; track st.name) {
                      <li
                        class="grid grid-cols-[8rem_1fr_2rem] items-center gap-2"
                      >
                        <span class="truncate">{{ st.name }}</span>
                        <span
                          class="h-3 rounded bg-neutral-200 dark:bg-neutral-800"
                          aria-hidden="true"
                        >
                          <span
                            class="block h-3 rounded bg-brand-600"
                            [style.width.%]="pct(st.count, m.stacks[0].count)"
                          ></span>
                        </span>
                        <span class="text-right tabular-nums">{{
                          st.count
                        }}</span>
                      </li>
                    }
                  </ul>
                </div>
                <div>
                  <h3
                    class="text-xs font-semibold uppercase tracking-wide text-neutral-500"
                  >
                    Remote scope
                  </h3>
                  <ul class="mt-2 space-y-1.5 text-sm">
                    @for (r of m.remote; track r.scope) {
                      <li
                        class="grid grid-cols-[8rem_1fr_2rem] items-center gap-2"
                      >
                        <span class="truncate">{{ r.scope }}</span>
                        <span
                          class="h-3 rounded bg-neutral-200 dark:bg-neutral-800"
                          aria-hidden="true"
                        >
                          <span
                            class="block h-3 rounded bg-brand-600"
                            [style.width.%]="pct(r.count, m.remote[0].count)"
                          ></span>
                        </span>
                        <span class="text-right tabular-nums">{{
                          r.count
                        }}</span>
                      </li>
                    }
                  </ul>
                </div>
              </div>
            }
          </section>
        }

        <!-- dwell -->
        <section>
          <h2 class="jb-section-title">Time in each status</h2>
          @if (i.dwell.length === 0) {
            <p class="mt-2 text-sm text-neutral-500">
              No status changes recorded yet. Move a role on the board and this
              fills in.
            </p>
          } @else {
            <table class="mt-2 w-full max-w-md text-sm">
              <thead
                class="text-left text-xs uppercase tracking-wide text-neutral-500"
              >
                <tr>
                  <th class="py-1 pr-4">Status</th>
                  <th class="py-1 pr-4">Mean days before moving on</th>
                  <th class="py-1">Roles</th>
                </tr>
              </thead>
              <tbody>
                @for (d of i.dwell; track d.status) {
                  <tr
                    class="border-t border-neutral-200 dark:border-neutral-800"
                  >
                    <td class="py-1.5 pr-4">{{ d.status | statusLabel }}</td>
                    <td class="py-1.5 pr-4 tabular-nums">{{ d.meanDays }}</td>
                    <td class="py-1.5 tabular-nums">{{ d.samples }}</td>
                  </tr>
                }
              </tbody>
            </table>
            @if (shortlistDwell(); as sd) {
              @if (sd > 3) {
                <p class="mt-2 text-xs text-amber-700 dark:text-amber-300">
                  Shortlisted roles wait {{ sd }} days on average before you
                  act. Postings close; aim for under three.
                </p>
              }
            }
          }
        </section>
      }
    </section>
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

  // chart geometry (viewBox units)
  readonly chartW = 480;
  readonly chartH = 120;
  readonly slot = this.chartW / WEEKS;
  readonly barW = Math.floor((this.slot - 16) / 2);
  private readonly maxBar = computed(() =>
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

  barH(n: number): number {
    return Math.round(((this.chartH - 30) * n) / this.maxBar());
  }
  barY(n: number): number {
    return this.chartH - 18 - this.barH(n);
  }
  pct(n: number, max: number): number {
    return Math.round((100 * n) / max);
  }
  weekLabel(iso: string): string {
    const d = new Date(iso + 'T00:00:00Z');
    return `${d.getUTCDate()} ${d.toLocaleString('en', { month: 'short', timeZone: 'UTC' })}`;
  }
}
