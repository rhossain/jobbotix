// POST /functions/v1/add-gig      (signed-in user)
//   Authorization: Bearer <user JWT>
//   { "action": "read", "url": "https://www.upwork.com/jobs/~01…", "text": "<pasted job post>" }
//   { "action": "save", "draft": { url, title, postingText, skills, questions, …gig fields } }
//
// Adds a freelance gig the user found on Upwork. Jobbotix never opens Upwork:
// this function makes no request to upwork.com, and "read" works only on the
// text the user pasted. Upwork's terms forbid reading its site by machine, so
// there is no fetch here to fall back on, by design.
//
//   read   turns the pasted text into fields for the user to check. With an
//          AI connection the model does it (metered in ai_usage as
//          'extract'); without one, or when every connection fails, the
//          pattern reader fills what it can and the user types the rest.
//          Nothing is stored, and nothing is shared between accounts.
//   save   stores the checked fields as a gig in the caller's own pipeline
//          (roles.entry_kind = 'gig'), with the client's screening questions
//          ready to answer. It is not scored: the user asks for a fit check
//          on the gig's page when they want one.

import { aiNote, runAi } from '../_shared/ai.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { json, serviceClient } from '../_shared/auth.ts';
import { withCors } from '../_shared/cors.ts';
import { detectStack } from '../_shared/extract.ts';
import { requireAiJob } from '../_shared/gate.ts';
import {
  checkGigDraft,
  GIG_COMPANY,
  GIG_SOURCE,
  GIG_TEXT_MIN,
  gigBudgetLine,
  gigPrompt,
  heuristicGig,
  normaliseGig,
  parseGig,
  upworkJobUrl,
  type GigDraft,
} from '../_shared/gig.ts';

const BAD_LINK =
  'Use the link of the job post on Upwork. Open the job on Upwork and copy the address from the top of your browser.';

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
      action?: string;
      url?: string;
      text?: string;
      draft?: unknown;
    };
    const admin = serviceClient();

    const existingId = async (url: string) => {
      const { data } = await admin
        .from('roles')
        .select('id')
        .eq('user_id', userId)
        .eq('url', url)
        .maybeSingle();
      return (data?.id as string | undefined) ?? null;
    };

    if (body.action === 'read') {
      const url = upworkJobUrl(body.url ?? '');
      if (!url) return json(400, { error: BAD_LINK });
      const text = (body.text ?? '').trim().slice(0, 50_000);
      if (text.length < GIG_TEXT_MIN)
        return json(422, {
          error:
            'Paste the text of the job post: on Upwork, select everything on the job post, copy it, and paste it here.',
        });
      const had = await existingId(url);
      if (had) return json(200, { id: had, existed: true });

      const gate = await requireAiJob(admin, userId, 'extract');
      if (gate instanceof Response) return gate;

      const found = heuristicGig(text);
      let draft: GigDraft = {
        ...normaliseGig(found),
        url,
        title: found.title,
        skills: detectStack(text),
        questions: found.questions,
        postingText: text,
      };
      let method: 'ai' | 'heuristic' = 'heuristic';
      const ai = await runAi(
        admin,
        userId,
        { prompt: gigPrompt(text), maxTokens: 900, timeoutMs: 40_000 },
        { job: 'extract', parse: parseGig },
      );
      if (ai.ok) {
        const { title, skills, questions, ...gig } = ai.value;
        draft = {
          ...draft,
          ...gig,
          title: title || draft.title,
          skills: skills.length ? skills : draft.skills,
          questions: questions.length ? questions : draft.questions,
        };
        method = 'ai';
      }
      return json(200, {
        draft,
        method,
        aiNote: aiNote(
          ai,
          'The job post was read without a model; check the fields.',
        ),
      });
    }

    if (body.action === 'save') {
      const draft = checkGigDraft(body.draft);
      if ('error' in draft) return json(400, { error: draft.error });
      const had = await existingId(draft.url);
      if (had) return json(200, { id: had, existed: true });

      const { url, title, skills, questions, postingText, ...gig } = draft;
      const { data: inserted, error } = await admin
        .from('roles')
        .insert({
          user_id: userId,
          entry_kind: 'gig',
          gig,
          company: GIG_COMPANY,
          title,
          url,
          source: GIG_SOURCE,
          location: 'Remote',
          remote_scope: 'Remote',
          type: 'freelance',
          salary: gigBudgetLine(gig),
          stack: skills,
          posting_text: postingText,
          status: 'new',
        })
        .select('id')
        .single();
      if (error || !inserted) {
        // saved from another tab in the meantime
        const again = error?.code === '23505' ? await existingId(url) : null;
        if (again) return json(200, { id: again, existed: true });
        return json(500, { error: error?.message ?? 'Could not save the gig' });
      }

      if (questions.length) {
        const { error: qErr } = await admin.from('screening_answers').insert(
          questions.map((question, position) => ({
            user_id: userId,
            role_id: inserted.id,
            question,
            position,
          })),
        );
        if (qErr) console.warn(`gig questions not saved: ${qErr.message}`);
      }
      await admin.from('role_events').insert({
        user_id: userId,
        role_id: inserted.id,
        kind: 'ingested',
        payload: { source: 'upwork', method: 'pasted' },
      });
      return json(200, { id: inserted.id, existed: false });
    }

    return json(400, { error: 'action must be "read" or "save"' });
  }),
);
