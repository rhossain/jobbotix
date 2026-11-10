import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { formatUsd, type ProAiAdmin } from '@jobbotix/shared-types';
import { AdminRepo } from '../../core/data/repos';
import { Plan } from '../../core/plan';
import { Toast } from '../../shared/toast';
import { Button, Confirm, Skeleton } from '../../ui';

export interface ProAiView {
  /** "On" or "Off", and one sentence on what that means. */
  state: string;
  line: string;
  /** "$41.50 of $50.00 this month (83%)". */
  spend: string;
  /** 0 to 100, for the bar. */
  percent: number;
  tone: 'good' | 'warn' | 'bad';
  /** Shown when 80% of the budget is used, or all of it. */
  warning: string;
}

/** What the Pro AI panel says about the month; pure, so it is tested directly. */
export function proAiView(a: ProAiAdmin): ProAiView {
  const used = a.budgetUsed ?? 0;
  const percent = Math.min(100, Math.round(used * 100));
  const over = a.monthlyBudgetUsd > 0 && a.monthSpendUsd >= a.monthlyBudgetUsd;
  return {
    state: a.enabled ? 'On' : 'Off',
    line: a.enabled
      ? 'Accounts can spend credits on AI work run on the platform key.'
      : 'No AI work runs on the platform key. Every account uses its own key, or local drafts.',
    spend:
      a.monthlyBudgetUsd > 0
        ? `${formatUsd(a.monthSpendUsd)} of ${formatUsd(a.monthlyBudgetUsd)} this month (${Math.round(used * 100)}%)`
        : `${formatUsd(a.monthSpendUsd)} this month, with no budget set`,
    percent,
    tone: over ? 'bad' : a.budgetWarning ? 'warn' : 'good',
    warning: over
      ? 'The monthly budget is used up: AI on credits is paused until next month, or until you raise the budget.'
      : a.budgetWarning
        ? 'More than 80% of the monthly budget is used. At 100% AI on credits pauses for everyone.'
        : a.monthlyBudgetUsd <= 0 && a.enabled
          ? 'With a budget of $0 every call on credits is refused. Set a budget.'
          : '',
  };
}

/**
 * Admin: the Pro route (AI on credits). The switch that turns it on or off
 * for everyone, the monthly budget that stops it, the daily limit per
 * account, and how the month is going.
 */
@Component({
  selector: 'jb-pro-ai-panel',
  imports: [Button, FormsModule, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section class="jb-card flex flex-col gap-4 p-5 md:p-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="jb-section-title">AI on credits</h2>
        @if (data(); as d) {
          <span class="jb-tag" [class.jb-tag-ai]="d.enabled">{{
            view().state
          }}</span>
        }
      </div>

      @if (notDeployed()) {
        <p class="text-sm text-ink-muted">
          Built, and waiting for the next server update (migrations 0035 and
          0036). Nothing runs on credits until then.
        </p>
      } @else if (error()) {
        <p class="text-sm text-bad" role="alert">{{ error() }}</p>
      } @else if (!data()) {
        <jb-skeleton shape="row" [count]="2" />
      } @else {
        @let d = data()!;
        @let v = view();
        <p class="text-sm text-ink-muted">
          {{ v.line }}
          @if (!d.enabled) {
            Before switching it on, save Jobbotix's Anthropic key as the
            function secret <code>ANTHROPIC_API_KEY</code>; without it the
            switch does nothing. Switching on gives every account
            {{ d.trialCredits }} trial credits, once.
          }
        </p>

        <div>
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <span class="text-sm font-medium text-ink">{{ v.spend }}</span>
            <span class="text-xs text-ink-muted"
              >{{ d.monthCalls }} calls · {{ d.monthCredits }} credits
              spent</span
            >
          </div>
          <div
            class="mt-2 h-2 overflow-hidden rounded-full bg-sunken"
            role="progressbar"
            aria-label="Monthly AI budget used"
            [attr.aria-valuenow]="v.percent"
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <div
              class="h-full rounded-full"
              [class.bg-brand]="v.tone === 'good'"
              [class.bg-warn]="v.tone === 'warn'"
              [class.bg-bad]="v.tone === 'bad'"
              [style.width.%]="v.percent"
            ></div>
          </div>
          @if (v.warning) {
            <p
              class="mt-2 text-sm"
              [class.text-warn]="v.tone !== 'bad'"
              [class.text-bad]="v.tone === 'bad'"
              role="status"
            >
              {{ v.warning }}
            </p>
          }
        </div>

        <form
          class="flex flex-wrap items-end gap-3"
          (ngSubmit)="saveLimits()"
          novalidate
        >
          <label class="flex flex-col gap-1 text-sm">
            <span>Monthly budget (USD)</span>
            <input
              class="jb-input w-32"
              type="number"
              name="budget"
              min="0"
              max="100000"
              step="1"
              [ngModel]="budget()"
              (ngModelChange)="budget.set($event)"
            />
          </label>
          <label class="flex flex-col gap-1 text-sm">
            <span>Daily credits per account</span>
            <input
              class="jb-input w-32"
              type="number"
              name="cap"
              min="0"
              max="100000"
              step="1"
              [ngModel]="cap()"
              (ngModelChange)="cap.set($event)"
            />
          </label>
          <button
            type="submit"
            jbButton
            [busy]="busy() === 'limits'"
            [disabled]="!!busy() || !limitsChanged()"
          >
            Save limits
          </button>
          <button
            type="button"
            class="ml-auto"
            [jbButton]="d.enabled ? 'danger' : 'primary'"
            [busy]="busy() === 'switch'"
            [disabled]="!!busy()"
            (click)="toggle()"
          >
            {{ d.enabled ? 'Switch off' : 'Switch on' }}
          </button>
        </form>
        <p class="text-xs text-ink-muted">
          Writing runs on {{ d.models.writing }}; scoring and reading postings
          on {{ d.models.fast }}. Credit prices per job are in the pricing
          draft.
        </p>
      }
    </section>
  `,
})
export class ProAiPanel {
  private readonly repo = inject(AdminRepo);
  private readonly plan = inject(Plan);
  private readonly toast = inject(Toast);
  private readonly confirm = inject(Confirm);

  readonly data = signal<ProAiAdmin | null>(null);
  readonly error = signal('');
  /** The app is ahead of the database: the Pro route is not there yet. */
  readonly notDeployed = signal(false);
  readonly busy = signal<'' | 'limits' | 'switch'>('');
  readonly budget = signal(0);
  readonly cap = signal(0);

  readonly view = computed(() => {
    const d = this.data();
    return d ? proAiView(d) : proAiView({} as ProAiAdmin);
  });
  readonly limitsChanged = computed(() => {
    const d = this.data();
    return (
      !!d &&
      (Number(this.budget()) !== d.monthlyBudgetUsd ||
        Number(this.cap()) !== d.dailyCreditCap)
    );
  });

  constructor() {
    void this.load();
  }

  private take(d: ProAiAdmin) {
    this.data.set(d);
    this.budget.set(d.monthlyBudgetUsd);
    this.cap.set(d.dailyCreditCap);
  }

  private async load() {
    try {
      this.take(await this.repo.proAi());
    } catch (e) {
      // A database from before the Pro route existed has no such function
      // (PostgREST answers PGRST202): say it is waiting, not that it broke.
      if ((e as { code?: string }).code === 'PGRST202')
        this.notDeployed.set(true);
      else
        this.error.set(
          (e as Error).message || 'Could not load the AI on credits settings',
        );
    }
  }

  async saveLimits() {
    const budget = Number(this.budget());
    const cap = Math.trunc(Number(this.cap()));
    if (!(budget >= 0 && budget <= 100000 && cap >= 0 && cap <= 100000)) {
      this.toast.show('Could not save: both limits go from 0 to 100000');
      return;
    }
    await this.run('limits', async () => {
      this.take(
        await this.repo.setProAi({
          monthly_budget_usd: budget,
          daily_credit_cap: cap,
        }),
      );
      this.toast.show('Limits saved');
    });
  }

  async toggle() {
    const d = this.data();
    if (!d) return;
    const on = !d.enabled;
    const ok = await this.confirm.ask(
      on
        ? {
            title: 'Switch AI on credits on?',
            body: `Paying accounts start spending credits on the platform key, up to ${formatUsd(d.monthlyBudgetUsd)} a month in total, and every account gets ${d.trialCredits} trial credits, once.`,
            action: 'Switch on',
          }
        : {
            title: 'Switch AI on credits off?',
            body: 'Calls on the platform key stop at once. Accounts keep their credits, and AI work falls back to their own keys or local drafts.',
            action: 'Switch off',
            danger: true,
          },
    );
    if (!ok) return;
    await this.run('switch', async () => {
      this.take(await this.repo.setProAi({ enabled: on }));
      await this.plan.refresh();
      this.toast.show(on ? 'AI on credits is on' : 'AI on credits is off');
    });
  }

  private async run(what: 'limits' | 'switch', action: () => Promise<void>) {
    if (this.busy()) return;
    this.busy.set(what);
    try {
      await action();
    } catch (e) {
      this.toast.show(`Could not save: ${(e as Error).message || 'try again'}`);
    } finally {
      this.busy.set('');
    }
  }
}
