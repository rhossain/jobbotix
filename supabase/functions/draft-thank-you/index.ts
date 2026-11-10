// POST /functions/v1/draft-thank-you     (signed-in user)
//   Authorization: Bearer <user JWT>
//   { "interviewId": "...", "model"?: "provider:model" }
//
// Drafts the thank-you note for one interview round from the user's debrief,
// the interviewers' names and their voice samples. With an AI connection the
// model writes it (metered in ai_usage as 'thank_you'); without one, or when
// every connection fails, the local template does, with one bracket for the
// user to fill in, and `aiNote` says why. The
// note lands on interviews.thank_you.

import { aiNote, runAi } from '../_shared/ai.ts';
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
      interviewId?: string;
      model?: string;
    };
    if (!body.interviewId)
      return json(400, { error: 'interviewId is required' });

    const admin = serviceClient();
    const gate = await requireAiJob(admin, userId, 'thank_you');
    if (gate instanceof Response) return gate;
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
      admin.from('profiles').select('name').eq('id', userId).maybeSingle(),
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
    let provider = '';
    const ai = await runAi(
      admin,
      userId,
      { prompt: thankYouPrompt(ctx), maxTokens: 600, timeoutMs: 45_000 },
      {
        job: 'thank_you',
        choice: body.model,
        parse: (reply) => {
          const cleaned = parseThankYouReply(reply);
          return cleaned.split(/\s+/).length >= 30 ? cleaned : null;
        },
      },
    );
    if (ai.ok) {
      text = ai.value;
      method = 'ai';
      model = ai.model;
      provider = ai.provider;
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
      provider: method === 'ai' ? provider : undefined,
      aiNote: aiNote(ai, 'This note was written without a model.'),
    });
  }),
);
