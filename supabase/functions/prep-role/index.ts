// POST /functions/v1/prep-role     (signed-in user)
//   Authorization: Bearer <user JWT>
//   { "roleId": "...", "model"?: "provider:model" }
//
// Builds the interview prep sheet for one role from the master resume and
// the posting: the model on one of the user's AI connections (metered in
// ai_usage as 'prep'), local templates otherwise, with `aiNote` saying why
// when a connection was tried and failed. The user's own notes and practised
// ticks on the previous sheet are carried over.
//
// Interview prep is part of Pro (feature interview_prep): a plan without it
// gets 402, whichever key would have been used. A sheet built earlier stays
// on the role and the app still shows it.

import { aiNote, runAi } from '../_shared/ai.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { json, serviceClient } from '../_shared/auth.ts';
import { withCors } from '../_shared/cors.ts';
import { normaliseResume } from '../_shared/resume.ts';
import { resumeContext } from '../_shared/resume-context.ts';
import {
  localPrep,
  normalisePrep,
  parsePrepReply,
  prepPrompt,
  type PrepSheet,
} from '../_shared/prep.ts';
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

    const body = (await req.json().catch(() => ({}))) as {
      roleId?: string;
      model?: string;
    };
    if (!body.roleId) return json(400, { error: 'roleId is required' });
    const roleId = body.roleId;

    const admin = serviceClient();
    const gate = await requireAiJob(admin, userId, 'prep');
    if (gate instanceof Response) return gate;
    const [{ data: role }, { data: master }] = await Promise.all([
      admin
        .from('roles')
        .select('*')
        .eq('id', roleId)
        .eq('user_id', userId)
        .maybeSingle(),
      admin
        .from('resumes')
        .select('*')
        .eq('user_id', userId)
        .eq('is_master', true)
        .maybeSingle(),
    ]);
    if (!role) return json(404, { error: 'Role not found' });
    if (!master) return json(422, { error: 'Save a master resume first' });

    const resume = normaliseResume(master.sections);
    const posting = {
      company: role.company,
      title: role.title,
      text:
        role.posting_text ||
        [role.title, role.company, ...(role.stack ?? [])].join('\n'),
      stack: role.stack ?? [],
      reasons: role.reasons ?? [],
      gaps: role.gaps ?? [],
    };
    const previous = normalisePrep(role.prep);

    let sheet: PrepSheet = localPrep(resume, posting);
    const ai = await runAi(
      admin,
      userId,
      {
        context: resumeContext(resume),
        prompt: prepPrompt(resume, posting),
        maxTokens: 3000,
        timeoutMs: 90_000,
      },
      { job: 'prep', choice: body.model, parse: parsePrepReply },
    );
    if (ai.ok)
      sheet = {
        ...ai.value,
        generatedAt: new Date().toISOString(),
        method: 'ai',
        model: ai.model,
      };
    // Keep what the user wrote and ticked.
    sheet.userNotes = previous.userNotes;
    const practised = new Set(
      previous.questions.filter((q) => q.practised).map((q) => q.question),
    );
    sheet.questions = sheet.questions.map((q) => ({
      ...q,
      practised: practised.has(q.question),
    }));

    const { error } = await admin
      .from('roles')
      .update({ prep: sheet })
      .eq('id', roleId)
      .eq('user_id', userId);
    if (error) return json(500, { error: error.message });
    await admin.from('role_events').insert({
      user_id: userId,
      role_id: roleId,
      kind: 'generated',
      payload: {
        what: 'interview prep',
        method: sheet.method,
        model: sheet.model,
        provider: ai.ok ? ai.provider : undefined,
      },
    });
    return json(200, {
      prep: sheet,
      provider: ai.ok ? ai.provider : undefined,
      aiNote: aiNote(ai, 'This sheet was built without a model.'),
    });
  }),
);
