// POST /functions/v1/draft-thank-you     (signed-in user)
//   Authorization: Bearer <user JWT>
//   { "interviewId": "...", "model"?: "claude-..." }
//
// Drafts the thank-you note for one interview round from the user's debrief,
// the interviewers' names and their voice samples. With an Anthropic key in
// Vault the model writes it (metered in ai_usage as 'thank_you'); without one
// the local template does, with one bracket for the user to fill in. The
// note lands on interviews.thank_you.

import { DEFAULT_MODEL } from '../_shared/models.ts';
import { callMessages } from '../_shared/anthropic.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { json, serviceClient } from '../_shared/auth.ts';
import { withCors } from '../_shared/cors.ts';
import { normaliseResume } from '../_shared/resume.ts';
import {
  localThankYou,
  parseThankYouReply,
  thankYouPrompt,
  type InterviewKind,
  type ThankYouContext,
} from '../_shared/interviews.ts';
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
      interviewId?: string;
      model?: string;
    };
    if (!body.interviewId)
      return json(400, { error: 'interviewId is required' });

    const admin = serviceClient();
    const { data: iv } = await admin
      .from('interviews')
      .select('id, role_id, kind, interviewers, debrief')
      .eq('id', body.interviewId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!iv) return json(404, { error: 'Interview not found' });

    const [
      { data: role },
      { data: master },
      { data: samples },
      { data: profile },
    ] = await Promise.all([
      admin
        .from('roles')
        .select('company, title')
        .eq('id', iv.role_id)
        .eq('user_id', userId)
        .maybeSingle(),
      admin
        .from('resumes')
        .select('sections')
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
      admin
        .from('profiles')
        .select('name, anthropic_key_ref, default_model')
        .eq('id', userId)
        .maybeSingle(),
    ]);
    if (!role) return json(404, { error: 'Role not found' });

    const ctx: ThankYouContext = {
      candidate:
        (master ? normaliseResume(master.sections).contact.name : '') ||
        profile?.name ||
        '',
      company: role.company,
      roleTitle: role.title,
      kind: iv.kind as InterviewKind,
      interviewers: iv.interviewers ?? '',
      debrief: iv.debrief ?? '',
      voiceSamples: (samples ?? []).map((s: { body: string }) => s.body),
    };

    let text = localThankYou(ctx);
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
        DEFAULT_MODEL;
      try {
        const ai = await callMessages(
          apiKey,
          {
            model,
            max_tokens: 600,
            messages: [{ role: 'user', content: thankYouPrompt(ctx) }],
          },
          45_000,
        );
        const payload = await ai.json();
        const reply = Array.isArray(payload?.content)
          ? payload.content.map((c: { text?: string }) => c.text ?? '').join('')
          : '';
        const cleaned = parseThankYouReply(reply);
        if (cleaned.split(/\s+/).length >= 30) {
          text = cleaned;
          method = 'ai';
        }
        const u = payload?.usage ?? {};
        await admin.from('ai_usage').insert({
          user_id: userId,
          job: 'thank_you',
          model,
          tokens_in: Number(u.input_tokens ?? 0),
          tokens_out: Number(u.output_tokens ?? 0),
          cost_usd: 0,
        });
      } catch {
        /* the local draft stands */
      }
    }

    const { error } = await admin
      .from('interviews')
      .update({ thank_you: text })
      .eq('id', iv.id)
      .eq('user_id', userId);
    if (error) return json(500, { error: error.message });

    return json(200, {
      body: text,
      method,
      model: method === 'ai' ? model : undefined,
    });
  }),
);
