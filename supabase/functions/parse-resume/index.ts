// POST /functions/v1/parse-resume     (signed-in user)
//   Authorization: Bearer <user JWT>
//   { "text": "...resume text...", "model"?: "claude-..." }
//
// Reads resume text into ResumeSections with the user's own Anthropic key
// (metered in ai_usage). The browser already parsed the text locally; this
// is the opt-in second opinion for layouts the built-in reader gets wrong.
// Nothing is stored: the user reviews the result before it touches the
// master. Without a key on file it answers 422 and the browser keeps its
// local result.

import { DEFAULT_MODEL } from '../_shared/models.ts';
import { callMessages } from '../_shared/anthropic.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { json, serviceClient } from '../_shared/auth.ts';
import { withCors } from '../_shared/cors.ts';
import {
  parseResumeImportReply,
  RESUME_AI_MAX_CHARS,
  resumeImportPrompt,
} from '../_shared/resume-ai.ts';
import { requireAiJob } from '../_shared/gate.ts';
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

    const { text, model: modelOverride } = (await req
      .json()
      .catch(() => ({}))) as { text?: unknown; model?: unknown };
    if (typeof text !== 'string' || text.trim().length < 40)
      return json(400, { error: 'Send the resume text to read' });
    if (text.length > RESUME_AI_MAX_CHARS)
      return json(413, {
        error: 'That text is longer than any resume; trim it and try again',
      });

    const admin = serviceClient();
    const gate = await requireAiJob(admin, userId, 'import');
    if (gate instanceof Response) return gate;
    const { data: profile } = await admin
      .from('profiles')
      .select('anthropic_key_ref, default_model')
      .eq('id', userId)
      .maybeSingle();
    const apiKey = profile?.anthropic_key_ref
      ? await readVaultSecret(admin, profile.anthropic_key_ref)
      : null;
    if (!apiKey)
      return json(422, {
        error: 'Add your Anthropic key in Settings to read resumes with AI',
      });

    const model =
      (typeof modelOverride === 'string' &&
      /^claude-[a-z0-9-]+$/.test(modelOverride)
        ? modelOverride
        : '') ||
      profile?.default_model ||
      DEFAULT_MODEL;

    let reply = '';
    try {
      const ai = await callMessages(
        apiKey,
        {
          model,
          max_tokens: 8000,
          temperature: 0,
          messages: [{ role: 'user', content: resumeImportPrompt(text) }],
        },
        90_000,
      );
      const payload = await ai.json();
      if (!ai.ok)
        return json(502, {
          error:
            payload?.error?.message ??
            `The model could not be reached (${ai.status})`,
        });
      reply = Array.isArray(payload?.content)
        ? payload.content.map((c: { text?: string }) => c.text ?? '').join('')
        : '';
      const u = payload?.usage ?? {};
      await admin.from('ai_usage').insert({
        user_id: userId,
        job: 'import',
        model,
        tokens_in: Number(u.input_tokens ?? 0),
        tokens_out: Number(u.output_tokens ?? 0),
        cost_usd: 0,
      });
    } catch {
      return json(504, { error: 'The model took too long; try again' });
    }

    const result = parseResumeImportReply(reply, text);
    if (!result)
      return json(502, {
        error: 'The model did not return a readable resume; try again',
      });
    return json(200, { ...result, model });
  }),
);
