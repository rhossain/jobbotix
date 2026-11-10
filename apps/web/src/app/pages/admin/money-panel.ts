import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatUsd, type AdminMoney } from '@jobbotix/shared-types';
import { AdminRepo } from '../../core/data/repos';
import { Skeleton, Stat } from '../../ui';

export interface MoneyView {
  revenue: string;
  revenueSub: string;
  subscriptions: string;
  subscriptionsSub: string;
  aiSpend: string;
  aiSub: string;
  /** Accounts that cost more in AI this month than they paid. */
  alert: string;
}

/** What the money panel says; pure, so it is tested directly. */
export function moneyView(m: AdminMoney): MoneyView {
  const share =
    m.aiShareOfRevenue === null
      ? 'no revenue to compare with'
      : `${Math.round(m.aiShareOfRevenue * 100)}% of revenue`;
  const leaving = [
    m.cancelling ? `${m.cancelling} cancelling` : '',
    m.cancelled30d ? `${m.cancelled30d} cancelled in 30 days` : '',
    m.pastDue ? `${m.pastDue} past due` : '',
  ].filter(Boolean);
  return {
    revenue: formatUsd(m.revenueMonthUsd),
    revenueSub:
      `${formatUsd(m.revenueLastMonthUsd)} last month` +
      (m.refundsMonthUsd ? `, ${formatUsd(m.refundsMonthUsd)} refunded` : ''),
    subscriptions: String(m.activePaid),
    subscriptionsSub:
      [m.activeGranted ? `${m.activeGranted} granted by hand` : '', ...leaving]
        .filter(Boolean)
        .join(', ') || 'none granted or leaving',
    aiSpend: formatUsd(m.aiSpendMonthUsd),
    aiSub: share,
    alert: m.overCost.length
      ? `${m.overCost.length} ${m.overCost.length === 1 ? 'account costs' : 'accounts cost'} more in AI this month than ${m.overCost.length === 1 ? 'it' : 'they'} paid.`
      : '',
  };
}

/**
 * Admin: the month in money. What came in, who is subscribed, what AI on
 * credits cost against that, and the accounts that cost more than they pay.
 */
@Component({
  selector: 'jb-money-panel',
  imports: [RouterLink, Skeleton, Stat],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section class="jb-card flex flex-col gap-4 p-5 md:p-6">
      <h2 class="jb-section-title">Money this month</h2>
      @if (notDeployed()) {
        <p class="text-sm text-ink-muted">
          Built, and waiting for the next server update. Nothing to show until
          then.
        </p>
      } @else if (error()) {
        <p class="text-sm text-bad" role="alert">{{ error() }}</p>
      } @else if (!data()) {
        <jb-skeleton shape="row" [count]="2" />
      } @else {
        @let v = view()!;
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <jb-stat
            label="Revenue"
            [value]="v.revenue"
            [sub]="v.revenueSub"
            tone="brand"
          />
          <jb-stat
            label="Paying subscriptions"
            [value]="v.subscriptions"
            [sub]="v.subscriptionsSub"
          />
          <jb-stat
            label="AI on credits"
            [value]="v.aiSpend"
            [sub]="v.aiSub"
            tone="signal"
          />
        </div>
        @if (v.alert) {
          <div class="text-sm">
            <p class="text-warn" role="status">{{ v.alert }}</p>
            <ul class="mt-1 divide-y divide-line">
              @for (u of data()!.overCost; track u.id) {
                <li class="flex flex-wrap justify-between gap-2 py-1.5">
                  <a
                    [routerLink]="['/admin/users', u.id]"
                    class="text-brand-ink underline"
                    >{{ u.email }}</a
                  >
                  <span class="tabular-nums text-ink-muted"
                    >{{ usd(u.costUsd) }} of AI, paid {{ usd(u.paidUsd) }}</span
                  >
                </li>
              }
            </ul>
          </div>
        }
      }
    </section>
  `,
})
export class MoneyPanel {
  private readonly repo = inject(AdminRepo);
  readonly data = signal<AdminMoney | null>(null);
  readonly error = signal('');
  readonly notDeployed = signal(false);
  readonly view = computed(() => {
    const d = this.data();
    return d ? moneyView(d) : null;
  });

  constructor() {
    void this.load();
  }

  private async load() {
    try {
      this.data.set(await this.repo.money());
    } catch (e) {
      // The app is ahead of the server: the admin function is not there yet.
      if (/not switched on yet/.test((e as Error).message ?? ''))
        this.notDeployed.set(true);
      else this.error.set((e as Error).message || 'Could not load the numbers');
    }
  }

  usd(v: number) {
    return formatUsd(v);
  }
}
