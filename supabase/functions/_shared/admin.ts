// What the admin console may ask for, and the rules about who an admin may
// act on. Pure, so the rules are tested without a database.

export const ADMIN_ACTIONS = [
  'list',
  'export',
  'get',
  'explain_search',
  'money',
  'suspend',
  'unsuspend',
  'login_link',
  'delete',
] as const;
export type AdminAction = (typeof ADMIN_ACTIONS)[number];

export interface ListFilters {
  q: string;
  plan: 'free' | 'pro' | null;
  route: 'own' | 'credits' | 'none' | null;
  limit: number;
  offset: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v);
}

/** The list request, with anything unexpected dropped rather than trusted. */
export function listFilters(body: Record<string, unknown>): ListFilters {
  const int = (v: unknown, min: number, max: number, fallback: number) => {
    const n = typeof v === 'number' ? Math.trunc(v) : NaN;
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  const plan = body['plan'];
  const route = body['route'];
  return {
    q: typeof body['q'] === 'string' ? body['q'].trim().slice(0, 100) : '',
    plan: plan === 'free' || plan === 'pro' ? plan : null,
    route:
      route === 'own' || route === 'credits' || route === 'none' ? route : null,
    limit: int(body['limit'], 1, 500, 50),
    offset: int(body['offset'], 0, 1_000_000, 0),
  };
}

export interface Target {
  id: string;
  email: string;
  is_admin: boolean;
}

/**
 * Why `actor` may not do `action` to `target`, or '' when they may. An admin
 * does not suspend or delete themselves or another admin from here: an admin
 * account is changed by its owner, so one admin cannot lock the others out.
 */
export function refusal(
  action: AdminAction,
  actorId: string,
  target: Target,
  body: Record<string, unknown>,
): string {
  if (action === 'suspend' || action === 'delete') {
    if (target.id === actorId)
      return action === 'delete'
        ? 'Delete your own account from Settings.'
        : 'You cannot suspend your own account.';
    if (target.is_admin)
      return `${target.email} is an admin. An admin account is not ${action === 'delete' ? 'deleted' : 'suspended'} from the console.`;
  }
  if (action === 'suspend') {
    const reason =
      typeof body['reason'] === 'string' ? body['reason'].trim() : '';
    if (reason.length < 3) return 'Give a reason for the suspension.';
    if (reason.length > 500) return 'Keep the reason under 500 characters.';
  }
  if (action === 'delete') {
    const typed =
      typeof body['confirmEmail'] === 'string'
        ? body['confirmEmail'].trim().toLowerCase()
        : '';
    if (typed !== target.email.toLowerCase())
      return "Type the account's email address to confirm the deletion.";
  }
  return '';
}

/** Supabase bans by duration; this is "until an admin lifts it". */
export const BAN_FOREVER = '876000h';
