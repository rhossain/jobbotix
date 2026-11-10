// POST /functions/v1/draft-message     (signed-in user)
//   Authorization: Bearer <user JWT>
//   { "contactId": "...", "kind": "outreach" | "referral" | "recruiter_reply" | "check_in",
//     "roleId"?: "...", "incoming"?: "...", "ask"?: "...", "model"?: "provider:model" }
//
// Drafts a short message to one of the user's people from their resume
// headline, the person's notes, the role and the user's voice samples. With
// an AI connection the model writes it (metered in ai_usage as 'message');
// without one, or when every connection fails, the local template does and
// `aiNote` says why. Nothing is stored: the
// user edits, copies and logs it as sent in the app.

import { aiNote, runAi } from '../_shared/ai.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { json, serviceClient } from '../_shared/auth.ts';
import { withCors } from '../_shared/cors.ts';
import { normaliseResume } from '../_shared/resume.ts';
import {
  MESSAGE_KINDS,
  localMessage,
  messagePrompt,
  parseMessageReply,
  type ContactRelation,
  type MessageContext,
  type MessageKind,
} from '../_shared/contacts.ts';
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
      contactId?: string;
      kind?: string;
      roleId?: string | null;
      incoming?: string;
      ask?: string;
      model?: string;
    };
    if (!body.contactId) return json(400, { error: 'contactId is required' });
    const kind = (MESSAGE_KINDS as readonly string[]).includes(body.kind ?? '')
      ? (body.kind as MessageKind)
      : 'outreach';

    const admin = serviceClient();
    const gate = await requireAiJob(admin, userId, 'message');
    if (gate instanceof Response) return gate;
    const [
      { data: contact },
      { data: role },
      { data: master },
      { data: samples },
      { data: profile },
    ] = await Promise.all([
      admin
        .from('contacts')
        .select('name, title, company, relation, notes')
        .eq('id', body.contactId)
        .eq('user_id', userId)
        .maybeSingle(),
      body.roleId
        ? admin
            .from('roles')
            .select('title, company, url')
            .eq('id', body.roleId)
            .eq('user_id', userId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      admin
        .from('resumes')
        .select('sections')
        .eq('user_id', userId)
        .eq('is_master', true)
        .maybeSingle(),
      admin
        .from('cover_letters')
        .select('body')
        .eq('user_id', userId)
        .eq('voice_sample', true)
        .order('created_at', { ascending: true })
        .limit(3),
      admin.from('profiles').select('name').eq('id', userId).maybeSingle(),
    ]);
    if (!contact) return json(404, { error: 'Person not found' });

    const resume = master ? normaliseResume(master.sections) : null;
    const ctx: MessageContext = {
      kind,
      candidate: resume?.contact.name || profile?.name || '',
      headline: resume?.contact.headline ?? '',
      contact: {
        name: contact.name,
        title: contact.title ?? '',
        company: contact.company ?? '',
        relation: contact.relation as ContactRelation,
        notes: contact.notes ?? '',
      },
      role: role
        ? { title: role.title, company: role.company, url: role.url }
        : null,
      incoming: String(body.incoming ?? '').slice(0, 6000),
      ask: String(body.ask ?? '').slice(0, 2000),
      voiceSamples: (samples ?? []).map((s: { body: string }) => s.body),
    };

    let text = localMessage(ctx);
    let method: 'ai' | 'local' = 'local';
    let model = '';
    let provider = '';
    const ai = await runAi(
      admin,
      userId,
      { prompt: messagePrompt(ctx), maxTokens: 500, timeoutMs: 45_000 },
      {
        job: 'message',
        choice: body.model,
        parse: (reply) => {
          const cleaned = parseMessageReply(reply);
          return cleaned.split(/\s+/).length >= 20 ? cleaned : null;
        },
      },
    );
    if (ai.ok) {
      text = ai.value;
      method = 'ai';
      model = ai.model;
      provider = ai.provider;
    }

    return json(200, {
      body: text,
      method,
      model: method === 'ai' ? model : undefined,
      provider: method === 'ai' ? provider : undefined,
      aiNote: aiNote(ai, 'This draft was written without a model.'),
    });
  }),
);
