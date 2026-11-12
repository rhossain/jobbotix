// POST /functions/v1/preview-search     (signed-in user)
//   Authorization: Bearer <user JWT>
//   { "target_roles"?: [...], "stacks"?: [...], "min_seniority"?: "mid", "days"?: 14 }
//
// What the caller's search would find: their saved search profile, with the
// roles and stacks from the form laid over it (so it can be tried before
// saving), replayed over the last two weeks of postings by the same match
// and score rules the hourly run uses. Counts every step and names the
// strongest matches. Reads only; nothing is saved and no model is called.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { json, serviceClient } from '../_shared/auth.ts';
import { withCors } from '../_shared/cors.ts';
import {
  PROFILE_COLUMNS,
  replayPool,
  toMatchProfile,
} from '../_shared/explain.ts';
import { resolveWeights } from '../_shared/score.ts';

const strings = (v: unknown, max: number, len: number): string[] | null =>
  Array.isArray(v)
    ? [
        ...new Set(
          v
            .filter((x): x is string => typeof x === 'string')
            .map((x) => x.replace(/\s+/g, ' ').trim().slice(0, len))
            .filter(Boolean),
        ),
      ].slice(0, max)
    : null;

Deno.serve(
  withCors(async (req) => {
    if (req.method !== 'POST') return json(405, { error: 'POST only' });
    const jwt = req.headers
      .get('authorization')
      ?.replace(/^Bearer\s+/i, '')
      .trim();
    if (!jwt) return json(401, { error: 'Sign in first' });
    const asUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
        auth: { persistSession: false },
      },
    );
    const { data: userData } = await asUser.auth.getUser();
    if (!userData?.user)
      return json(401, { error: 'Session expired; sign in again' });

    const body = (await req.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const days = Math.min(
      30,
      Math.max(1, Math.trunc(Number(body['days']) || 14)),
    );

    const admin = serviceClient();
    const [{ data: sp }, { data: settings }] = await Promise.all([
      admin
        .from('search_profiles')
        .select(PROFILE_COLUMNS)
        .eq('user_id', userData.user.id)
        .eq('active', true)
        .maybeSingle(),
      admin
        .from('settings')
        .select('key, value')
        .in('key', ['sourcing', 'scoring_defaults']),
    ]);
    const setting = (k: string) =>
      (settings ?? []).find((x) => x.key === k)?.value as
        Record<string, unknown> | undefined;

    // the form's roles and stacks over the saved profile: try before saving
    const profile = toMatchProfile(sp ?? {});
    const roles = strings(body['target_roles'], 12, 80);
    const stacks = strings(body['stacks'], 20, 40);
    if (roles) profile.target_roles = roles;
    if (stacks) profile.stacks = stacks;
    if (typeof body['min_seniority'] === 'string')
      profile.min_seniority = body['min_seniority'].slice(0, 20);
    if (!profile.target_roles.length && !profile.stacks.length)
      return json(400, { error: 'Add a target role or a stack first' });

    const replay = await replayPool(
      admin,
      profile,
      resolveWeights(
        setting('scoring_defaults'),
        (sp as { scoring_weights?: unknown } | null)?.scoring_weights,
      ),
      {
        days,
        threshold: Number(setting('sourcing')?.['min_file_score']) || 30,
        maxPostings: 3200,
      },
    );
    if ('error' in replay) return json(500, { error: replay.error });
    return json(200, replay.result);
  }),
);
