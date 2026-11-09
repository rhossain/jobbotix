// POST /functions/v1/prep-role     (signed-in user)
//   Authorization: Bearer <user JWT>
//   { "roleId": "...", "model"?: "claude-..." }
//
// Builds the interview prep sheet for one role from the master resume and
// the posting: model on the user's Vault key (metered in ai_usage as
// 'prep'), local templates otherwise. The user's own notes and practised
// ticks on the previous sheet are carried over.

import { DEFAULT_MODEL } from '../_shared/models.ts';
import { callMessages } from '../_shared/anthropic.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { json, serviceClient } from '../_shared/auth.ts';
import { withCors } from '../_shared/cors.ts';
import { normaliseResume } from '../_shared/resume.ts';
import {
  localPrep,
  normalisePrep,
  parsePrepReply,
  prepPrompt,
  type PrepSheet,
} from '../_shared/prep.ts';
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
      model?: string;
    };
    if (!body.roleId) return json(400, { error: 'roleId is required' });
    const roleId = body.roleId;

    const admin = serviceClient();
    const [{ data: role }, { data: master }, { data: profile }] =
      await Promise.all([
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
          .from('profiles')
          .select('anthropic_key_ref, default_model')
          .eq('id', userId)
          .maybeSingle(),
      ]);
    if (!role) return json(404, { error: 'Role not found' });
    if (!master) return json(422, { error: 'Save a master resume first' });

    const resume = normaliseResume(master.sections);
    const posting = {
      company: role.company,
      title: role.title,
      text:
        role.posting_text ||
        [role.title, role.company, ...(role.stack ?? [])].join('\n'),
      stack: role.stack ?? [],
      reasons: role.reasons ?? [],
      gaps: role.gaps ?? [],
    };
    const previous = normalisePrep(role.prep);

    let sheet: PrepSheet = localPrep(resume, posting);
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
        DEFAULT_MODEL;
      try {
        const ai = await callMessages(
          apiKey,
          {
            model,
            max_tokens: 3000,
            messages: [{ role: 'user', content: prepPrompt(resume, posting) }],
          },
          90_000,
        );
        const payload = await ai.json();
        const reply = Array.isArray(payload?.content)
          ? payload.content.map((c: { text?: string }) => c.text ?? '').join('')
          : '';
        const parsed = parsePrepReply(reply);
        if (parsed) {
          sheet = {
            ...parsed,
            generatedAt: new Date().toISOString(),
            method: 'ai',
            model,
          };
        }
        const u = payload?.usage ?? {};
        await admin.from('ai_usage').insert({
          user_id: userId,
          job: 'prep',
          model,
          tokens_in: Number(u.input_tokens ?? 0),
          tokens_out: Number(u.output_tokens ?? 0),
          cost_usd: 0,
        });
      } catch {
        /* the local sheet stands */
      }
    }
    // Keep what the user wrote and ticked.
    sheet.userNotes = previous.userNotes;
    const practised = new Set(
      previous.questions.filter((q) => q.practised).map((q) => q.question),
    );
    sheet.questions = sheet.questions.map((q) => ({
      ...q,
      practised: practised.has(q.question),
    }));

    const { error } = await admin
      .from('roles')
      .update({ prep: sheet })
      .eq('id', roleId)
      .eq('user_id', userId);
    if (error) return json(500, { error: error.message });
    await admin.from('role_events').insert({
      user_id: userId,
      role_id: roleId,
      kind: 'generated',
      payload: {
        what: 'interview prep',
        method: sheet.method,
        model: sheet.model,
      },
    });
    return json(200, { prep: sheet });
  }),
);
