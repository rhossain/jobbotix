// POST /functions/v1/draft-message     (signed-in user)
//   Authorization: Bearer <user JWT>
//   { "contactId": "...", "kind": "outreach" | "referral" | "recruiter_reply" | "check_in",
//     "roleId"?: "...", "incoming"?: "...", "ask"?: "...", "model"?: "claude-..." }
//
// Drafts a short message to one of the user's people from their resume
// headline, the person's notes, the role and the user's voice samples. With
// an Anthropic key in Vault the model writes it (metered in ai_usage as
// 'message'); without one the local template does. Nothing is stored: the
// user edits, copies and logs it as sent in the app.

import { DEFAULT_MODEL } from '../_shared/models.ts';
import { callMessages } from '../_shared/anthropic.ts';
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
import { readVaultSecret } from '../_shared/vault.ts';

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
      admin
        .from('profiles')
        .select('name, anthropic_key_ref, default_model')
        .eq('id', userId)
        .maybeSingle(),
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
    const apiKey = profile?.anthropic_key_ref
      ? await readVaultSecret(admin, profile.anthropic_key_ref)
      : null;
    if (apiKey) {
      model =
        (typeof body.model === 'string' &&
        /^claude-[a-z0-9-]+$/.test(body.model)
          ? body.model
          : '') ||
        profile?.default_model ||
        DEFAULT_MODEL;
      try {
        const ai = await callMessages(
          apiKey,
          {
            model,
            max_tokens: 500,
            messages: [{ role: 'user', content: messagePrompt(ctx) }],
          },
          45_000,
        );
        const payload = await ai.json();
        const reply = Array.isArray(payload?.content)
          ? payload.content.map((c: { text?: string }) => c.text ?? '').join('')
          : '';
        const cleaned = parseMessageReply(reply);
        if (cleaned.split(/\s+/).length >= 20) {
          text = cleaned;
          method = 'ai';
        }
        const u = payload?.usage ?? {};
        await admin.from('ai_usage').insert({
          user_id: userId,
          job: 'message',
          model,
          tokens_in: Number(u.input_tokens ?? 0),
          tokens_out: Number(u.output_tokens ?? 0),
          cost_usd: 0,
        });
      } catch {
        /* the local draft stands */
      }
    }

    return json(200, {
      body: text,
      method,
      model: method === 'ai' ? model : undefined,
    });
  }),
);
