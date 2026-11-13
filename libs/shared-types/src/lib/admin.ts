// The admin console's data, as the admin-users function returns it
// (migration 0037): the users table, one account, and the money overview.

import { normaliseEntitlements, type Entitlements } from './entitlements';
import { providerName } from './providers';

export type AdminAiRoute = 'own' | 'credits' | 'none';

export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  created_at: string;
  is_admin: boolean;
  suspended: boolean;
  /** The owner has opened their content to support. */
  support_access: boolean;
  plan: string;
  plan_name: string;
  status: string;
  credits: number;
  /** How the account's AI is paid for. */
  route: AdminAiRoute;
  providers: string[];
  roles: number;
  ai_calls_30d: number;
  last_active: string | null;
}

export interface AdminUserFilters {
  q?: string;
  plan?: 'free' | 'pro' | null;
  route?: AdminAiRoute | null;
  limit?: number;
  offset?: number;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const arr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v)
    ? v.filter(
        (x): x is Record<string, unknown> => !!x && typeof x === 'object',
      )
    : [];
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};

export function adminUserRow(v: unknown): AdminUserRow {
  const o = obj(v);
  const route = o['route'];
  return {
    id: str(o['id']),
    email: str(o['email']),
    name: str(o['name']),
    created_at: str(o['created_at']),
    is_admin: o['is_admin'] === true,
    suspended: o['suspended'] === true,
    support_access: o['support_access'] === true,
    plan: str(o['plan']) || 'free',
    plan_name: str(o['plan_name']) || 'Free',
    status: str(o['status']) || 'none',
    credits: num(o['credits']),
    route: route === 'own' || route === 'credits' ? route : 'none',
    providers: Array.isArray(o['providers'])
      ? o['providers'].filter((p): p is string => typeof p === 'string')
      : [],
    roles: num(o['roles']),
    ai_calls_30d: num(o['ai_calls_30d']),
    last_active: str(o['last_active']) || null,
  };
}

/** "Credits", "Own key: Google Gemini, Groq", "None". */
export function aiRouteLabel(u: Pick<AdminUserRow, 'route' | 'providers'>) {
  if (u.route === 'credits') return 'Credits';
  if (u.route === 'own')
    return `Own key: ${u.providers.map(providerName).join(', ')}`;
  return 'None';
}

/** The users table as CSV rows (header first), for the export. */
export function adminUsersCsvRows(users: AdminUserRow[]): string[][] {
  return [
    [
      'Email',
      'Name',
      'Signed up',
      'Plan',
      'Status',
      'Credits',
      'AI',
      'Roles tracked',
      'AI calls (30 days)',
      'Last active',
      'Admin',
      'Suspended',
    ],
    ...users.map((u) => [
      u.email,
      u.name,
      u.created_at.slice(0, 10),
      u.plan_name,
      u.status,
      String(u.credits),
      aiRouteLabel(u),
      String(u.roles),
      String(u.ai_calls_30d),
      (u.last_active ?? '').slice(0, 10),
      u.is_admin ? 'yes' : '',
      u.suspended ? 'yes' : '',
    ]),
  ];
}

export interface AdminUsageLine {
  job: string;
  provider: string;
  model: string;
  route: 'own' | 'platform';
  calls: number;
  tokens_in: number;
  tokens_out: number;
  web_searches: number;
  cost_usd: number;
}

export interface AdminUserDetail {
  account: {
    id: string;
    email: string;
    name: string;
    timezone: string;
    is_admin: boolean;
    created_at: string;
    invite_code: string;
    suspended_at: string | null;
    suspended_reason: string;
    support_access_until: string | null;
    ai_route: string;
    has_resume: boolean;
    has_search_profile: boolean;
    ingest_keys: number;
    last_sign_in_at: string | null;
    email_confirmed: boolean;
  };
  billing: {
    entitlements: Entitlements;
    subscription: {
      plan: string;
      status: string;
      source: string;
      period_end: string | null;
      cancel_at_period_end: boolean;
      grace_until: string | null;
      provider_customer_id: string;
      note: string;
    } | null;
    payments: {
      kind: string;
      product: string;
      amount_cents: number;
      currency: string;
      status: string;
      paid_at: string;
    }[];
    ledger: {
      delta: number;
      kind: string;
      reason: string;
      created_at: string;
    }[];
  };
  ai: {
    connections: {
      provider: string;
      model: string;
      status: string;
      last_error: string;
      limited_until: string | null;
    }[];
    month: AdminUsageLine[];
    trend: { day: string; calls: number }[];
    credits_spent_month: number;
    platform_cost_month: number;
  };
  activity: {
    roles_by_status: Record<string, number>;
    last_run: string | null;
    runs_30d: number;
    events_30d: Record<string, number>;
    audit: {
      action: string;
      admin_email: string;
      detail: Record<string, unknown>;
      created_at: string;
    }[];
  };
  /** Only while the owner has support access open. */
  content: {
    roles: {
      company: string;
      title: string;
      status: string;
      score: number;
      found_at: string;
    }[];
    resume: unknown;
  } | null;
}

export function adminUserDetail(v: unknown): AdminUserDetail {
  const o = obj(v);
  const a = obj(o['account']);
  const b = obj(o['billing']);
  const ai = obj(o['ai']);
  const act = obj(o['activity']);
  const auth = obj(o['auth']);
  const sub = o['billing'] && b['subscription'] ? obj(b['subscription']) : null;
  const counts = (x: unknown) =>
    Object.fromEntries(
      Object.entries(obj(x)).map(([k, n]) => [k, num(n)] as const),
    );
  const content = o['content'] ? obj(o['content']) : null;
  return {
    account: {
      id: str(a['id']),
      email: str(a['email']),
      name: str(a['name']),
      timezone: str(a['timezone']),
      is_admin: a['is_admin'] === true,
      created_at: str(a['created_at']),
      invite_code: str(a['invite_code']),
      suspended_at: str(a['suspended_at']) || null,
      suspended_reason: str(a['suspended_reason']),
      support_access_until: str(a['support_access_until']) || null,
      ai_route: str(a['ai_route']) || 'auto',
      has_resume: a['has_resume'] === true,
      has_search_profile: a['has_search_profile'] === true,
      ingest_keys: num(a['ingest_keys']),
      last_sign_in_at: str(auth['last_sign_in_at']) || null,
      email_confirmed: !!str(auth['email_confirmed_at']),
    },
    billing: {
      entitlements: normaliseEntitlements(b['entitlements']),
      subscription: sub
        ? {
            plan: str(sub['plan']),
            status: str(sub['status']),
            source: str(sub['source']),
            period_end: str(sub['period_end']) || null,
            cancel_at_period_end: sub['cancel_at_period_end'] === true,
            grace_until: str(sub['grace_until']) || null,
            provider_customer_id: str(sub['provider_customer_id']),
            note: str(sub['note']),
          }
        : null,
      payments: arr(b['payments']).map((p) => ({
        kind: str(p['kind']),
        product: str(p['product']),
        amount_cents: num(p['amount_cents']),
        currency: str(p['currency']) || 'usd',
        status: str(p['status']),
        paid_at: str(p['paid_at']),
      })),
      ledger: arr(b['ledger']).map((l) => ({
        delta: num(l['delta']),
        kind: str(l['kind']),
        reason: str(l['reason']),
        created_at: str(l['created_at']),
      })),
    },
    ai: {
      connections: arr(ai['connections']).map((c) => ({
        provider: str(c['provider']),
        model: str(c['model']),
        status: str(c['status']),
        last_error: str(c['last_error']),
        limited_until: str(c['limited_until']) || null,
      })),
      month: arr(ai['month']).map((m) => ({
        job: str(m['job']),
        provider: str(m['provider']) || 'anthropic',
        model: str(m['model']),
        route: m['route'] === 'platform' ? 'platform' : 'own',
        calls: num(m['calls']),
        tokens_in: num(m['tokens_in']),
        tokens_out: num(m['tokens_out']),
        web_searches: num(m['web_searches']),
        cost_usd: num(m['cost_usd']),
      })),
      trend: arr(ai['trend']).map((t) => ({
        day: str(t['day']),
        calls: num(t['calls']),
      })),
      credits_spent_month: num(ai['credits_spent_month']),
      platform_cost_month: num(ai['platform_cost_month']),
    },
    activity: {
      roles_by_status: counts(act['roles_by_status']),
      last_run: str(act['last_run']) || null,
      runs_30d: num(act['runs_30d']),
      events_30d: counts(act['events_30d']),
      audit: arr(act['audit']).map((x) => ({
        action: str(x['action']),
        admin_email: str(x['admin_email']),
        detail: obj(x['detail']),
        created_at: str(x['created_at']),
      })),
    },
    content: content
      ? {
          roles: arr(content['roles']).map((r) => ({
            company: str(r['company']),
            title: str(r['title']),
            status: str(r['status']),
            score: num(r['score']),
            found_at: str(r['found_at']),
          })),
          resume: content['resume'] ?? null,
        }
      : null,
  };
}

/**
 * Why an account's search finds what it finds: the match and score rules
 * replayed over the recent pool, counted at every step (admin-users,
 * action "explain_search"). Nothing is written when it runs.
 */
export interface SearchExplain {
  days: number;
  targetRoles: string[];
  searchTerms: string[];
  warnings: string[];
  /** Postings in the pool for the period. */
  pool: number;
  /** Another kind of job: no target role or stack in the title. */
  notRelevant: number;
  tooOld: number;
  /** Limited to a region, and the profile has no country to compare. */
  needsCountry: number;
  excluded: { reason: string; count: number }[];
  /** Their kind of job, scored under the filing threshold. */
  lowScore: number;
  wouldFile: number;
  threshold: number;
  byGrade: {
    exact: number;
    variant: number;
    partial: number;
    described: number;
    stack: number;
  };
  bySource: { source: string; pool: number; matched: number }[];
  top: { title: string; company: string; score: number }[];
  low: { title: string; company: string; score: number }[];
  /** Where the country-limited postings are limited to, most common first. */
  limitedTo: { place: string; count: number }[];
  /** Title matches that a setting ruled out: the reason and the posting's own location line. */
  ruledOut: {
    title: string;
    company: string;
    reason: string;
    where: string;
    source: string;
  }[];
}

/** Filed roles the current rules would call another kind of job (admin-users, "recheck_roles"). */
export interface RoleRecheck {
  /** Untouched, matcher-filed roles that were looked at. */
  checked: number;
  count: number;
  /** True when they were moved to Skipped by this call. */
  applied: boolean;
  roles: { title: string; company: string }[];
}

export function adminRoleRecheck(v: unknown): RoleRecheck {
  const o = obj(v);
  return {
    checked: num(o['checked']),
    count: num(o['count']),
    applied: o['applied'] === true,
    roles: arr(o['roles']).map((r) => ({
      title: str(r['title']),
      company: str(r['company']),
    })),
  };
}

export function adminSearchExplain(v: unknown): SearchExplain {
  const o = obj(v);
  const strs = (x: unknown) =>
    Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : [];
  const g = obj(o['by_grade']);
  const titles = (x: unknown) =>
    arr(x).map((t) => ({
      title: str(t['title']),
      company: str(t['company']),
      score: num(t['score']),
    }));
  return {
    days: num(o['days']),
    targetRoles: strs(o['target_roles']),
    searchTerms: strs(o['search_terms']),
    warnings: strs(o['warnings']),
    pool: num(o['pool']),
    notRelevant: num(o['not_relevant']),
    tooOld: num(o['too_old']),
    needsCountry: num(o['needs_country']),
    excluded: arr(o['excluded']).map((e) => ({
      reason: str(e['reason']),
      count: num(e['count']),
    })),
    lowScore: num(o['low_score']),
    wouldFile: num(o['would_file']),
    threshold: num(o['threshold']),
    byGrade: {
      exact: num(g['exact']),
      variant: num(g['variant']),
      partial: num(g['partial']),
      described: num(g['described']),
      stack: num(g['stack']),
    },
    bySource: arr(o['by_source']).map((s) => ({
      source: str(s['source']),
      pool: num(s['pool']),
      matched: num(s['matched']),
    })),
    top: titles(o['top']),
    low: titles(o['low']),
    limitedTo: arr(o['limited_to']).map((l) => ({
      place: str(l['place']),
      count: num(l['count']),
    })),
    ruledOut: arr(o['ruled_out']).map((r) => ({
      title: str(r['title']),
      company: str(r['company']),
      reason: str(r['reason']),
      where: str(r['where']),
      source: str(r['source']),
    })),
  };
}

/** What an audit row says, in a few words. */
export function auditLabel(action: string, detail: Record<string, unknown>) {
  const d = (k: string) =>
    detail[k] === undefined || detail[k] === null ? '' : String(detail[k]);
  switch (action) {
    case 'view_user':
      return 'Opened this account';
    case 'view_content':
      return 'Read roles and resume (support access)';
    case 'add_credits':
      return `${Number(d('credits')) >= 0 ? 'Added' : 'Removed'} ${Math.abs(Number(d('credits')))} credits: ${d('reason')}`;
    case 'set_plan':
      return `Plan set to ${d('plan')}${d('reason') ? `: ${d('reason')}` : ''}`;
    case 'suspend':
      return `Suspended: ${d('reason')}`;
    case 'unsuspend':
      return 'Suspension lifted';
    case 'send_login_link':
      return 'Sent a sign-in link';
    case 'recheck_roles':
      return detail['applied'] === true
        ? `Moved ${num(detail['found'])} filed roles that no longer match to Skipped`
        : 'Checked filed roles against the current rules';
    case 'explain_search':
      return 'Checked why their search finds what it finds';
    case 'delete_account':
      return 'Deleted the account';
    case 'delete_account_failed':
      return `Deleting the account failed: ${d('error')}`;
    default:
      return action.replace(/_/g, ' ');
  }
}

export interface AdminMoney {
  revenueMonthUsd: number;
  revenueLastMonthUsd: number;
  refundsMonthUsd: number;
  activePaid: number;
  activeGranted: number;
  cancelling: number;
  cancelled30d: number;
  pastDue: number;
  aiSpendMonthUsd: number;
  /** AI spend as a share of this month's revenue; null without revenue. */
  aiShareOfRevenue: number | null;
  /** Accounts whose AI on credits cost more this month than they paid. */
  overCost: { id: string; email: string; costUsd: number; paidUsd: number }[];
}

export function adminMoney(v: unknown): AdminMoney {
  const o = obj(v);
  return {
    revenueMonthUsd: num(o['revenue_month_usd']),
    revenueLastMonthUsd: num(o['revenue_last_month_usd']),
    refundsMonthUsd: num(o['refunds_month_usd']),
    activePaid: num(o['active_paid']),
    activeGranted: num(o['active_granted']),
    cancelling: num(o['cancelling']),
    cancelled30d: num(o['cancelled_30d']),
    pastDue: num(o['past_due']),
    aiSpendMonthUsd: num(o['ai_spend_month_usd']),
    aiShareOfRevenue:
      o['ai_share_of_revenue'] === null ||
      o['ai_share_of_revenue'] === undefined
        ? null
        : num(o['ai_share_of_revenue']),
    overCost: arr(o['over_cost']).map((x) => ({
      id: str(x['id']),
      email: str(x['email']),
      costUsd: num(x['cost_usd']),
      paidUsd: num(x['paid_usd']),
    })),
  };
}
