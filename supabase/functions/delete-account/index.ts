// POST /functions/v1/delete-account     (signed-in user)
//   Authorization: Bearer <user JWT>
//   { "confirm": true }
//
// Deletes the caller's account: their Anthropic key in Vault, then the auth
// user, which cascades through profiles to every row they own (roles,
// resumes, letters, interviews, people, usage, keys, shares). The shared
// postings pool and companies are not personal data and stay. An admin
// cannot delete themselves while other accounts exist, so the instance
// always has someone to run it.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { json, serviceClient } from '../_shared/auth.ts';
import { withCors } from '../_shared/cors.ts';

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

    const body = (await req.json().catch(() => ({}))) as { confirm?: boolean };
    if (body.confirm !== true)
      return json(400, { error: 'Send { "confirm": true } to delete' });

    const admin = serviceClient();
    const { data: profile } = await admin
      .from('profiles')
      .select('is_admin, anthropic_key_ref')
      .eq('id', userId)
      .maybeSingle();

    if (profile?.is_admin) {
      const { count } = await admin
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .neq('id', userId);
      if ((count ?? 0) > 0)
        return json(409, {
          error:
            'You run this Jobbotix and others use it. Make another account admin first, then delete yours.',
        });
    }

    if (profile?.anthropic_key_ref) {
      const { error } = await admin.rpc('vault_delete_secret', {
        p_name: profile.anthropic_key_ref,
      });
      if (error) return json(500, { error: `Key: ${error.message}` });
    }

    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) return json(500, { error: error.message });
    return json(200, { deleted: true });
  }),
);
