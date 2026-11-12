// POST /functions/v1/suggest-roles     (signed-in user)
//   Authorization: Bearer <user JWT>
//   { "roles": ["SQA Engineer", "Supply Chain Analyst"], "stacks"?: ["Selenium"] }
//
// Other job titles for each target role, for the Search profile page to
// offer. A role a family lists is answered from the family, with no model:
// its other names are matched already and shown so the user can see them. A
// role no family lists is asked of the model when the account can use AI
// (metered as 'score', on the fast model); without AI it comes back with no
// titles and `aiNote` says why. Nothing is saved: the user adds the titles
// they want to their target roles.

import { aiNote, runAi } from '../_shared/ai.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { json, serviceClient } from '../_shared/auth.ts';
import { withCors } from '../_shared/cors.ts';
import { parseJsonObject } from '../_shared/json-reply.ts';
import {
  cleanTitles,
  familyTitles,
  parseRole,
  type TitleSuggestion,
  variantsPrompt,
} from '../_shared/role.ts';

const MAX_ROLES = 8;
const MAX_AI_ROLES = 4;

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
      roles?: unknown;
      stacks?: unknown;
    };
    const strings = (v: unknown, max: number, len: number) =>
      Array.isArray(v)
        ? [
            ...new Set(
              v
                .filter((x): x is string => typeof x === 'string')
                .map((x) => x.replace(/\s+/g, ' ').trim().slice(0, len))
                .filter(Boolean),
            ),
          ].slice(0, max)
        : [];
    const roles = strings(body.roles, MAX_ROLES, 80);
    const stacks = strings(body.stacks, 6, 40);
    if (!roles.length) return json(400, { error: 'roles is required' });

    const out: TitleSuggestion[] = roles.map(familyTitles);
    const admin = serviceClient();
    let note = '';
    let asked = 0;
    for (const s of out) {
      // a role a family covers, or one with no job word, needs no model
      if (s.known || !parseRole(s.role)) continue;
      if (asked >= MAX_AI_ROLES) break;
      asked++;
      const ai = await runAi(
        admin,
        userId,
        {
          prompt: variantsPrompt(s.role, stacks),
          maxTokens: 300,
          timeoutMs: 20_000,
        },
        {
          job: 'score',
          fast: true,
          parse: (reply) => {
            const o = parseJsonObject(reply);
            const titles = cleanTitles(s.role, o?.['titles']);
            return titles.length ? titles : null;
          },
        },
      );
      if (ai.ok) {
        s.titles = ai.value;
        s.source = 'ai';
      } else {
        note ||=
          aiNote(ai, 'Other titles could not be suggested this time.') ??
          'Connect an AI provider in Settings to get other titles for roles outside the built-in list.';
        // nothing can answer for this account right now: stop asking
        if (ai.reason !== 'failed' && ai.reason !== 'bad_output') break;
      }
    }
    return json(200, { suggestions: out, ...(note ? { aiNote: note } : {}) });
  }),
);
