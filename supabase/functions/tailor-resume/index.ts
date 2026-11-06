// POST /functions/v1/tailor-resume     (signed-in user)
//   Authorization: Bearer <user JWT>
//   { "roleId": "..." }
//
// Proposes resume changes for one role from the user's master resume. With an
// Anthropic key in Vault the model proposes them (metered in ai_usage);
// without one the local heuristics do. Decisions already made on identical
// proposals are kept, so a regenerate never throws the user's work away.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { json, serviceClient } from '../_shared/auth.ts';
import { withCors } from '../_shared/cors.ts';
import { normaliseResume } from '../_shared/resume.ts';
import {
  applyVariant,
  keywordReport,
  localTailor,
  parseVariantReply,
  tailorPrompt,
  type VariantChange,
  type VariantDiff,
} from '../_shared/variant.ts';

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

    const { roleId, model: modelOverride } = (await req
      .json()
      .catch(() => ({}))) as {
      roleId?: string;
      model?: string;
    };
    if (!roleId) return json(400, { error: 'roleId is required' });

    const admin = serviceClient();
    const [
      { data: role },
      { data: master },
      { data: existing },
      { data: profile },
    ] = await Promise.all([
      admin
        .from('roles')
        .select('*')
        .eq('id', roleId)
        .eq('user_id', userId)
        .maybeSingle(),
      admin
        .from('resumes')
        .select('*')
        .eq('user_id', userId)
        .eq('is_master', true)
        .maybeSingle(),
      admin
        .from('resume_variants')
        .select('*')
        .eq('role_id', roleId)
        .eq('user_id', userId)
        .maybeSingle(),
      admin
        .from('profiles')
        .select('anthropic_key_ref, default_model')
        .eq('id', userId)
        .maybeSingle(),
    ]);
    if (!role) return json(404, { error: 'Role not found' });
    if (!master) return json(422, { error: 'Save a master resume first' });

    const sections = normaliseResume(master.sections);
    const postingText =
      role.posting_text ||
      [
        role.title,
        role.company,
        ...(role.stack ?? []),
        ...(role.reasons ?? []),
      ].join('\n');
    const posting = {
      company: role.company,
      title: role.title,
      text: postingText,
      stack: role.stack ?? [],
    };

    let proposals = localTailor(sections, posting);
    let method: 'ai' | 'local' = 'local';
    const apiKey = profile?.anthropic_key_ref
      ? await readVaultSecret(admin, profile.anthropic_key_ref)
      : null;
    if (apiKey) {
      const model =
        (typeof modelOverride === 'string' &&
        /^claude-[a-z0-9-]+$/.test(modelOverride)
          ? modelOverride
          : '') ||
        profile?.default_model ||
        'claude-sonnet-4-5';
      try {
        const ai = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model,
            max_tokens: 2500,
            messages: [
              { role: 'user', content: tailorPrompt(sections, posting) },
            ],
          }),
          signal: AbortSignal.timeout(60_000),
        });
        const payload = await ai.json();
        const reply = Array.isArray(payload?.content)
          ? payload.content.map((c: { text?: string }) => c.text ?? '').join('')
          : '';
        const parsed = parseVariantReply(reply, sections);
        if (parsed.length) {
          proposals = parsed;
          method = 'ai';
        }
        const u = payload?.usage ?? {};
        await admin.from('ai_usage').insert({
          user_id: userId,
          job: 'tailor',
          model,
          tokens_in: Number(u.input_tokens ?? 0),
          tokens_out: Number(u.output_tokens ?? 0),
          cost_usd: 0,
        });
      } catch {
        /* local proposals stand */
      }
    }

    const prior = ((existing?.diff as VariantDiff | null)?.changes ??
      []) as VariantChange[];
    const changes: VariantChange[] = proposals.map((c) => {
      const same = prior.find(
        (p) => p.path === c.path && p.kind === c.kind && p.after === c.after,
      );
      return {
        ...c,
        id: crypto.randomUUID(),
        decision: same?.decision ?? 'pending',
      };
    });
    const diff: VariantDiff = { baseResumeId: master.id, changes };
    const applied = applyVariant(sections, diff);
    const row = {
      user_id: userId,
      role_id: roleId,
      base_resume_id: master.id,
      sections: applied,
      diff,
      keyword_report: keywordReport(postingText, applied),
      status: 'draft' as const,
    };

    const saved = existing
      ? await admin
          .from('resume_variants')
          .update(row)
          .eq('id', existing.id)
          .select('*')
          .single()
      : await admin.from('resume_variants').insert(row).select('*').single();
    if (saved.error) return json(500, { error: saved.error.message });

    await admin.from('role_events').insert({
      user_id: userId,
      role_id: roleId,
      kind: 'generated',
      payload: { what: 'resume variant', method },
    });
    return json(200, {
      variant: saved.data,
      method,
      model:
        method === 'ai'
          ? (typeof modelOverride === 'string' && modelOverride) ||
            profile?.default_model ||
            'claude-sonnet-4-5'
          : undefined,
    });
  }),
);

async function readVaultSecret(
  admin: ReturnType<typeof serviceClient>,
  name: string,
): Promise<string | null> {
  const { data } = await admin
    .schema('vault')
    .from('decrypted_secrets')
    .select('decrypted_secret')
    .eq('name', name)
    .maybeSingle();
  return (
    (data as { decrypted_secret?: string } | null)?.decrypted_secret ?? null
  );
}
