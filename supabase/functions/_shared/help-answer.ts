// One Help chat question, answered: the person's own AI first, then
// Jobbotix's key within the help limits, else the best article. Kept apart
// from help-chat/index.ts so the routing can be tested with fakes.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { callProvider, loadConnections, runAi } from './ai.ts';
import {
  buildHelpCall,
  parseHelpReply,
  type HelpAsk,
  type HelpReply,
} from './help.ts';

type Admin = Pick<SupabaseClient, 'from' | 'rpc'>;
type Gate =
  | { ok: true; model: string }
  | { ok: false; reason: 'off' | 'budget' | 'daily_limit' };

async function gate(
  admin: Admin,
  userId: string,
  route: 'own' | 'platform',
): Promise<Gate> {
  const { data, error } = await admin.rpc('help_ai_check', {
    p_user: userId,
    p_route: route,
  });
  if (error || !data || typeof data !== 'object') {
    console.error(`help_ai_check failed: ${error?.message ?? 'no answer'}`);
    return { ok: false, reason: 'off' };
  }
  const d = data as Record<string, unknown>;
  if (d.ok === true && typeof d.model === 'string')
    return { ok: true, model: d.model };
  const reason = d.reason;
  return {
    ok: false,
    reason: reason === 'budget' || reason === 'daily_limit' ? reason : 'off',
  };
}

export interface HelpAnswer {
  /** The help_messages row, for yes or no; null when it could not be saved. */
  id: string | null;
  route: 'own' | 'platform' | 'articles';
  /** false: the articles did not answer it. */
  found: boolean;
  /** The AI's answer; '' on the articles route. */
  answer: string;
  /** Article ids: the ones the answer used, or the best matches. */
  articles: string[];
  /** Why there is no AI answer (articles route only). */
  reason?: 'off' | 'budget' | 'daily_limit' | 'failed';
  /** The person has an AI connection of their own. */
  ownAi: boolean;
}

/** `key`: Jobbotix's Anthropic key, or '' when there is none. */
export async function answerHelp(
  admin: Admin,
  userId: string,
  ask: HelpAsk,
  key: string,
): Promise<HelpAnswer> {
  const prompt = buildHelpCall(ask);
  const parse = (text: string) => parseHelpReply(text, prompt.allowed);
  let reply: HelpReply | null = null;
  let route: 'own' | 'platform' | 'articles' = 'articles';
  let model = '';
  let reason: 'off' | 'budget' | 'daily_limit' | 'failed' | undefined;

  // 1. Their own AI.
  const connections = await loadConnections(admin, userId);
  if (connections.length) {
    const g = await gate(admin, userId, 'own');
    if (g.ok) {
      const r = await runAi<HelpReply>(admin, userId, prompt.call, {
        job: 'help',
        parse,
        fast: true,
        platform: false,
        connections,
      });
      if (r.ok) {
        reply = r.value;
        route = 'own';
        model = `${r.provider}:${r.model}`;
      } else {
        console.warn(`help on own key failed (${r.reason}): ${r.message}`);
        reason = 'failed';
      }
    } else reason = g.reason;
  }

  // 2. Jobbotix's key.
  if (!reply && key) {
    const g = await gate(admin, userId, 'platform');
    if (g.ok) {
      for (let attempt = 0; attempt < 2 && !reply; attempt++) {
        const a = await callProvider('anthropic', key, g.model, prompt.call);
        if (!a.ok) {
          // The platform key's troubles are for the logs, not the person.
          console.error(
            `help on platform failed (${a.kind} ${a.status}): ${a.message}`,
          );
          reason = 'failed';
          break;
        }
        const { error } = await admin.rpc('help_ai_log', {
          p_user: userId,
          p_model: g.model,
          p_tokens_in: a.tokensIn,
          p_tokens_out: a.tokensOut,
          p_cache_read: a.cacheRead ?? 0,
          p_cache_write: a.cacheWrite ?? 0,
        });
        if (error) console.error(`help_ai_log failed: ${error.message}`);
        reply = parse(a.text);
        if (reply) {
          route = 'platform';
          model = `anthropic:${g.model}`;
        } else reason = 'failed';
      }
    } else if (g.reason !== 'off' || !reason) reason = g.reason;
  } else if (!reply) reason ??= 'off';

  // 3. Without AI: the best article, as before.
  const articles = reply
    ? reply.articles.length
      ? reply.articles
      : reply.found
        ? prompt.best.slice(0, 1)
        : []
    : prompt.best.slice(0, 3);
  const found = reply ? reply.found : prompt.best.length > 0;

  const { data: row, error } = await admin
    .from('help_messages')
    .insert({
      user_id: userId,
      question: ask.question,
      page: ask.page,
      answer: reply?.answer ?? '',
      articles,
      route,
      found,
      model,
    })
    .select('id')
    .single();
  if (error) console.error(`help_messages insert: ${error.message}`);

  return {
    id: row?.id ?? null,
    route,
    found,
    answer: reply?.answer ?? '',
    articles,
    ...(route === 'articles' ? { reason: reason ?? 'off' } : {}),
    ownAi: connections.length > 0,
  };
}
