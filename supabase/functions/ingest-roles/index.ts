// POST /functions/v1/ingest-roles
// Receives one search run's results from a user's scheduled task.
//
//   Authorization: Bearer jbx_<ingest key>
//   Content-Type: application/json
//   { runAt, searched, roles: [...], excluded: [...] }   (IngestPayload)
//
// The key resolves to a user through resolve_ingest_key (service role). Roles
// are upserted on (user_id, url); an existing row keeps its status, notes and
// any edited cover letter, and only metadata the run can improve is refreshed.
// Every run writes one "run" event so Today can show the summary.

import { json, resolveIngestKey, serviceClient } from '../_shared/auth.ts';
import {
  normaliseRole,
  type IngestPayload,
  type IngestResult,
} from '../_shared/ingest.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  let payload: IngestPayload;
  try {
    payload = (await req.json()) as IngestPayload;
  } catch {
    return json(400, { error: 'Body must be JSON' });
  }
  if (!payload || !Array.isArray(payload.roles))
    return json(400, { error: 'roles[] is required' });
  if (payload.roles.length > 500)
    return json(413, { error: 'At most 500 roles per run' });

  const admin = serviceClient();
  const userId = await resolveIngestKey(req, admin);
  if (userId instanceof Response) return userId;

  const runAt =
    payload.runAt && !Number.isNaN(Date.parse(payload.runAt))
      ? payload.runAt
      : new Date().toISOString();
  const result: IngestResult = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    excludedStored: 0,
    errors: [],
  };

  for (const raw of payload.roles) {
    const role = normaliseRole(raw);
    if (!role) {
      result.skipped++;
      result.errors.push({
        url: raw?.url ?? '',
        message: 'company, title, url and score are required',
      });
      continue;
    }

    const { data: existing } = await admin
      .from('roles')
      .select('id, status, notes, cover_letter')
      .eq('user_id', userId)
      .eq('url', role.url)
      .maybeSingle();

    if (existing) {
      const { error } = await admin
        .from('roles')
        .update({
          // refresh what a run can know better; keep what the user owns
          source: role.source,
          location: role.location,
          remote_scope: role.remote_scope,
          type: role.type,
          salary: role.salary,
          posted_at: role.posted_at,
          stack: role.stack,
          score: role.score,
          score_breakdown: role.score_breakdown,
          reasons: role.reasons,
          gaps: role.gaps,
          ai_match: role.ai_match,
          cover_letter: existing.cover_letter || role.cover_letter,
          posting_text: role.posting_text || undefined,
          posting_hash: role.posting_hash || undefined,
        })
        .eq('id', existing.id);
      if (error) result.errors.push({ url: role.url, message: error.message });
      else result.updated++;
      continue;
    }

    const { data: inserted, error } = await admin
      .from('roles')
      .insert({ ...role, user_id: userId, found_at: runAt })
      .select('id')
      .single();
    if (error || !inserted) {
      result.errors.push({
        url: role.url,
        message: error?.message ?? 'insert failed',
      });
      continue;
    }
    result.inserted++;

    if (role.qa.length) {
      await admin
        .from('screening_answers')
        .insert(
          role.qa.map((x, i) => ({
            user_id: userId,
            role_id: inserted.id,
            question: x.q,
            answer: x.a,
            position: i,
          })),
        );
    }
    await admin.from('role_events').insert({
      user_id: userId,
      role_id: inserted.id,
      kind: 'ingested',
      payload: { score: role.score, source: role.source, runAt },
    });
  }

  const excluded = Array.isArray(payload.excluded)
    ? payload.excluded.slice(0, 500)
    : [];
  if (excluded.length) {
    const { error } = await admin.from('excluded_roles').insert(
      excluded
        .filter((x) => x && typeof x.reason === 'string' && x.reason.trim())
        .map((x) => ({
          user_id: userId,
          company: (x.company ?? '').slice(0, 200),
          title: (x.title ?? '').slice(0, 200),
          url: (x.url ?? '').slice(0, 1000),
          reason: x.reason.slice(0, 500),
          found_at: runAt,
        })),
    );
    if (!error) result.excludedStored = excluded.length;
  }

  await admin.from('role_events').insert({
    user_id: userId,
    role_id: null,
    kind: 'run',
    payload: {
      at: runAt,
      searched: Number(payload.searched) || 0,
      added: result.inserted,
      updated: result.updated,
      excluded: result.excludedStored,
    },
  });

  return json(200, result);
});
