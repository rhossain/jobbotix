// POST /functions/v1/help-chat            (signed-in user, from the Help chat)
//   Authorization: Bearer <user JWT>
//
//   { "question": "...", "page": "/jobs/new" }
//     → { id, route, found, answer, articles, reason?, ownAi }
//   { "action": "feedback", "id": "<help_messages id>", "value": "yes" | "no" }
//     → { ok: true }
//
// An answer written by AI from the help articles (_shared/help.ts):
//   1. the person's own AI connections, when they have one (daily_own a day)
//   2. otherwise, or when theirs fails, Jobbotix's Anthropic key, free to
//      them (daily_free / daily_pro a day, monthly_budget_usd in total)
//   3. otherwise no AI: route "articles", and the browser shows the best
//      article; `reason` says why (daily_limit, budget, off, failed)
// Every question is kept in help_messages for 30 days (migration 0066).
//
// Secrets: ANTHROPIC_API_KEY for step 2; without it, step 2 is skipped.

import { json, serviceClient, signedInUserId } from '../_shared/auth.ts';
import { withCors } from '../_shared/cors.ts';
import { platformKey } from '../_shared/credits.ts';
import { answerHelp } from '../_shared/help-answer.ts';
import { readHelpAsk } from '../_shared/help.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(
  withCors(async (req) => {
    if (req.method !== 'POST') return json(405, { error: 'POST only' });
    const userId = await signedInUserId(req);
    if (!userId) return json(401, { error: 'Sign in again.' });
    const body = await req.json().catch(() => null);
    const admin = serviceClient();

    if ((body as Record<string, unknown> | null)?.action === 'feedback') {
      const { id, value } = body as Record<string, unknown>;
      if (
        typeof id !== 'string' ||
        !UUID.test(id) ||
        (value !== 'yes' && value !== 'no')
      )
        return json(400, { error: 'Unknown answer.' });
      const { error } = await admin
        .from('help_messages')
        .update({ feedback: value })
        .eq('id', id)
        .eq('user_id', userId);
      if (error) console.error(`help feedback: ${error.message}`);
      return json(200, { ok: true });
    }

    const ask = readHelpAsk(body);
    if (!ask) return json(400, { error: 'Write a question first.' });

    return json(200, await answerHelp(admin, userId, ask, platformKey()));
  }),
);
