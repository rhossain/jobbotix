// POST /functions/v1/extract-role      (signed-in user, not an ingest key)
//   Authorization: Bearer <user JWT>
//   { "url": "https://..." }   or   { "url": "...", "text": "<pasted posting>" }
//
// Fetches the posting (or takes pasted text), extracts the fields, and
// inserts a role for the caller. With an Anthropic key in Vault for this user
// the extraction is done by the model and the call is metered in ai_usage;
// without one the heuristic extractor fills what it can and the user edits
// the rest. Score stays 0 until a run or the user scores it.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { json, serviceClient } from '../_shared/auth.ts';
import { withCors } from '../_shared/cors.ts';
import {
  extractionPrompt,
  heuristicExtract,
  htmlToText,
  parseExtraction,
  type ExtractedRole,
} from '../_shared/extract.ts';

const ANTHROPIC_VERSION = '2023-06-01';

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

    // 2. Extract: model if the user has a key, heuristics otherwise
    const admin = serviceClient();
    let role: ExtractedRole = html
      ? heuristicExtract(url, html)
      : heuristicExtract(url, `<title></title>${text}`);
    role.postingText = text.slice(0, 50_000);
    let posted: string | null = null;
    let method: 'ai' | 'heuristic' = 'heuristic';

    const { data: profile } = await admin
      .from('profiles')
      .select('anthropic_key_ref, default_model')
      .eq('id', userId)
      .maybeSingle();
    const apiKey = profile?.anthropic_key_ref
      ? await readVaultSecret(admin, profile.anthropic_key_ref)
      : null;

    if (apiKey) {
      const model = profile?.default_model || 'claude-sonnet-4-5';
      try {
        const ai = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model,
            max_tokens: 800,
            messages: [{ role: 'user', content: extractionPrompt(url, text) }],
          }),
          signal: AbortSignal.timeout(40_000),
        });
        const payload = await ai.json();
        const reply = Array.isArray(payload?.content)
          ? payload.content.map((c: { text?: string }) => c.text ?? '').join('')
          : '';
        const parsed = parseExtraction(reply);
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
          const u = payload?.usage ?? {};
          await admin.from('ai_usage').insert({
            user_id: userId,
            job: 'extract',
            model,
            tokens_in: Number(u.input_tokens ?? 0),
            tokens_out: Number(u.output_tokens ?? 0),
            cost_usd: 0,
          });
        }
      } catch {
        /* fall back to heuristics */
      }
    }

    // 3. Insert (unique on user_id + url; a repeat returns the existing row)
    const { data: existing } = await admin
      .from('roles')
      .select('id')
      .eq('user_id', userId)
      .eq('url', url)
      .maybeSingle();
    if (existing) return json(200, { id: existing.id, existed: true, method });

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
      })
      .select('id')
      .single();
    if (error || !inserted)
      return json(500, { error: error?.message ?? 'insert failed' });

    await admin.from('role_events').insert({
      user_id: userId,
      role_id: inserted.id,
      kind: 'ingested',
      payload: { source: 'manual', method },
    });

    return json(200, { id: inserted.id, existed: false, method });
  }),
);

/** Reads a secret the user stored in Supabase Vault by name; null when absent. */
async function readVaultSecret(
  admin: ReturnType<typeof serviceClient>,
  name: string,
): Promise<string | null> {
  const { data } = await admin
    .schema('vault')
    .from('decrypted_secrets')
    .select('decrypted_secret')
    .eq('name', name)
    .maybeSingle();
  return (
    (data as { decrypted_secret?: string } | null)?.decrypted_secret ?? null
  );
}
