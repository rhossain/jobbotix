// POST /functions/v1/extract-role      (signed-in user, not an ingest key)
//   Authorization: Bearer <user JWT>
//   { "url": "https://..." }   or   { "url": "...", "text": "<pasted posting>" }
//
// Fetches the posting (or takes pasted text), extracts the fields, and
// inserts a role for the caller. With an AI connection the extraction is done
// by the model and the call is metered in ai_usage; without one, or when
// every connection fails, the heuristic extractor fills what it can and the
// user edits the rest (`aiNote` says why). A posting a model has already read
// for anyone, with the same address and text, is not read again: its fields
// come from the shared store (extract-cache.ts). The role is then scored against the user's search profile the
// same way the scheduled run scores what it finds (role-score.ts), so it
// lands with a match score, reasons and things to watch.

import { aiNote, runAi } from '../_shared/ai.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { json, serviceClient } from '../_shared/auth.ts';
import { withCors } from '../_shared/cors.ts';
import {
  extractionKey,
  readExtraction,
  writeExtraction,
} from '../_shared/extract-cache.ts';
import {
  extractionPrompt,
  heuristicExtract,
  htmlToText,
  parseExtraction,
  type ExtractedRole,
} from '../_shared/extract.ts';
import { scoreRole, type RoleScoreFields } from '../_shared/role-score.ts';
import { requireAiJob } from '../_shared/gate.ts';

Deno.serve(
  withCors(async (req) => {
    if (req.method !== 'POST') return json(405, { error: 'POST only' });

    const jwt = req.headers
      .get('authorization')
      ?.replace(/^Bearer\s+/i, '')
      .trim();
    if (!jwt) return json(401, { error: 'Sign in first' });

    // Who is calling? A client bound to the caller's JWT answers that under RLS.
    const asUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
        auth: { persistSession: false },
      },
    );
    const { data: userData, error: userError } = await asUser.auth.getUser();
    if (userError || !userData.user)
      return json(401, { error: 'Session expired; sign in again' });
    const userId = userData.user.id;

    let body: { url?: string; text?: string };
    try {
      body = await req.json();
    } catch {
      return json(400, { error: 'Body must be JSON' });
    }
    const url = (body.url ?? '').trim();
    if (!/^https?:\/\//i.test(url))
      return json(400, {
        error: 'A posting URL starting with http(s):// is required',
      });

    // 1. Get the posting text
    let html = '';
    let text = (body.text ?? '').trim();
    if (!text) {
      try {
        const res = await fetch(url, {
          headers: {
            'user-agent':
              'Mozilla/5.0 (compatible; Jobbotix/1.0; +https://jobbotix.com)',
            accept: 'text/html,*/*',
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok)
          return json(422, {
            error: `The posting page answered ${res.status}. Paste the posting text instead.`,
          });
        html = await res.text();
        text = htmlToText(html);
      } catch {
        return json(422, {
          error: 'Could not fetch that page. Paste the posting text instead.',
        });
      }
    }
    if (text.length < 80)
      return json(422, {
        error:
          'That page has almost no readable text. Paste the posting instead.',
      });

    // 2. Extract: the model on an AI connection, heuristics otherwise
    const admin = serviceClient();
    const gate = await requireAiJob(admin, userId, 'extract');
    if (gate instanceof Response) return gate;
    let role: ExtractedRole = html
      ? heuristicExtract(url, html)
      : heuristicExtract(url, `<title></title>${text}`);
    role.postingText = text.slice(0, 50_000);
    let posted: string | null = null;
    let method: 'ai' | 'heuristic' = 'heuristic';

    // Read by a model before, for anyone? Then there is nothing to ask.
    const key = await extractionKey(url, text);
    const stored = await readExtraction(admin, key);
    const ai = stored
      ? null
      : await runAi(
          admin,
          userId,
          {
            prompt: extractionPrompt(url, text),
            maxTokens: 800,
            timeoutMs: 40_000,
          },
          { job: 'extract', parse: parseExtraction },
        );
    const parsed = stored ?? (ai?.ok ? ai.value : null);
    if (ai?.ok)
      await writeExtraction(admin, key, ai.value, {
        provider: ai.provider,
        model: ai.model,
      });
    if (parsed) {
      role = {
        ...role,
        company: parsed.company || role.company,
        title: parsed.title || role.title,
        location: parsed.location || role.location,
        type: parsed.type ?? role.type,
        salary: parsed.salary || role.salary,
        stack: parsed.stack?.length ? parsed.stack : role.stack,
      };
      posted = /^\d{4}-\d{2}-\d{2}$/.test(parsed.posted ?? '')
        ? parsed.posted!
        : null;
      method = 'ai';
    }
    const note = ai
      ? aiNote(ai, 'The posting was read without a model; check the fields.')
      : undefined;

    // 3. Insert (unique on user_id + url; a repeat returns the existing row)
    const { data: existing } = await admin
      .from('roles')
      .select('id')
      .eq('user_id', userId)
      .eq('url', url)
      .maybeSingle();
    if (existing) return json(200, { id: existing.id, existed: true, method });

    // 4. Score it like the run would (no profile yet: it stays unscored)
    let scoring: Partial<RoleScoreFields> = {};
    let scoreMethod: 'heuristic' | 'ai' | null = null;
    try {
      const r = await scoreRole(
        admin,
        userId,
        {
          company: role.company,
          title: role.title,
          location: role.location,
          type: role.type,
          salary: role.salary,
          posting_text: role.postingText,
          stack: role.stack,
          posted_at: posted,
        },
        true,
      );
      if ('fields' in r) {
        scoring = r.fields;
        scoreMethod = r.method;
      }
    } catch {
      /* the role is still worth adding unscored */
    }

    const { data: inserted, error } = await admin
      .from('roles')
      .insert({
        user_id: userId,
        company: role.company || 'Unknown company',
        title: role.title || 'Untitled role',
        url,
        source: 'Added by hand',
        location: role.location,
        remote_scope: role.location,
        type: role.type,
        salary: role.salary,
        posted_at: posted,
        stack: role.stack,
        posting_text: role.postingText,
        status: 'new',
        ...scoring,
      })
      .select('id')
      .single();
    if (error || !inserted)
      return json(500, { error: error?.message ?? 'insert failed' });

    await admin.from('role_events').insert({
      user_id: userId,
      role_id: inserted.id,
      kind: 'ingested',
      payload: {
        source: 'manual',
        method,
        ...(stored ? { shared: true } : {}),
        ...(scoreMethod ? { score: scoring.score, scored: scoreMethod } : {}),
      },
    });

    return json(200, {
      id: inserted.id,
      existed: false,
      method,
      // true: a model had read this posting before, so none was called now
      shared: !!stored,
      score: scoring.score ?? null,
      aiNote: note,
    });
  }),
);
