// POST /functions/v1/contact-support      (signed-in user, from the Help chat)
//   Authorization: Bearer <user JWT>
//   { "message": "...", "page": "/jobs/new", "conversation": "Asked: ..." }
//
// Records the request in help_tickets, then emails it to the support inbox
// through Resend with the person's own address as the reply-to, so answering
// is just a reply. Five requests per account per 24 hours.
//
// Secrets: RESEND_API_KEY (already set for the daily email).
// Optional: SUPPORT_TO (default support@jobbotix.com),
//           SUPPORT_FROM (default "Jobbotix Help <help@jobbotix.com>"),
//           APP_URL (default https://jobbotix.com).

import { json, serviceClient, signedInUserId } from '../_shared/auth.ts';
import { withCors } from '../_shared/cors.ts';
import { loadEntitlements } from '../_shared/gate.ts';
import {
  readSupportInput,
  supportEmail,
  SUPPORT_DAILY_LIMIT,
} from '../_shared/support.ts';

const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const TO = Deno.env.get('SUPPORT_TO') ?? 'support@jobbotix.com';
const FROM =
  Deno.env.get('SUPPORT_FROM') ?? 'Jobbotix Help <help@jobbotix.com>';
const APP_URL = (Deno.env.get('APP_URL') ?? 'https://jobbotix.com').replace(
  /\/$/,
  '',
);

Deno.serve(
  withCors(async (req) => {
    if (req.method !== 'POST') return json(405, { error: 'POST only' });
    const userId = await signedInUserId(req);
    if (!userId) return json(401, { error: 'Sign in again, then send it.' });

    const input = readSupportInput(await req.json().catch(() => null));
    if (!input) return json(400, { error: 'Write your question first.' });

    const admin = serviceClient();

    const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
    const { count } = await admin
      .from('help_tickets')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', since);
    if ((count ?? 0) >= SUPPORT_DAILY_LIMIT)
      return json(429, {
        error: `You have sent ${SUPPORT_DAILY_LIMIT} questions today, so this one was not sent.`,
      });

    const { data: profile } = await admin
      .from('profiles')
      .select('email, name, suspended_at')
      .eq('id', userId)
      .maybeSingle();
    if (!profile?.email)
      return json(404, { error: 'Your account could not be found.' });
    if (profile.suspended_at)
      return json(403, { error: 'This account is suspended.' });

    const { data: ticket, error } = await admin
      .from('help_tickets')
      .insert({ user_id: userId, ...input })
      .select('id')
      .single();
    if (error) {
      console.error(`help_tickets insert: ${error.message}`);
      return json(500, { error: 'It could not be sent just now.' });
    }

    if (!RESEND_KEY) {
      console.error('contact-support: RESEND_API_KEY is not set');
      return json(500, { error: 'It could not be sent just now.' });
    }

    const plan = (await loadEntitlements(admin, userId)).planName;
    const mail = supportEmail(
      input,
      { email: profile.email, name: profile.name ?? '', plan, userId },
      APP_URL,
    );
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${RESEND_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: [TO],
        reply_to: profile.email,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      }),
    });
    if (!res.ok) {
      console.error(
        `contact-support: Resend ${res.status} ${await res.text().catch(() => '')}`,
      );
      return json(502, { error: 'It could not be sent just now.' });
    }

    await admin
      .from('help_tickets')
      .update({ emailed_at: new Date().toISOString() })
      .eq('id', ticket.id);
    return json(200, { ok: true });
  }),
);
