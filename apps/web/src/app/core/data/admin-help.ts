// Reading admin_help's and admin_set_help_ai's answers into typed objects,
// with sensible values for anything missing.

import type { AdminHelp, HelpAiSettings } from './repos';

const num = (v: unknown, d = 0) =>
  typeof v === 'number' && Number.isFinite(v)
    ? v
    : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))
      ? Number(v)
      : d;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const obj = (v: unknown) =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const list = (v: unknown) => (Array.isArray(v) ? v.map(obj) : []);

export function readHelpSettings(v: unknown): HelpAiSettings {
  const s = obj(v);
  return {
    enabled: s['enabled'] !== false,
    monthly_budget_usd: num(s['monthly_budget_usd'], 5),
    daily_free: num(s['daily_free'], 10),
    daily_pro: num(s['daily_pro'], 100),
    daily_own: num(s['daily_own'], 30),
    model: str(s['model']),
  };
}

export function readAdminHelp(v: unknown): AdminHelp {
  const d = obj(v);
  const t = obj(d['totals']);
  return {
    settings: readHelpSettings(d['settings']),
    monthSpendUsd: num(d['month_spend_usd']),
    monthAnswers: num(d['month_answers']),
    totals: {
      asked: num(t['asked']),
      own: num(t['own']),
      platform: num(t['platform']),
      articles: num(t['articles']),
      not_found: num(t['not_found']),
      yes: num(t['yes']),
      no: num(t['no']),
      people: num(t['people']),
    },
    mostAsked: list(d['most_asked']).map((m) => ({
      question: str(m['question']),
      times: num(m['times']),
      not_found: num(m['not_found']),
      no: num(m['no']),
      last: str(m['last']),
    })),
    questions: list(d['questions']).map((q) => ({
      id: str(q['id']),
      question: str(q['question']),
      page: str(q['page']),
      route:
        q['route'] === 'own' || q['route'] === 'platform'
          ? q['route']
          : 'articles',
      found: q['found'] !== false,
      feedback:
        q['feedback'] === 'yes' || q['feedback'] === 'no'
          ? q['feedback']
          : null,
      articles: Array.isArray(q['articles'])
        ? q['articles'].filter((a): a is string => typeof a === 'string')
        : [],
      model: str(q['model']),
      created_at: str(q['created_at']),
    })),
    tickets: list(d['tickets']).map((k) => ({
      id: str(k['id']),
      user_id: str(k['user_id']) || null,
      email: str(k['email']) || null,
      message: str(k['message']),
      page: str(k['page']),
      created_at: str(k['created_at']),
      emailed_at: str(k['emailed_at']) || null,
    })),
  };
}
