// The one place an Edge Function asks "may this account do that?". It reads
// the database's entitlements_for() (migration 0033) with the service role
// and answers 402 with an upgrade hint when the plan does not cover the call.
//
// Billing is off by default, and then every account has every feature, so
// wiring this in changes nothing until an admin switches billing on. If the
// lookup itself fails the call goes ahead: a database hiccup must not lock
// anyone out of a feature they pay for.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  can,
  featureForJob,
  normaliseEntitlements,
  OPEN_ENTITLEMENTS,
  reviewsLeft,
  SUSPENDED,
  upgradeRequired,
  type Entitlements,
  type Feature,
  type GatedAiJob,
  type UseKey,
} from './entitlements.ts';

/** The slice of the Supabase client the gate uses; lets tests pass a fake. */
export type RpcClient = Pick<SupabaseClient, 'rpc'>;

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

export async function loadEntitlements(
  admin: RpcClient,
  userId: string,
): Promise<Entitlements> {
  try {
    const { data, error } = await admin.rpc('entitlements_for', {
      p_user: userId,
    });
    if (error) {
      console.warn(`entitlements_for failed: ${error.message}`);
      return OPEN_ENTITLEMENTS;
    }
    return normaliseEntitlements(data);
  } catch (e) {
    console.warn(
      `entitlements_for failed: ${e instanceof Error ? e.message : e}`,
    );
    return OPEN_ENTITLEMENTS;
  }
}

/**
 * The 403 for a suspended account or the 402 for a feature the plan lacks;
 * null when the call may go ahead.
 */
export function blockedResponse(
  e: Entitlements,
  feature: Feature,
): Response | null {
  if (e.suspended) return reply(403, SUSPENDED);
  return can(e, feature) ? null : reply(402, upgradeRequired(e, feature));
}

/**
 * Resolves to the account's entitlements when it may use `feature`, or to a
 * ready-made 402 Response when it may not:
 *
 *   const gate = await requireFeature(admin, userId, 'company_research');
 *   if (gate instanceof Response) return gate;
 */
export async function requireFeature(
  admin: RpcClient,
  userId: string,
  feature: Feature,
): Promise<Entitlements | Response> {
  const e = await loadEntitlements(admin, userId);
  return blockedResponse(e, feature) ?? e;
}

/**
 * For an AI review of the resume: the 402 once the plan's allowance of
 * reviews is used up (Free gets one, Pro and early accounts are not
 * counted); null while a review may go ahead.
 */
export function reviewBlocked(e: Entitlements): Response | null {
  if (e.suspended) return reply(403, SUSPENDED);
  return reviewsLeft(e) === 0
    ? reply(402, upgradeRequired(e, 'resume_review'))
    : null;
}

/**
 * Counts one use of something a plan limits by count (feature_uses). A
 * failure is logged and not passed on: the user already has what they asked
 * for, and losing one count is better than failing their call.
 */
export async function countUse(
  admin: RpcClient,
  userId: string,
  key: UseKey,
): Promise<void> {
  try {
    const { error } = await admin.rpc('count_feature_use', {
      p_user: userId,
      p_key: key,
    });
    if (error) console.warn(`count_feature_use failed: ${error.message}`);
  } catch (e) {
    console.warn(
      `count_feature_use failed: ${e instanceof Error ? e.message : e}`,
    );
  }
}

/** requireFeature for the feature an AI job needs. */
export function requireAiJob(
  admin: RpcClient,
  userId: string,
  job: GatedAiJob,
): Promise<Entitlements | Response> {
  return requireFeature(admin, userId, featureForJob(job));
}
