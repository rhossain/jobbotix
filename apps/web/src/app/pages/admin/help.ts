import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { formatUsd } from '@jobbotix/shared-types';
import {
  AdminRepo,
  type AdminHelp,
  type AdminHelpQuestion,
  type HelpAiSettings,
} from '../../core/data/repos';
import { articleById } from '../../help/articles';
import { RelativeDayPipe } from '../../shared/format';
import { Toast } from '../../shared/toast';
import { Button, Icon, PageHeader, Skeleton, Stat } from '../../ui';
import { AdminTabs } from './admin-tabs';

export const HELP_ROUTE_LABEL: Record<AdminHelpQuestion['route'], string> = {
  own: 'Their AI',
  platform: 'Jobbotix AI',
  articles: 'Articles',
};

/** Questions the articles did not answer, or whose answer got a No. */
export function needsWork(questions: AdminHelpQuestion[]): AdminHelpQuestion[] {
  return questions.filter((q) => !q.found || q.feedback === 'no');
}

/** "$0.04 of $5.00 this month (1%)", and how full the bar is. */
export function helpSpend(h: Pick<AdminHelp, 'monthSpendUsd' | 'settings'>): {
  line: string;
  percent: number;
  tone: 'good' | 'warn' | 'bad';
} {
  const budget = h.settings.monthly_budget_usd;
  if (budget <= 0)
    return {
      line: `${formatUsd(h.monthSpendUsd)} this month; with a budget of $0 no answers run on Jobbotix's key`,
      percent: 100,
      tone: 'bad',
    };
  const used = h.monthSpendUsd / budget;
  return {
    line: `${formatUsd(h.monthSpendUsd)} of ${formatUsd(budget)} this month (${Math.round(used * 100)}%)`,
    percent: Math.min(100, Math.round(used * 100)),
    tone: used >= 1 ? 'bad' : used >= 0.8 ? 'warn' : 'good',
  };
}

/**
 * Admin → Help: what people ask the Help chat, which questions the articles
 * do not answer well, what it costs, and its limits. Questions carry no
 * name or email; Send to support requests do.
 */
@Component({
  selector: 'jb-admin-help',
  imports: [
    AdminTabs,
    Button,
    FormsModule,
    Icon,
    NgTemplateOutlet,
    PageHeader,
    RelativeDayPipe,
    RouterLink,
    Skeleton,
    Stat,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="max-w-4xl">
      <jb-page-header
        title="Admin"
        lead="What people ask the Help chat, the questions the help articles do not answer well, and what the AI answers cost."
      />
      <jb-admin-tabs class="mt-6" current="help" />

      <div class="mt-6 flex flex-wrap items-center justify-between gap-3">
        <label class="flex items-center gap-2 text-sm">
          <span>Questions from the last</span>
          <select
            class="jb-input w-auto"
            [ngModel]="days()"
            (ngModelChange)="setDays($event)"
            aria-label="Period"
          >
            <option [ngValue]="7">7 days</option>
            <option [ngValue]="14">14 days</option>
            <option [ngValue]="30">30 days</option>
          </select>
        </label>
        <button type="button" jbButton="ghost" size="sm" (click)="load()">
          <jb-icon name="rotate-cw" [size]="16" /> Refresh
        </button>
      </div>

      @if (notDeployed()) {
        <p class="jb-card mt-4 p-5 text-sm text-ink-muted">
          Built, and waiting for the next server update (migration 0067).
        </p>
      } @else if (error()) {
        <p class="jb-card mt-4 p-5 text-sm text-bad" role="alert">
          {{ error() }}
        </p>
      } @else if (!data()) {
        <div class="mt-4"><jb-skeleton shape="row" [count]="4" /></div>
      } @else {
        @let d = data()!;
        <div class="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <jb-stat
            label="Questions"
            [value]="d.totals.asked"
            [sub]="d.totals.people + ' people'"
          />
          <jb-stat
            label="Answered by AI"
            [value]="d.totals.own + d.totals.platform"
            [sub]="d.totals.own + ' on their own AI'"
            tone="brand"
          />
          <jb-stat
            label="Not answered"
            [value]="d.totals.not_found"
            [tone]="d.totals.not_found ? 'warn' : 'muted'"
            sub="the articles did not cover it"
          />
          <jb-stat
            label="Said it helped"
            [value]="d.totals.yes"
            [sub]="d.totals.no + ' said it did not'"
            [tone]="d.totals.no > d.totals.yes ? 'bad' : 'good'"
          />
        </div>

        <section class="jb-card mt-4 p-5 md:p-6" aria-labelledby="hq-work">
          <h2 id="hq-work" class="jb-section-title">Needs a better article</h2>
          <p class="mt-1 text-sm text-ink-muted">
            Questions the articles did not answer, and answers that got a No.
            Write or improve an article for the ones that come up often.
          </p>
          @if (!work().length) {
            <p class="mt-3 text-sm text-ink-muted">Nothing here. Good.</p>
          } @else {
            <ul class="mt-3 divide-y divide-line text-sm">
              @for (q of work(); track q.id) {
                <ng-container
                  *ngTemplateOutlet="row; context: { $implicit: q }"
                />
              }
            </ul>
          }
        </section>

        @if (d.mostAsked.length) {
          <section class="jb-card mt-4 p-5 md:p-6" aria-labelledby="hq-most">
            <h2 id="hq-most" class="jb-section-title">Most asked</h2>
            <ul class="mt-3 divide-y divide-line text-sm">
              @for (m of d.mostAsked; track m.question) {
                <li class="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
                  <span class="min-w-0 flex-1 text-ink">{{ m.question }}</span>
                  <span class="text-ink-muted tabular-nums"
                    >{{ m.times }} times</span
                  >
                  @if (m.not_found) {
                    <span class="jb-tag jb-tag-warn"
                      >{{ m.not_found }} not answered</span
                    >
                  }
                  @if (m.no) {
                    <span class="jb-tag jb-tag-warn">{{ m.no }} said No</span>
                  }
                </li>
              }
            </ul>
          </section>
        }

        <section class="jb-card mt-4 p-5 md:p-6" aria-labelledby="hq-all">
          <h2 id="hq-all" class="jb-section-title">All questions</h2>
          <p class="mt-1 text-sm text-ink-muted">
            Newest first, without names. Kept for 30 days.
          </p>
          @if (!d.questions.length) {
            <p class="mt-3 text-sm text-ink-muted">
              Nobody has asked the Help chat anything in this period.
            </p>
          } @else {
            <ul class="mt-3 divide-y divide-line text-sm">
              @for (q of d.questions; track q.id) {
                <ng-container
                  *ngTemplateOutlet="row; context: { $implicit: q }"
                />
              }
            </ul>
          }
        </section>

        <section class="jb-card mt-4 p-5 md:p-6" aria-labelledby="hq-support">
          <h2 id="hq-support" class="jb-section-title">Sent to support</h2>
          <p class="mt-1 text-sm text-ink-muted">
            These people asked for an answer, so their email is shown. Each was
            also emailed to support&#64;jobbotix.com.
          </p>
          @if (!d.tickets.length) {
            <p class="mt-3 text-sm text-ink-muted">No requests.</p>
          } @else {
            <ul class="mt-3 divide-y divide-line text-sm">
              @for (t of d.tickets; track t.id) {
                <li class="py-2">
                  <div class="flex flex-wrap items-baseline gap-x-3">
                    @if (t.user_id) {
                      <a
                        class="font-medium text-brand-ink underline-offset-2 hover:underline"
                        [routerLink]="['/admin/users', t.user_id]"
                        >{{ t.email || 'Account' }}</a
                      >
                    }
                    <span class="text-ink-muted"
                      >{{ t.page || 'no page' }} ·
                      {{ t.created_at | relativeDay }}</span
                    >
                    @if (!t.emailed_at) {
                      <span class="jb-tag jb-tag-warn">email not sent</span>
                    }
                  </div>
                  <p class="mt-1 whitespace-pre-line text-ink">
                    {{ t.message }}
                  </p>
                </li>
              }
            </ul>
          }
        </section>

        <section class="jb-card mt-4 p-5 md:p-6" aria-labelledby="hq-ai">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 id="hq-ai" class="jb-section-title">AI answers</h2>
            <span class="jb-tag" [class.jb-tag-ai]="d.settings.enabled">{{
              d.settings.enabled ? 'On' : 'Off'
            }}</span>
          </div>
          <p class="mt-1 text-sm text-ink-muted">
            People with their own AI connection are answered on it. Everyone
            else is answered on Jobbotix's Anthropic key (the function secret
            <code>ANTHROPIC_API_KEY</code>), within these limits; without the
            key, or when the budget or a daily limit is reached, the chat shows
            the best help article instead.
          </p>
          @let s = spend();
          <div class="mt-3">
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <span class="text-sm font-medium text-ink">{{ s.line }}</span>
              <span class="text-xs text-ink-muted"
                >{{ d.monthAnswers }} answers on Jobbotix's key</span
              >
            </div>
            <div
              class="mt-2 h-2 overflow-hidden rounded-full bg-sunken"
              role="progressbar"
              aria-label="Monthly Help chat budget used"
              [attr.aria-valuenow]="s.percent"
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <div
                class="h-full rounded-full"
                [class.bg-brand]="s.tone === 'good'"
                [class.bg-warn]="s.tone === 'warn'"
                [class.bg-bad]="s.tone === 'bad'"
                [style.width.%]="s.percent"
              ></div>
            </div>
          </div>

          <form
            class="mt-4 flex flex-wrap items-end gap-3"
            (ngSubmit)="save()"
            novalidate
          >
            <label class="flex flex-col gap-1 text-sm">
              <span>Monthly budget (USD)</span>
              <input
                class="jb-input w-28"
                type="number"
                name="budget"
                min="0"
                max="10000"
                step="1"
                [(ngModel)]="form.monthly_budget_usd"
              />
            </label>
            <label class="flex flex-col gap-1 text-sm">
              <span>A day, Free</span>
              <input
                class="jb-input w-24"
                type="number"
                name="free"
                min="0"
                max="10000"
                step="1"
                [(ngModel)]="form.daily_free"
              />
            </label>
            <label class="flex flex-col gap-1 text-sm">
              <span>A day, Pro</span>
              <input
                class="jb-input w-24"
                type="number"
                name="pro"
                min="0"
                max="10000"
                step="1"
                [(ngModel)]="form.daily_pro"
              />
            </label>
            <label class="flex flex-col gap-1 text-sm">
              <span>A day, own AI</span>
              <input
                class="jb-input w-24"
                type="number"
                name="own"
                min="0"
                max="10000"
                step="1"
                [(ngModel)]="form.daily_own"
              />
            </label>
            <button
              type="submit"
              jbButton
              [busy]="busy() === 'limits'"
              [disabled]="!!busy()"
            >
              Save limits
            </button>
            <button
              type="button"
              class="ml-auto"
              [jbButton]="d.settings.enabled ? 'danger' : 'primary'"
              [busy]="busy() === 'switch'"
              [disabled]="!!busy()"
              (click)="toggle()"
            >
              {{ d.settings.enabled ? 'Switch AI off' : 'Switch AI on' }}
            </button>
          </form>
          <p class="mt-2 text-xs text-ink-muted">
            Answers run on {{ d.settings.model || 'the default model' }}.
            Switched off, the chat answers from the articles only, for everyone.
          </p>
        </section>
      }
    </section>

    <ng-template #row let-q>
      <li class="py-2">
        <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span class="min-w-0 flex-1 text-ink">{{ q.question }}</span>
          @if (q.feedback === 'yes') {
            <jb-icon
              name="thumbs-up"
              [size]="16"
              class="text-good"
              aria-label="Said it helped"
            />
          } @else if (q.feedback === 'no') {
            <jb-icon
              name="thumbs-down"
              [size]="16"
              class="text-bad"
              aria-label="Said it did not help"
            />
          }
        </div>
        <div
          class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted"
        >
          <span class="jb-tag" [class.jb-tag-ai]="q.route !== 'articles'">{{
            routeLabel(q.route)
          }}</span>
          @if (!q.found) {
            <span class="jb-tag jb-tag-warn">not answered</span>
          }
          @for (id of q.articles; track id) {
            <a
              class="underline-offset-2 hover:underline"
              [routerLink]="['/help', id]"
              >{{ title(id) }}</a
            >
          }
          <span
            >{{ q.page || 'no page' }} · {{ q.created_at | relativeDay }}</span
          >
        </div>
      </li>
    </ng-template>
  `,
})
export class AdminHelpPage {
  private readonly repo = inject(AdminRepo);
  private readonly toast = inject(Toast);

  readonly days = signal(14);
  readonly data = signal<AdminHelp | null>(null);
  readonly error = signal('');
  readonly notDeployed = signal(false);
  readonly busy = signal<'' | 'limits' | 'switch'>('');
  protected form: Omit<HelpAiSettings, 'model' | 'enabled'> = {
    monthly_budget_usd: 5,
    daily_free: 10,
    daily_pro: 100,
    daily_own: 30,
  };

  readonly work = computed(() => needsWork(this.data()?.questions ?? []));
  readonly spend = computed(() => {
    const d = this.data();
    return d ? helpSpend(d) : { line: '', percent: 0, tone: 'good' as const };
  });

  constructor() {
    void this.load();
  }

  protected routeLabel(route: AdminHelpQuestion['route']): string {
    return HELP_ROUTE_LABEL[route] ?? route;
  }

  protected title(id: string): string {
    return articleById(id)?.title ?? id;
  }

  setDays(d: number) {
    this.days.set(d);
    void this.load();
  }

  async load() {
    this.error.set('');
    try {
      const d = await this.repo.help(this.days());
      this.data.set(d);
      this.form = {
        monthly_budget_usd: d.settings.monthly_budget_usd,
        daily_free: d.settings.daily_free,
        daily_pro: d.settings.daily_pro,
        daily_own: d.settings.daily_own,
      };
    } catch (e) {
      if ((e as { code?: string }).code === 'PGRST202')
        this.notDeployed.set(true);
      else
        this.error.set(
          (e as Error).message || 'Could not load the Help chat questions',
        );
    }
  }

  async save() {
    const f = this.form;
    const values = [
      Number(f.monthly_budget_usd),
      Number(f.daily_free),
      Number(f.daily_pro),
      Number(f.daily_own),
    ];
    if (values.some((v) => !(v >= 0 && v <= 10000))) {
      this.toast.show('Could not save: each limit goes from 0 to 10000');
      return;
    }
    await this.change('limits', {
      monthly_budget_usd: values[0],
      daily_free: Math.trunc(values[1]),
      daily_pro: Math.trunc(values[2]),
      daily_own: Math.trunc(values[3]),
    });
  }

  async toggle() {
    const on = !this.data()?.settings.enabled;
    await this.change('switch', { enabled: on });
  }

  private async change(
    what: 'limits' | 'switch',
    patch: Parameters<AdminRepo['setHelpAi']>[0],
  ) {
    this.busy.set(what);
    try {
      const settings = await this.repo.setHelpAi(patch);
      this.data.update((d) => (d ? { ...d, settings } : d));
      this.toast.show(
        what === 'limits'
          ? 'Limits saved'
          : settings.enabled
            ? 'AI answers switched on'
            : 'AI answers switched off',
      );
    } catch (e) {
      this.toast.show((e as Error).message || 'Could not save');
    } finally {
      this.busy.set('');
    }
  }
}
