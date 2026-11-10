import { describe, expect, it } from 'vitest';
import { adminMoney } from '@jobbotix/shared-types';
import { moneyView } from './money-panel';
import { cents } from './user';

describe('moneyView', () => {
  it('reads an empty month plainly', () => {
    const v = moneyView(adminMoney({}));
    expect(v.revenue).toBe('$0.00');
    expect(v.revenueSub).toBe('$0.00 last month');
    expect(v.subscriptions).toBe('0');
    expect(v.subscriptionsSub).toBe('none granted or leaving');
    expect(v.aiSub).toBe('no revenue to compare with');
    expect(v.alert).toBe('');
  });

  it('shows refunds, who is leaving, the AI share and the costly accounts', () => {
    const v = moneyView(
      adminMoney({
        revenue_month_usd: 150,
        revenue_last_month_usd: 90,
        refunds_month_usd: 15,
        active_paid: 12,
        active_granted: 3,
        cancelling: 2,
        past_due: 1,
        ai_spend_month_usd: 30,
        ai_share_of_revenue: 0.2,
        over_cost: [
          { id: 'a', email: 'a@example.com', cost_usd: 22, paid_usd: 15 },
        ],
      }),
    );
    expect(v.revenueSub).toBe('$90.00 last month, $15.00 refunded');
    expect(v.subscriptionsSub).toBe(
      '3 granted by hand, 2 cancelling, 1 past due',
    );
    expect(v.aiSub).toBe('20% of revenue');
    expect(v.alert).toBe('1 account costs more in AI this month than it paid.');
  });
});

describe('cents', () => {
  it('formats payments and refunds', () => {
    expect(cents(1500)).toBe('$15.00');
    expect(cents(-500)).toBe('-$5.00');
    expect(cents(2700, 'EUR')).toBe('$27.00 EUR');
  });
});
