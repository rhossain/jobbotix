// POST /functions/v1/parse-resume     (signed-in user)
//   Authorization: Bearer <user JWT>
//   { "text": "...resume text...", "model"?: "provider:model" }
//
// Reads resume text into ResumeSections on one of the user's AI connections
// (metered in ai_usage). The browser already parsed the text locally; this
// is the opt-in second opinion for layouts the built-in reader gets wrong.
// Nothing is stored: the user reviews the result before it touches the
// master. Without a connection it answers 422, and 429 or 502 when
// every connection is rate limited or fails; the browser keeps its local
// result.

import { runAi } from '../_shared/ai.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { json, serviceClient } from '../_shared/auth.ts';
import { withCors } from '../_shared/cors.ts';
import {
  parseResumeImportReply,
  RESUME_AI_MAX_CHARS,
  resumeImportPrompt,
} from '../_shared/resume-ai.ts';
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
    const ai = await runAi(
      admin,
      userId,
      {
        prompt: resumeImportPrompt(text),
        maxTokens: 8000,
        temperature: 0,
        timeoutMs: 90_000,
      },
      {
        job: 'import',
        choice: modelOverride,
        parse: (reply) => parseResumeImportReply(reply, text),
      },
    );
    if (ai.ok)
      return json(200, { ...ai.value, model: ai.model, provider: ai.provider });
    if (ai.reason === 'no_connection')
      return json(422, {
        error: 'Add an AI connection in Settings to read resumes with AI',
      });
    if (ai.reason === 'rate_limited')
      return json(429, { error: ai.message, retryAt: ai.retryAt });
    return json(502, {
      error:
        ai.reason === 'bad_output'
          ? `${ai.message} Try again, or keep the built-in reading.`
          : ai.message,
    });
  }),
);
