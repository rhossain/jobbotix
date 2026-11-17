// POST /functions/v1/extract-role      (signed-in user, not an ingest key)
//   Authorization: Bearer <user JWT>
//   { "url": "https://..." }   or   { "url": "...", "text": "<pasted posting>" }
//   { "roleId": "...", "text": "<pasted posting>" }   for a job already kept
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
//
// With `roleId` the post belongs to a job already in the pipeline that came
// in without one (imported from a LinkedIn archive or a spreadsheet): the
// text is kept on that job, what it says fills the job's blanks
// (post-fill.ts), and the job is scored. No page is opened for it.
//
// LinkedIn and Upwork pages are never opened (open-page.ts). An Upwork link
// is sent to add-gig. A LinkedIn link is taken only together with the post's
// text, pasted by the user; that text stays out of the shared store.

import { aiNote, runAi } from '../_shared/ai.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { json, serviceClient } from '../_shared/auth.ts';
import { withCors } from '../_shared/cors.ts';
import {
  extractionKey,
  mayShareExtraction,
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
import { isUpworkUrl } from '../_shared/gig.ts';
import {
  isLinkedInUrl,
  LINKEDIN_PASTE_MESSAGE,
  LINKEDIN_TEXT_MIN,
} from '../_shared/linkedin.ts';
import { openPage } from '../_shared/open-page.ts';
import { fillFromPost, type StoredPost } from '../_shared/post-fill.ts';
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

    let body: { url?: string; text?: string; roleId?: string };
    try {
      body = await req.json();
    } catch {
      return json(400, { error: 'Body must be JSON' });
    }
    const admin = serviceClient();

    // The post of a job the caller already keeps, pasted by them.
    const roleId = typeof body.roleId === 'string' ? body.roleId.trim() : '';
    let kept: (StoredPost & { id: string; url: string }) | null = null;
    if (roleId) {
      const { data } = await admin
        .from('roles')
        .select(
          'id, url, company, title, location, remote_scope, type, salary, stack, posted_at, posting_text, entry_kind',
        )
        .eq('id', roleId)
        .eq('user_id', userId)
        .maybeSingle();
      if (!data) return json(404, { error: 'That job was not found' });
      if (data.entry_kind === 'gig')
        return json(422, {
          error: 'A job from Upwork is read on "Add from Upwork".',
        });
      if ((body.text ?? '').trim().length < 80)
        return json(422, {
          error: 'Paste the whole job post (80 characters or more).',
        });
      kept = data as StoredPost & { id: string; url: string };
    }

    const url = kept ? kept.url : (body.url ?? '').trim();
    if (!/^https?:\/\//i.test(url))
      return json(400, {
        error: 'Paste a link that starts with http:// or https://',
      });

    // Upwork forbids reading its site by machine, so Jobbotix never opens an
    // Upwork page and never takes one in here: gigs go through add-gig, from
    // text the user pastes.
    if (!kept && isUpworkUrl(url))
      return json(422, {
        error:
          'Jobs from Upwork are added with "Add from Upwork": paste the text of the job post there.',
        upwork: true,
      });

    // 1. Get the posting text
    let html = '';
    let text = (body.text ?? '').trim();

    // LinkedIn does not allow software to open or read its pages, so a
    // LinkedIn link is taken only with the post's text, pasted by the user.
    if (isLinkedInUrl(url) && text.length < LINKEDIN_TEXT_MIN)
      return json(422, { error: LINKEDIN_PASTE_MESSAGE, linkedin: true });

    if (!text) {
      const page = await openPage(url);
      if (!page.ok) {
        // a short link or tracking link that leads to a site never opened
        if (page.reason === 'no-read')
          return page.site === 'linkedin'
            ? json(422, {
                error: `That link leads to LinkedIn. ${LINKEDIN_PASTE_MESSAGE}`,
                linkedin: true,
              })
            : json(422, {
                error:
                  'That link leads to Upwork. Jobs from Upwork are added with "Add from Upwork": paste the text of the job post there.',
                upwork: true,
              });
        return json(422, {
          error:
            page.reason === 'status'
              ? `That page could not be opened (error ${page.status}). Paste the text of the job post instead.`
              : 'That page could not be opened. Paste the text of the job post instead.',
        });
      }
      html = page.html;
      text = htmlToText(html);
    }
    if (text.length < 80)
      return json(422, {
        error:
          'That page has almost no readable text. Paste the text of the job post instead.',
      });

    // 2. Extract: the model on an AI connection, heuristics otherwise
    const gate = await requireAiJob(admin, userId, 'extract');
    if (gate instanceof Response) return gate;
    let role: ExtractedRole = html
      ? heuristicExtract(url, html)
      : heuristicExtract(url, `<title></title>${text}`);
    role.postingText = text.slice(0, 50_000);
    let posted: string | null = null;
    let method: 'ai' | 'heuristic' = 'heuristic';

    // Read by a model before, for anyone? Then there is nothing to ask.
    // Text pasted from LinkedIn is the exception: it is never stored for
    // other users and never answered from what another user pasted.
    const key = mayShareExtraction(url) ? await extractionKey(url, text) : null;
    const stored = key ? await readExtraction(admin, key) : null;
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
    if (ai?.ok && key)
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

    // 3a. A job already kept: fill its blanks from the post, then score it.
    if (kept) {
      const filled = fillFromPost(kept, role, posted, method === 'ai');
      let rescored: Partial<RoleScoreFields> = {};
      let rescoredBy: 'heuristic' | 'ai' | null = null;
      try {
        const r = await scoreRole(admin, userId, filled, true);
        if ('fields' in r) {
          rescored = r.fields;
          rescoredBy = r.method;
        }
      } catch {
        /* the post is still worth keeping on the job unscored */
      }
      const save = (fields: Partial<StoredPost>) =>
        admin
          .from('roles')
          .update({ ...fields, ...rescored })
          .eq('id', kept.id)
          .eq('user_id', userId);
      let { error: saveError } = await save(filled);
      // a replaced placeholder name can meet another job of the same name
      if (saveError?.code === '23505') {
        const { company: _c, title: _t, ...rest } = filled;
        ({ error: saveError } = await save(rest));
      }
      if (saveError) return json(500, { error: saveError.message });
      await admin.from('role_events').insert({
        user_id: userId,
        role_id: kept.id,
        kind: 'note',
        payload: {
          text: `The job post was pasted in and read${method === 'ai' ? ' by AI' : ''}${
            rescoredBy ? `; scored ${rescored.score}` : ''
          }`,
        },
      });
      return json(200, {
        id: kept.id,
        existed: true,
        filled: true,
        method,
        scored: !!rescoredBy,
        score: rescored.score ?? null,
        aiNote: note,
      });
    }

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
