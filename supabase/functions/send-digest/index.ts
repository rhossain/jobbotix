// POST /functions/v1/send-digest        (called hourly by pg_cron via pg_net)
//   Authorization: Bearer <DIGEST_CRON_SECRET>
//   { "userId": "..." }   optional: send to one user now, ignoring the hour
//
// For every user whose active search profile's digest_time falls in the
// current hour of their timezone, builds the morning digest from their data
// and sends it through Resend. Users who have already received one in the
// last 20 hours are skipped, so a cron re-run never double-sends.

import { json, serviceClient } from '../_shared/auth.ts';
import {
  buildDigest,
  digestDue,
  summariseRuns,
  type DigestRole,
  type DigestInterview,
  type DigestRun,
} from '../_shared/digest.ts';

const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM = Deno.env.get('DIGEST_FROM') ?? 'Jobbotix <digest@jobbotix.com>';
const APP_URL = Deno.env.get('APP_URL') ?? 'https://jobbotix.com';
const CRON_SECRET = Deno.env.get('DIGEST_CRON_SECRET') ?? '';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const bearer = req.headers
    .get('authorization')
    ?.replace(/^Bearer\s+/i, '')
    .trim();
  if (!CRON_SECRET || bearer !== CRON_SECRET)
    return json(401, { error: 'Not allowed' });
  if (!RESEND_KEY) return json(500, { error: 'RESEND_API_KEY is not set' });

  const body = (await req.json().catch(() => ({}))) as { userId?: string };
  const admin = serviceClient();
  const now = new Date();

  let profiles = admin
    .from('search_profiles')
    .select(
      'user_id, digest_time, digest_days, digest_min_score, digest_enabled, profiles!inner(email, name, timezone, suspended_at)',
    )
    .eq('active', true)
    // a suspended account gets no digest
    .is('profiles.suspended_at', null);
  if (body.userId) profiles = profiles.eq('user_id', body.userId);
  const { data: rows, error } = await profiles;
  if (error) return json(500, { error: error.message });

  const sent: string[] = [];
  const skipped: string[] = [];
  const failed: { userId: string; reason: string }[] = [];

  for (const row of rows ?? []) {
    const p = (
      Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
    ) as { email: string; name: string; timezone: string };
    const userId = row.user_id as string;
    if (
      !body.userId &&
      !digestDue(
        {
          digest_time: String(row.digest_time),
          digest_days: row.digest_days as number[] | null,
          digest_enabled: row.digest_enabled as boolean | null,
        },
        p.timezone,
        now,
      )
    ) {
      skipped.push(userId);
      continue;
    }

    // already sent today?
    const since = new Date(now.getTime() - 20 * 3_600_000).toISOString();
    const { data: recent } = await admin
      .from('role_events')
      .select('id')
      .eq('user_id', userId)
      .eq('kind', 'run')
      .contains('payload', { digest: true })
      .gte('created_at', since)
      .limit(1);
    if (!body.userId && recent?.length) {
      skipped.push(userId);
      continue;
    }

    const [newRoles, stale, run, interviews] = await Promise.all([
      admin
        .from('roles')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'new')
        .gte('score', Number(row.digest_min_score ?? 0))
        .gte('found_at', new Date(now.getTime() - 26 * 3_600_000).toISOString())
        .order('score', { ascending: false })
        .limit(20),
      admin
        .from('roles')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'shortlist')
        .lt(
          'status_changed_at',
          new Date(now.getTime() - 3 * 86_400_000).toISOString(),
        )
        .limit(10),
      admin
        .from('role_events')
        .select('payload, created_at')
        .eq('user_id', userId)
        .eq('kind', 'run')
        .order('created_at', { ascending: false })
        .limit(60),
      admin
        .from('interviews')
        .select(
          'role_id, kind, title, scheduled_at, interviewers, roles(company, title)',
        )
        .eq('user_id', userId)
        .eq('status', 'scheduled')
        .gte('scheduled_at', now.toISOString())
        .lte(
          'scheduled_at',
          new Date(now.getTime() + 3 * 86_400_000).toISOString(),
        )
        .order('scheduled_at', { ascending: true })
        .limit(10),
    ]);
    const upcoming: DigestInterview[] = (
      (interviews.data ?? []) as unknown as (Omit<
        DigestInterview,
        'company' | 'role_title'
      > & {
        roles: { company: string; title: string } | null;
      })[]
    ).map(({ roles, ...i }) => ({
      ...i,
      company: roles?.company ?? '',
      role_title: roles?.title ?? '',
    }));

    const digestRun: DigestRun | null = summariseRuns(run.data ?? [], now);

    const email = buildDigest({
      name: p.name,
      appUrl: APP_URL,
      now,
      run: digestRun,
      newRoles: (newRoles.data ?? []) as DigestRole[],
      stale: (stale.data ?? []) as DigestRole[],
      interviews: upcoming,
      timezone: p.timezone,
    });

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${RESEND_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: [p.email],
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
    });
    if (!res.ok) {
      failed.push({
        userId,
        reason: `Resend ${res.status}: ${(await res.text()).slice(0, 200)}`,
      });
      continue;
    }
    await admin.from('role_events').insert({
      user_id: userId,
      role_id: null,
      kind: 'run',
      payload: {
        digest: true,
        at: now.toISOString(),
        roles: (newRoles.data ?? []).length,
        stale: (stale.data ?? []).length,
      },
    });
    sent.push(userId);
  }

  return json(200, { sent: sent.length, skipped: skipped.length, failed });
});
