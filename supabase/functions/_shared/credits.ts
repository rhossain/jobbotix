// The Pro route: AI work on Jobbotix's own Anthropic key, paid for with the
// account's credits (migration 0035).
//
//   reserve()  hold the credits for one job, or learn why not
//   settle()   the model answered: spend the hold and log the call
//   release()  the call failed: the credits go back
//
// The route exists only when the functions have a platform key
// (ANTHROPIC_API_KEY) and an admin has switched settings.pro_ai on; without
// the key none of this makes a single database call.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { AiJobName } from './ai.ts';

type Admin = Pick<SupabaseClient, 'rpc'>;

let testKey: string | null = null;

/** Tests set the platform key here instead of in the environment. */
export function setPlatformKeyForTests(key: string | null) {
  testKey = key;
}

/** Jobbotix's own Anthropic key, or '' when the Pro route does not exist here. */
export function platformKey(): string {
  if (testKey !== null) return testKey;
  try {
    return (Deno.env.get('ANTHROPIC_API_KEY') ?? '').trim();
  } catch {
    // No access to the environment (a test run): no platform key.
    return '';
  }
}

export type RefusalReason =
  'off' | 'own_only' | 'fallback' | 'budget' | 'no_credits' | 'daily_cap';

export type Reservation =
  | {
      ok: true;
      hold: string;
      credits: number;
      model: string;
      /** Credits go before the account's own keys (a paying account). */
      first: boolean;
      balance: number;
    }
  | {
      ok: false;
      reason: RefusalReason;
      first: boolean;
      needed?: number;
      balance?: number;
      resetsAt?: string;
    };

const OFF: Reservation = { ok: false, reason: 'off', first: false };
const REASONS: RefusalReason[] = [
  'off',
  'own_only',
  'fallback',
  'budget',
  'no_credits',
  'daily_cap',
];

/** Reads ai_reserve_credits()'s answer; anything unexpected counts as off. */
export function readReservation(v: unknown): Reservation {
  if (!v || typeof v !== 'object') return OFF;
  const o = v as Record<string, unknown>;
  const first = o['first'] === true;
  if (o['ok'] === true) {
    if (typeof o['hold'] !== 'string' || typeof o['model'] !== 'string')
      return OFF;
    return {
      ok: true,
      hold: o['hold'],
      credits: Number(o['credits'] ?? 0) || 0,
      model: o['model'],
      first,
      balance: Number(o['balance'] ?? 0) || 0,
    };
  }
  const reason = REASONS.includes(o['reason'] as RefusalReason)
    ? (o['reason'] as RefusalReason)
    : 'off';
  return {
    ok: false,
    reason,
    first,
    needed: typeof o['needed'] === 'number' ? o['needed'] : undefined,
    balance: typeof o['balance'] === 'number' ? o['balance'] : undefined,
    resetsAt: typeof o['resets_at'] === 'string' ? o['resets_at'] : undefined,
  };
}

/**
 * Holds the credits for one `job`. With `firstOnly`, an account whose
 * credits are only its fallback (Free, on trial credits) gets no hold yet.
 */
export async function reserve(
  admin: Admin,
  userId: string,
  job: AiJobName,
  firstOnly = false,
): Promise<Reservation> {
  const { data, error } = await admin.rpc('ai_reserve_credits', {
    p_user: userId,
    p_job: job,
    p_first_only: firstOnly,
  });
  if (error) {
    console.error('ai_reserve_credits failed:', error.message);
    return OFF;
  }
  return readReservation(data);
}

/**
 * Closes a hold after the model answered. `charge` false logs and costs the
 * call but gives the credits back (the answer could not be used). Resolves
 * with the balance, or null when it could not be read.
 */
export async function settle(
  admin: Admin,
  hold: string,
  usage: { tokensIn: number; tokensOut: number; webSearches?: number },
  charge = true,
): Promise<number | null> {
  const { data, error } = await admin.rpc('ai_settle_credits', {
    p_hold: hold,
    p_tokens_in: Math.round(usage.tokensIn),
    p_tokens_out: Math.round(usage.tokensOut),
    p_web_searches: Math.round(usage.webSearches ?? 0),
    p_charge: charge,
  });
  if (error) {
    // The hold expires by itself; the call is simply not charged.
    console.error('ai_settle_credits failed:', error.message);
    return null;
  }
  return typeof data === 'number' ? data : null;
}

export async function release(admin: Admin, hold: string): Promise<void> {
  const { error } = await admin.rpc('ai_release_credits', { p_hold: hold });
  if (error) console.error('ai_release_credits failed:', error.message);
}

/**
 * One sentence for an account that wanted to use credits and could not;
 * '' when credits were never an option (the route is off, or the account
 * uses only its own key).
 */
export function creditNote(r: Reservation): string {
  if (r.ok) return '';
  switch (r.reason) {
    case 'no_credits':
      return typeof r.needed === 'number' && r.needed > 0
        ? `This needs ${r.needed} AI ${r.needed === 1 ? 'credit' : 'credits'} and you have ${Math.max(0, r.balance ?? 0)}. Add credits, or connect your own key in Settings.`
        : 'You have no AI credits left. Add credits, or connect your own key in Settings.';
    case 'daily_cap':
      return "You reached today's limit for AI on credits; it resets at midnight UTC. Your own key in Settings has no such limit.";
    case 'budget':
      return 'AI on credits is paused for now. Connect your own key in Settings to keep going, or try again later.';
    default:
      return '';
  }
}
