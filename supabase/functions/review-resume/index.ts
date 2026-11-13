// POST /functions/v1/review-resume     (signed-in user)
//   Authorization: Bearer <user JWT>
//   { "sections": { ...ResumeSections... }, "model"?: "provider:model" }
//
// Reviews a resume with a model and proposes rewrites and removals, each
// with a reason (see _shared/resume-review.ts). The browser sends what is in
// the editor, so the proposals fit what the user sees, saved or not. Nothing
// is stored: the user accepts or rejects each change, and the resume only
// changes when they save a version. The model is sent the wording without
// the contact details. Metered in ai_usage as a tailoring job, which is what
// it costs.
//
// The Free plan includes one review, given once and not each month; Pro and
// accounts opened before reviews were limited are not counted. A review that
// answered is counted in feature_uses, a failed one is not, and once the
// allowance is used up the answer is 402 with an upgrade hint.
//
// Without a connection or credits it answers 422; 429 or 502 when every
// connection is rate limited or fails. There is no local stand-in: a review
// needs a model.

import { runAi } from '../_shared/ai.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { json, serviceClient } from '../_shared/auth.ts';
import { withCors } from '../_shared/cors.ts';
import { countUse, requireAiJob, reviewBlocked } from '../_shared/gate.ts';
import { normaliseResume } from '../_shared/resume.ts';
import { resumeContext } from '../_shared/resume-context.ts';
import {
  hasReviewableText,
  parseReviewReply,
  REVIEW_MAX_CHARS,
  reviewPrompt,
} from '../_shared/resume-review.ts';

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

    const { sections: sent, model: modelOverride } = (await req
      .json()
      .catch(() => ({}))) as { sections?: unknown; model?: unknown };
    if (!sent || typeof sent !== 'object' || Array.isArray(sent))
      return json(400, { error: 'Send the resume to review' });
    if (JSON.stringify(sent).length > REVIEW_MAX_CHARS)
      return json(413, {
        error: 'That is longer than any resume; shorten it and try again',
      });
    const sections = normaliseResume(sent);
    if (!hasReviewableText(sections))
      return json(400, {
        error:
          'Add a summary or some experience first: there is nothing to review yet',
      });

    const admin = serviceClient();
    const gate = await requireAiJob(admin, userId, 'tailor');
    if (gate instanceof Response) return gate;
    const used = reviewBlocked(gate);
    if (used) return used;
    const ai = await runAi(
      admin,
      userId,
      {
        context: resumeContext(sections),
        prompt: reviewPrompt(),
        maxTokens: 3000,
        timeoutMs: 75_000,
      },
      {
        job: 'tailor',
        choice: modelOverride,
        parse: (reply) => parseReviewReply(reply, sections),
      },
    );
    if (ai.ok) await countUse(admin, userId, 'resume_reviews');
    if (ai.ok)
      return json(200, {
        changes: ai.value.map((c) => ({
          ...c,
          id: crypto.randomUUID(),
          decision: 'pending',
        })),
        model: ai.model,
        provider: ai.provider,
      });
    if (ai.reason === 'no_connection')
      return json(422, {
        error: 'Add an AI connection in Settings to review your resume with AI',
      });
    if (ai.reason === 'rate_limited')
      return json(429, { error: ai.message, retryAt: ai.retryAt });
    // No key of its own, and credits could not be used: nothing was tried.
    if (
      ai.reason === 'no_credits' ||
      ai.reason === 'daily_cap' ||
      ai.reason === 'budget'
    )
      return json(422, { error: ai.message });
    return json(502, {
      error:
        ai.reason === 'bad_output' ? `${ai.message} Try again.` : ai.message,
    });
  }),
);
