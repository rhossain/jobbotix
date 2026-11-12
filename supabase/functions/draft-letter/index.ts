// POST /functions/v1/draft-letter     (signed-in user)
//   Authorization: Bearer <user JWT>
//   { "roleId": "...", "model"?: "claude-...", "rewrite"?: true }
//
// Drafts (or rewrites) the cover letter for one role from the master resume
// and the user's voice samples. With an AI connection the model writes it
// (metered in ai_usage); without one, or when every connection fails, the
// local template does and `aiNote` says why.
// The result lands on roles.cover_letter and in cover_letters (one draft per
// role) so the Fit tab and the history agree.

import { aiNote, runAi } from '../_shared/ai.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { json, serviceClient } from '../_shared/auth.ts';
import { withCors } from '../_shared/cors.ts';
import { normaliseResume } from '../_shared/resume.ts';
import { resumeContext } from '../_shared/resume-context.ts';
import {
  LETTER_MIN_WORDS,
  letterPrompt,
  localLetter,
  parseLetterReply,
  wordCount,
} from '../_shared/letter.ts';
import { requireAiJob } from '../_shared/gate.ts';

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
      rewrite?: boolean;
    };
    if (!body.roleId) return json(400, { error: 'roleId is required' });
    const roleId = body.roleId;

    const admin = serviceClient();
    const gate = await requireAiJob(admin, userId, 'letter');
    if (gate instanceof Response) return gate;
    const [{ data: role }, { data: master }, { data: samples }] =
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
          .from('cover_letters')
          .select('body')
          .eq('user_id', userId)
          .eq('voice_sample', true)
          .order('created_at', { ascending: true })
          .limit(3),
      ]);
    if (!role) return json(404, { error: 'Role not found' });
    if (!master) return json(422, { error: 'Save a master resume first' });

    const ctx = {
      resume: normaliseResume(master.sections),
      posting: {
        company: role.company,
        title: role.title,
        text:
          role.posting_text ||
          [role.title, role.company, ...(role.stack ?? [])].join('\n'),
        stack: role.stack ?? [],
        reasons: role.reasons ?? [],
        gaps: role.gaps ?? [],
      },
      voiceSamples: (samples ?? []).map((s: { body: string }) => s.body),
      current: body.rewrite ? role.cover_letter : '',
    };

    let text = localLetter(ctx);
    let method: 'ai' | 'local' = 'local';
    let model = '';
    let provider = '';
    const ai = await runAi(
      admin,
      userId,
      {
        context: resumeContext(ctx.resume),
        prompt: letterPrompt(ctx),
        maxTokens: 1200,
        timeoutMs: 60_000,
      },
      {
        job: 'letter',
        choice: body.model,
        parse: (reply) => {
          const cleaned = parseLetterReply(reply);
          return wordCount(cleaned) >= LETTER_MIN_WORDS / 2 ? cleaned : null;
        },
      },
    );
    if (ai.ok) {
      text = ai.value;
      method = 'ai';
      model = ai.model;
      provider = ai.provider;
    }

    const { error: rErr } = await admin
      .from('roles')
      .update({ cover_letter: text })
      .eq('id', roleId)
      .eq('user_id', userId);
    if (rErr) return json(500, { error: rErr.message });
    const { data: existing } = await admin
      .from('cover_letters')
      .select('id')
      .eq('role_id', roleId)
      .eq('voice_sample', false)
      .maybeSingle();
    const row = {
      user_id: userId,
      role_id: roleId,
      body: text,
      status: 'draft' as const,
      voice_sample: false,
    };
    const saved = existing
      ? await admin.from('cover_letters').update(row).eq('id', existing.id)
      : await admin.from('cover_letters').insert(row);
    if (saved.error) return json(500, { error: saved.error.message });

    await admin.from('role_events').insert({
      user_id: userId,
      role_id: roleId,
      kind: 'generated',
      payload: {
        what: 'cover letter',
        method,
        model: method === 'ai' ? model : undefined,
        provider: method === 'ai' ? provider : undefined,
      },
    });
    return json(200, {
      body: text,
      method,
      model: method === 'ai' ? model : undefined,
      provider: method === 'ai' ? provider : undefined,
      aiNote: aiNote(ai, 'This draft was written without a model.'),
    });
  }),
);
