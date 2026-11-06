// POST /functions/v1/answer-screening     (signed-in user)
//   Authorization: Bearer <user JWT>
//   { "roleId": "...", "ids"?: ["..."], "model"?: "claude-..." }
//
// Writes answers for the role's screening questions (the given ids, or every
// question whose answer is empty) from the master resume. With an Anthropic
// key in Vault the model answers the batch in one call (metered in ai_usage);
// without one the local templates do, flagged with [edit] where a fact is
// missing. Existing non-empty answers are never overwritten unless listed.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { json, serviceClient } from '../_shared/auth.ts';
import { withCors } from '../_shared/cors.ts';
import { normaliseResume } from '../_shared/resume.ts';
import {
  localAnswer,
  parseScreeningReply,
  screeningPrompt,
} from '../_shared/screening.ts';
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

    const body = (await req.json().catch(() => ({}))) as {
      roleId?: string;
      ids?: unknown;
      model?: string;
    };
    if (!body.roleId) return json(400, { error: 'roleId is required' });
    const roleId = body.roleId;
    const wanted = Array.isArray(body.ids)
      ? new Set(body.ids.filter((x): x is string => typeof x === 'string'))
      : null;

    const admin = serviceClient();
    const [
      { data: role },
      { data: master },
      { data: rows },
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
        .from('screening_answers')
        .select('*')
        .eq('role_id', roleId)
        .eq('user_id', userId)
        .order('position'),
      admin
        .from('profiles')
        .select('anthropic_key_ref, default_model')
        .eq('id', userId)
        .maybeSingle(),
    ]);
    if (!role) return json(404, { error: 'Role not found' });
    if (!master) return json(422, { error: 'Save a master resume first' });

    const all = rows ?? [];
    const targets = all.filter((r) =>
      wanted ? wanted.has(r.id) : !r.answer.trim(),
    );
    if (targets.length === 0)
      return json(200, { answered: 0, method: 'local' });

    const resume = normaliseResume(master.sections);
    const posting = {
      company: role.company,
      title: role.title,
      text: role.posting_text || '',
      stack: role.stack ?? [],
    };
    const answers = new Map<string, string>(
      targets.map((t) => [t.id, localAnswer(t.question, resume, posting)]),
    );
    let method: 'ai' | 'local' = 'local';
    let model = '';
    const apiKey = profile?.anthropic_key_ref
      ? await readVaultSecret(admin, profile.anthropic_key_ref)
      : null;
    if (apiKey) {
      model =
        (typeof body.model === 'string' &&
        /^claude-[a-z0-9-]+$/.test(body.model)
          ? body.model
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
            max_tokens: 1500,
            messages: [
              {
                role: 'user',
                content: screeningPrompt({
                  resume,
                  posting,
                  questions: targets.map((t) => ({
                    id: t.id,
                    question: t.question,
                  })),
                  existing: all
                    .filter((r) => r.answer.trim() && !answers.has(r.id))
                    .map((r) => ({ question: r.question, answer: r.answer })),
                }),
              },
            ],
          }),
          signal: AbortSignal.timeout(60_000),
        });
        const payload = await ai.json();
        const reply = Array.isArray(payload?.content)
          ? payload.content.map((c: { text?: string }) => c.text ?? '').join('')
          : '';
        const parsed = parseScreeningReply(reply, targets);
        if (parsed.size) {
          for (const [id, a] of parsed) if (a) answers.set(id, a);
          method = 'ai';
        }
        const u = payload?.usage ?? {};
        await admin.from('ai_usage').insert({
          user_id: userId,
          job: 'answer',
          model,
          tokens_in: Number(u.input_tokens ?? 0),
          tokens_out: Number(u.output_tokens ?? 0),
          cost_usd: 0,
        });
      } catch {
        /* local answers stand */
      }
    }

    for (const [id, answer] of answers) {
      const { error } = await admin
        .from('screening_answers')
        .update({ answer })
        .eq('id', id)
        .eq('user_id', userId);
      if (error) return json(500, { error: error.message });
    }
    await admin.from('role_events').insert({
      user_id: userId,
      role_id: roleId,
      kind: 'generated',
      payload: {
        what: 'screening answers',
        count: answers.size,
        method,
        model: method === 'ai' ? model : undefined,
      },
    });
    return json(200, {
      answered: answers.size,
      method,
      model: method === 'ai' ? model : undefined,
    });
  }),
);
