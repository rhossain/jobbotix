import { describe, expect, it } from 'vitest';
import {
  adminMoney,
  adminUserDetail,
  adminUserRow,
  adminUsersCsvRows,
  aiRouteLabel,
  auditLabel,
} from './admin';

const row = adminUserRow({
  id: 'u1',
  email: 'pat@example.com',
  name: 'Pat',
  created_at: '2026-11-01T08:00:00Z',
  plan: 'pro',
  plan_name: 'Pro',
  status: 'active',
  credits: 120,
  route: 'own',
  providers: ['gemini', 'groq'],
  roles: 14,
  ai_calls_30d: 60,
  last_active: '2026-11-10T09:30:00Z',
  suspended: true,
});

describe('adminUserRow', () => {
  it('reads a row and fills what is missing', () => {
    expect(row.plan_name).toBe('Pro');
    expect(row.suspended).toBe(true);
    const empty = adminUserRow(null);
    expect(empty.plan).toBe('free');
    expect(empty.route).toBe('none');
    expect(empty.providers).toEqual([]);
  });

  it('says how the AI is paid for', () => {
    expect(aiRouteLabel(row)).toBe('Own key: Google Gemini, Groq');
    expect(aiRouteLabel({ route: 'credits', providers: ['gemini'] })).toBe(
      'Credits',
    );
    expect(aiRouteLabel({ route: 'none', providers: [] })).toBe('None');
  });
});

describe('adminUsersCsvRows', () => {
  it('has a header and one line per account, with dates as days', () => {
    const rows = adminUsersCsvRows([row]);
    expect(rows).toHaveLength(2);
    expect(rows[0][0]).toBe('Email');
    expect(rows[1]).toEqual([
      'pat@example.com',
      'Pat',
      '2026-11-01',
      'Pro',
      'active',
      '120',
      'Own key: Google Gemini, Groq',
      '14',
      '60',
      '2026-11-10',
      '',
      'yes',
    ]);
    expect(rows[0]).toHaveLength(rows[1].length);
  });
});

describe('adminUserDetail', () => {
  it('reads the four tabs and keeps content closed unless it was sent', () => {
    const d = adminUserDetail({
      account: {
        id: 'u1',
        email: 'pat@example.com',
        suspended_at: null,
        has_resume: true,
      },
      billing: {
        entitlements: {
          plan: 'pro',
          plan_name: 'Pro',
          features: ['ai'],
          credits: 7,
        },
        subscription: { plan: 'pro', status: 'active', source: 'admin' },
        payments: [
          { kind: 'subscription', amount_cents: 1500, paid_at: '2026-11-02' },
        ],
        ledger: [{ delta: -3, kind: 'spend', reason: 'letter' }],
      },
      ai: {
        connections: [{ provider: 'gemini', status: 'ok' }],
        month: [{ job: 'letter', route: 'platform', calls: 2, cost_usd: 0.03 }],
        trend: [{ day: '2026-11-10', calls: 2 }],
      },
      activity: { roles_by_status: { new: 4, applied: 2 }, runs_30d: 30 },
      auth: {
        last_sign_in_at: '2026-11-10T08:00:00Z',
        email_confirmed_at: '2026-11-01',
      },
      content: null,
    });
    expect(d.account.last_sign_in_at).toBe('2026-11-10T08:00:00Z');
    expect(d.account.email_confirmed).toBe(true);
    expect(d.billing.entitlements.credits).toBe(7);
    expect(d.billing.subscription?.source).toBe('admin');
    expect(d.billing.payments[0].amount_cents).toBe(1500);
    expect(d.ai.month[0].route).toBe('platform');
    expect(d.activity.roles_by_status).toEqual({ new: 4, applied: 2 });
    expect(d.content).toBeNull();
  });

  it('survives an empty answer', () => {
    const d = adminUserDetail(undefined);
    expect(d.account.email).toBe('');
    expect(d.billing.subscription).toBeNull();
    expect(d.ai.month).toEqual([]);
  });
});

describe('auditLabel', () => {
  it('puts each action in a few words', () => {
    expect(auditLabel('add_credits', { credits: 50, reason: 'beta' })).toBe(
      'Added 50 credits: beta',
    );
    expect(auditLabel('add_credits', { credits: -20, reason: 'fix' })).toBe(
      'Removed 20 credits: fix',
    );
    expect(auditLabel('set_plan', { plan: 'pro', reason: 'tester' })).toBe(
      'Plan set to pro: tester',
    );
    expect(auditLabel('suspend', { reason: 'abuse' })).toBe('Suspended: abuse');
    expect(auditLabel('view_content', {})).toMatch(/support access/);
    expect(auditLabel('something_new', {})).toBe('something new');
  });
});

describe('adminMoney', () => {
  it('reads the overview; no revenue means no share', () => {
    const m = adminMoney({
      revenue_month_usd: 10,
      ai_spend_month_usd: 0.816,
      ai_share_of_revenue: 0.0816,
      over_cost: [
        { id: 'u4', email: 'd@example.com', cost_usd: 0.8, paid_usd: 0 },
      ],
    });
    expect(m.revenueMonthUsd).toBe(10);
    expect(m.aiShareOfRevenue).toBe(0.0816);
    expect(m.overCost[0].costUsd).toBe(0.8);
    expect(adminMoney({}).aiShareOfRevenue).toBeNull();
  });
});
