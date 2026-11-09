import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  JOB_LABELS,
  PRICES_AS_OF,
  WEB_SEARCH_USD,
  estimateCost,
  formatTokens,
  formatUsd,
  summariseUsage,
  type AiUsageRow,
} from '@jobbotix/shared-types';
import { SettingsRepo } from '../../core/data/repos';
import { RelativeDayPipe, utcMonthShort } from '../../shared/format';
import {
  BarRow,
  Button,
  EmptyState,
  Icon,
  PageHeader,
  Skeleton,
  Stat,
  Tabs,
  type TabItem,
} from '../../ui';

type Period = '7' | '30' | '90' | 'all';

/** Calls Jobbotix made to Claude on the user's key, with an estimated cost. */
@Component({
  selector: 'jb-usage',
  imports: [
    BarRow,
    Button,
    EmptyState,
    Icon,
    PageHeader,
    RelativeDayPipe,
    RouterLink,
    Skeleton,
    Stat,
    Tabs,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <jb-page-header
      title="AI usage"
      lead="Every call Jobbotix made to Claude on your Anthropic key, with what it cost at list prices."
    />

    <div class="mt-6 flex flex-col gap-6 md:gap-8">
      <jb-tabs
        variant="segmented"
        prefix="usage-period"
        [controls]="false"
        label="Period"
        [tabs]="periods"
        [value]="period()"
        (valueChange)="period.set($any($event))"
      />

      @if (loading() && !rows().length) {
        <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <jb-skeleton shape="tile" [count]="1" />
          <jb-skeleton shape="tile" [count]="1" />
          <jb-skeleton shape="tile" [count]="1" />
          <jb-skeleton shape="tile" [count]="1" />
        </div>
        <jb-skeleton shape="line" [count]="6" />
      } @else if (error()) {
        <p class="text-sm text-bad" role="alert">{{ error() }}</p>
      } @else if (!summary().total.calls) {
        <jb-empty-state title="No AI calls in this period" icon="gauge">
          Scoring, letters, screening answers, interview prep and company
          research use Claude when your Anthropic key is in Settings. Each call
          shows up here with its tokens and cost.
          <div actions>
            <a jbButton routerLink="/settings"
              ><jb-icon name="settings" /> Settings</a
            >
          </div>
        </jb-empty-state>
      } @else {
        @let s = summary();
        <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <jb-stat
            label="Estimated cost"
            [value]="usd(s.total.cost)"
            [sub]="costSub()"
            tone="brand"
          />
          <jb-stat label="Calls" [value]="s.total.calls" [sub]="perDayLine()" />
          <jb-stat
            label="Tokens"
            [value]="tokens(s.total.tokensIn + s.total.tokensOut)"
            [sub]="
              tokens(s.total.tokensIn) +
              ' in, ' +
              tokens(s.total.tokensOut) +
              ' out'
            "
          />
          <jb-stat
            label="Web searches"
            [value]="s.total.webSearches"
            [sub]="usd(s.total.webSearches * webSearchUsd) + ' of the cost'"
            tone="signal"
          />
        </div>

        <!-- Over time -->
        <section class="jb-card p-5 md:p-6">
          <div class="flex flex-wrap items-end justify-between gap-3">
            <h2 class="text-lg font-semibold text-ink">
              Cost per {{ s.bucket }}
            </h2>
            <p class="text-xs text-ink-muted">Highest {{ usd(maxCost()) }}</p>
          </div>
          <div
            class="mt-6 flex h-44 items-stretch"
            [class.gap-px]="s.buckets.length > 20"
            [class.gap-1]="s.buckets.length <= 20"
            role="img"
            [attr.aria-label]="chartLabel()"
          >
            @for (b of s.buckets; track b.start; let i = $index) {
              <div class="flex min-w-0 flex-1 flex-col">
                <div class="flex flex-1 items-end justify-center">
                  <span
                    class="jb-bar w-full max-w-6 bg-brand"
                    [class.opacity-30]="!b.calls"
                    [style.height.%]="pct(b.cost, maxCost())"
                    [attr.title]="
                      bucketLabel(b.start) +
                      ': ' +
                      b.calls +
                      ' calls, ' +
                      usd(b.cost)
                    "
                  ></span>
                </div>
                <span
                  class="mt-2 flex h-6 justify-center overflow-visible border-t border-line pt-1.5 text-[0.6875rem] leading-4 whitespace-nowrap text-ink-muted"
                >
                  {{ showTick(i, s.buckets.length) ? tick(b.start) : '' }}
                </span>
              </div>
            }
          </div>
        </section>

        <div class="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8">
          <section class="jb-card p-5 md:p-6">
            <h2 class="text-lg font-semibold text-ink">By feature</h2>
            <div class="mt-4 flex flex-col gap-3">
              @for (j of s.byJob; track j.key) {
                <jb-bar-row
                  [label]="j.label"
                  [value]="j.cost"
                  [max]="s.byJob[0].cost || 1"
                  [display]="usd(j.cost) + ' · ' + j.calls"
                />
              }
            </div>
            <p class="mt-4 text-xs text-ink-muted">
              Cost, then number of calls.
            </p>
          </section>

          <section class="jb-card p-5 md:p-6">
            <h2 class="text-lg font-semibold text-ink">By model</h2>
            <div class="mt-4 flex flex-col gap-3">
              @for (m of s.byModel; track m.key) {
                <jb-bar-row
                  [label]="modelName(m.key)"
                  [value]="m.cost"
                  [max]="s.byModel[0].cost || 1"
                  [display]="
                    (m.unpriced === m.calls ? 'no price' : usd(m.cost)) +
                    ' · ' +
                    m.calls
                  "
                  [tone]="m.key.includes('haiku') ? 'good' : 'brand'"
                />
              }
            </div>
            @if (s.total.unpriced) {
              <p class="mt-4 text-xs text-ink-muted">
                {{ s.total.unpriced }} call{{
                  s.total.unpriced === 1 ? '' : 's'
                }}
                used a model without a known price, so the estimate leaves them
                out.
              </p>
            }
          </section>
        </div>

        <!-- Model detail -->
        <section class="jb-card p-5 md:p-6">
          <h2 class="text-lg font-semibold text-ink">Models in detail</h2>
          <div class="mt-4 overflow-x-auto">
            <table class="w-full text-sm whitespace-nowrap">
              <thead class="text-left text-xs text-ink-muted">
                <tr>
                  <th class="py-2 pr-4 font-medium">Model</th>
                  <th class="py-2 pr-4 text-right font-medium">Calls</th>
                  <th class="py-2 pr-4 text-right font-medium">Tokens in</th>
                  <th class="py-2 pr-4 text-right font-medium">Tokens out</th>
                  <th class="py-2 pr-4 text-right font-medium">Cost</th>
                  <th class="py-2 font-medium">Last used</th>
                </tr>
              </thead>
              <tbody>
                @for (m of s.byModel; track m.key) {
                  <tr class="border-t border-line">
                    <td class="py-2 pr-4 font-mono text-xs">{{ m.key }}</td>
                    <td class="py-2 pr-4 text-right tabular-nums">
                      {{ m.calls }}
                    </td>
                    <td class="py-2 pr-4 text-right tabular-nums">
                      {{ tokens(m.tokensIn) }}
                    </td>
                    <td class="py-2 pr-4 text-right tabular-nums">
                      {{ tokens(m.tokensOut) }}
                    </td>
                    <td class="py-2 pr-4 text-right tabular-nums">
                      {{ m.unpriced === m.calls ? '–' : usd(m.cost) }}
                    </td>
                    <td class="py-2 whitespace-nowrap">
                      {{ m.last | relativeDay }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>

        <!-- Recent calls -->
        <section class="jb-card p-5 md:p-6">
          <h2 class="text-lg font-semibold text-ink">Recent calls</h2>
          <ul class="mt-3 flex flex-col">
            @for (r of recent(); track r.id) {
              <li
                class="flex items-center justify-between gap-3 border-t border-line py-2.5 text-sm first:border-t-0"
              >
                <div class="min-w-0">
                  <p class="truncate font-medium text-ink">
                    {{ jobLabel(r) }}
                  </p>
                  <p class="truncate text-xs text-ink-muted">
                    {{ modelName(r.model) }} · {{ tokens(r.tokens_in) }} in,
                    {{ tokens(r.tokens_out) }} out{{
                      r.web_searches
                        ? ' · ' +
                          r.web_searches +
                          ' search' +
                          (r.web_searches === 1 ? '' : 'es')
                        : ''
                    }}
                  </p>
                </div>
                <div class="shrink-0 text-right">
                  <p class="tabular-nums text-ink">{{ callCost(r) }}</p>
                  <p class="text-xs text-ink-muted">
                    {{ r.created_at | relativeDay }}
                  </p>
                </div>
              </li>
            }
          </ul>
          @if (rows().length > recent().length) {
            <button
              type="button"
              jbButton="ghost"
              class="mt-2"
              (click)="shown.set(shown() + 25)"
            >
              Show more
            </button>
          }
        </section>

        <p class="text-xs text-ink-muted">
          Estimates use Anthropic's list prices as of {{ pricesAsOf }}, plus
          {{ usd(webSearchUsd) }} per web search, without caching or batch
          discounts. Your actual bill is in the
          <a
            href="https://platform.claude.com/settings/usage"
            target="_blank"
            rel="noopener"
            class="text-brand-ink underline"
            >Anthropic Console</a
          >.
        </p>
      }
    </div>
  `,
})
export class UsagePage {
  private readonly repo = inject(SettingsRepo);

  readonly periods: TabItem<Period>[] = [
    { id: '7', label: '7 days' },
    { id: '30', label: '30 days' },
    { id: '90', label: '90 days' },
    { id: 'all', label: 'All time' },
  ];
  readonly period = signal<Period>('30');
  readonly rows = signal<AiUsageRow[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly shown = signal(25);
  readonly pricesAsOf = PRICES_AS_OF;
  readonly webSearchUsd = WEB_SEARCH_USD;

  private readonly days = computed(() =>
    this.period() === 'all' ? null : Number(this.period()),
  );

  readonly summary = computed(() => summariseUsage(this.rows(), this.days()));
  readonly recent = computed(() => this.rows().slice(0, this.shown()));
  readonly maxCost = computed(() =>
    Math.max(0, ...this.summary().buckets.map((b) => b.cost)),
  );

  readonly costSub = computed(() => {
    const s = this.summary();
    const days = this.days();
    if (!days) return 'all time';
    return `about ${formatUsd((s.total.cost / days) * 30)} a month at this rate`;
  });

  readonly perDayLine = computed(() => {
    const s = this.summary();
    const days = this.days() ?? Math.max(1, s.buckets.length * 7);
    const perDay = s.total.calls / days;
    return `${perDay < 10 ? perDay.toFixed(1) : Math.round(perDay)} a day`;
  });

  readonly chartLabel = computed(() => {
    const s = this.summary();
    return `Estimated cost per ${s.bucket}, ${s.buckets.length} ${s.bucket}s, highest ${formatUsd(this.maxCost())}`;
  });

  constructor() {
    // The page loads everything once; the period only filters it.
    void this.load();
    effect(() => {
      this.period();
      this.shown.set(25);
    });
  }

  private async load() {
    this.loading.set(true);
    try {
      this.rows.set(await this.repo.loadUsage(null));
    } catch (e) {
      this.error.set((e as Error).message || 'Could not load usage');
    } finally {
      this.loading.set(false);
    }
  }

  usd(v: number) {
    return formatUsd(v);
  }
  tokens(n: number) {
    return formatTokens(n);
  }
  pct(v: number, max: number) {
    return max > 0 ? Math.max(v > 0 ? 2 : 0, (v / max) * 100) : 0;
  }
  callCost(r: AiUsageRow) {
    const c = estimateCost(r);
    return c === null ? '–' : formatUsd(c);
  }
  jobLabel(r: AiUsageRow) {
    return JOB_LABELS[r.job] ?? r.job;
  }
  /** "claude-sonnet-5-5" → "Sonnet 5.5"; other ids as they are. */
  modelName(id: string) {
    const m = id.match(
      /^claude-(haiku|sonnet|opus|fable|mythos)-([\d-]+?)(?:-\d{8})?$/,
    );
    if (!m) return id;
    return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2].replace(/-/g, '.')}`;
  }
  bucketLabel(start: string) {
    const d = new Date(`${start}T00:00:00Z`);
    const label = `${d.getUTCDate()} ${utcMonthShort(d)}`;
    return this.summary().bucket === 'week' ? `Week of ${label}` : label;
  }
  tick(start: string) {
    const d = new Date(`${start}T00:00:00Z`);
    return `${d.getUTCDate()} ${utcMonthShort(d)}`;
  }
  /** About five labels along the axis, always the first and last. */
  showTick(i: number, n: number) {
    if (n <= 8) return true;
    const every = Math.ceil(n / 5);
    return i === n - 1 || (i % every === 0 && n - 1 - i >= every / 2);
  }
}
