// POST /functions/v1/score-role     (signed-in user)
//   Authorization: Bearer <user JWT>
//   { "roleId": "..." }
//
// Scores (or re-scores) one of the caller's roles against their current
// search profile: the keyword pass, the run's rules, and the model on the
// user's Vault key when there is one (metered in ai_usage as 'score'). Used
// for roles added by hand before scoring on add existed, and after the
// profile or the posting text changes. Replies with the updated role.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { json, serviceClient } from '../_shared/auth.ts';
import { withCors } from '../_shared/cors.ts';
import { scoreRole } from '../_shared/role-score.ts';
import { readVaultSecret } from '../_shared/vault.ts';

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
    const userId = userData.user.id;

    const body = (await req.json().catch(() => ({}))) as { roleId?: string };
    if (!body.roleId) return json(400, { error: 'roleId is required' });
    const roleId = body.roleId;

    const admin = serviceClient();
    const [{ data: role }, { data: profile }] = await Promise.all([
      admin
        .from('roles')
        .select('*')
        .eq('id', roleId)
        .eq('user_id', userId)
        .maybeSingle(),
      admin
        .from('profiles')
        .select('anthropic_key_ref')
        .eq('id', userId)
        .maybeSingle(),
    ]);
    if (!role) return json(404, { error: 'Role not found' });
    if ((role.posting_text ?? '').length < 80)
      return json(422, {
        error:
          'This role has no posting text to score. Add it from the posting link again, pasting the text.',
      });

    const apiKey = profile?.anthropic_key_ref
      ? await readVaultSecret(admin, profile.anthropic_key_ref)
      : null;
    const result = await scoreRole(
      admin,
      userId,
      {
        company: role.company,
        title: role.title,
        location: role.location,
        type: role.type,
        salary: role.salary,
        posting_text: role.posting_text,
        stack: role.stack ?? [],
        posted_at: role.posted_at,
        // The pool's reading of where a filed role can be done from is better
        // than a guess from the text; keep it.
        remote:
          role.posting_id && role.remote_policy !== 'unknown'
            ? {
                remote_policy: role.remote_policy,
                hiring_countries: role.hiring_countries ?? [],
                hiring_regions: [],
              }
            : undefined,
      },
      apiKey,
    );
    if ('error' in result) return json(422, { error: result.error });

    // A role the run filed keeps where it came from; only the scoring changes.
    const { data: updated, error } = await admin
      .from('roles')
      .update({
        ...result.fields,
        score_breakdown: {
          ...result.fields.score_breakdown,
          added_by_hand: role.source === 'Added by hand',
        },
      })
      .eq('id', roleId)
      .eq('user_id', userId)
      .select('*')
      .single();
    if (error || !updated)
      return json(500, { error: error?.message ?? 'update failed' });

    await admin.from('role_events').insert({
      user_id: userId,
      role_id: roleId,
      kind: 'generated',
      payload: {
        what: 'match score',
        score: result.fields.score,
        previous: role.score,
        method: result.method,
        model: result.model,
      },
    });

    return json(200, {
      role: updated,
      method: result.method,
      model: result.model,
      aiError: result.aiError,
    });
  }),
);
