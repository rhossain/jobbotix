import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import {
  FEATURE_LABELS,
  planLine,
  type Entitlements,
  type Feature,
} from '@jobbotix/shared-types';
import { Plan } from '../../core/plan';
import { Icon } from '../../ui';

/**
 * Features the app gates today. The plans table lists more (alerts, extra
 * templates, Word export) that are not built yet; the card names only what a
 * plan changes right now. Add a key here when its feature ships.
 */
const LIVE_FEATURES: Feature[] = ['ai', 'company_research'];

export interface PlanCardView {
  line: string;
  paid: boolean;
  credits: number;
  included: string[];
  notIncluded: string[];
  /** Billing is off for this account, so the plan limits nothing yet. */
  open: boolean;
}

/** What the Plan card shows for an account; pure, so it is tested directly. */
export function planCardView(e: Entitlements): PlanCardView {
  const has = (f: Feature) => e.features.includes(f);
  return {
    line: planLine(e),
    paid: e.plan !== 'free',
    credits: e.credits,
    included: LIVE_FEATURES.filter(has).map((f) => FEATURE_LABELS[f]),
    notIncluded: e.enforced
      ? LIVE_FEATURES.filter((f) => !has(f)).map((f) => FEATURE_LABELS[f])
      : [],
    open: !e.enforced,
  };
}

/**
 * Settings: the account's plan, credits and what the plan covers. Hidden
 * until plans mean something for the account (see Plan.inEffect), so nobody
 * sees it while billing is off.
 */
@Component({
  selector: 'jb-plan-card',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (plan.inEffect()) {
      <section id="plan" class="jb-card flex flex-col gap-4 p-5 md:p-6">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 class="jb-section-title">Plan</h2>
          <span class="jb-tag" [class.jb-tag-ai]="view().paid">{{
            view().line
          }}</span>
        </div>

        @if (view().credits > 0) {
          <p class="text-sm text-ink-muted">
            <span class="text-lg font-semibold text-ink tabular-nums">{{
              view().credits
            }}</span>
            AI {{ view().credits === 1 ? 'credit' : 'credits' }} left
          </p>
        }

        <ul class="flex flex-col gap-2 text-sm">
          @for (f of view().included; track f) {
            <li class="flex items-start gap-2">
              <jb-icon
                name="circle-check"
                [size]="17"
                class="mt-0.5 shrink-0 text-brand"
              />
              <span>{{ f }}</span>
            </li>
          }
          @for (f of view().notIncluded; track f) {
            <li class="flex items-start gap-2 text-ink-muted">
              <jb-icon
                name="sparkles"
                [size]="17"
                class="mt-0.5 shrink-0 text-ink-faint"
              />
              <span>{{ f }} <span class="text-ink-faint">· Pro</span></span>
            </li>
          }
        </ul>

        @if (view().open) {
          <p class="text-xs text-ink-muted">
            Plans are not enforced yet, so every feature is on for your account.
          </p>
        } @else if (view().notIncluded.length) {
          <p class="text-xs text-ink-muted">
            Upgrading to Pro is not open yet.
          </p>
        }
      </section>
    }
  `,
})
export class PlanCard {
  protected readonly plan = inject(Plan);
  protected readonly view = computed(() =>
    planCardView(this.plan.entitlements()),
  );
}
