// POST /functions/v1/match-postings     (pg_cron hourly at :50, or by hand)
//   Authorization: Bearer <CRON_SECRET>
//   { "userId": "..." }   optional: one user only
//
// For each active search profile, reads pool postings that arrived since the
// profile was last matched, and for each one:
//   - drops it if it is not their kind of job or already in their roles
//   - stores it in excluded_roles with the reason if a rule rules it out
//   - otherwise scores it with their weights; the strongest candidates are
//     re-scored by the model when the user has an Anthropic key
// and files the best as new roles (score, reasons, gaps, a link to the pool).
// One "run" event per user summarises it for Today and the digest.

import { json, requireCronSecret, serviceClient } from '../_shared/auth.ts';
import { normaliseUrl, pairKey } from '../_shared/dedupe.ts';
import { fnv1a } from '../_shared/ingest.ts';
import {
  matchPosting,
  type MatchPosting,
  type MatchProfile,
} from '../_shared/match.ts';
import {
  heuristicScore,
  parseScoreReply,
  resolveWeights,
  scorePrompt,
  type ScoredPosting,
  type Weights,
} from '../_shared/score.ts';
import { readVaultSecret } from '../_shared/vault.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const ANTHROPIC_VERSION = '2023-06-01';
const TIME_BUDGET_MS = 110_000;

interface Sourcing {
  max_new_per_user_per_run: number;
  min_file_score: number;
  ai_scored_per_user_per_run: number;
  ai_min_heuristic_score: number;
  triage_model: string;
  lookback_days: number;
}

const DEFAULT_SOURCING: Sourcing = {
  max_new_per_user_per_run: 40,
  min_file_score: 30,
  ai_scored_per_user_per_run: 10,
  ai_min_heuristic_score: 40,
  triage_model: 'claude-haiku-4-5',
  lookback_days: 3,
};

type PostingWithSources = MatchPosting & {
  id: string;
  url: string;
  salary_text: string;
  first_seen_at: string;
  posting_sources: { source_id: string; url: string; first_seen_at: string }[];
};

type ProfileRow = MatchProfile & {
  user_id: string;
  min_seniority: string;
  scoring_weights: unknown;
  last_matched_at: string | null;
  profiles:
    | { anthropic_key_ref: string | null }
    | { anthropic_key_ref: string | null }[];
};

interface UserSummary {
  userId: string;
  considered: number;
  added: number;
  excluded: number;
  /** Region-locked postings left unjudged because the profile has no country. */
  needsCountry: number;
  aiScored: number;
  /** Model calls that failed, and the first reason (never the key). */
  aiFailed: number;
  aiError?: string;
  errors: string[];
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const denied = requireCronSecret(req);
  if (denied) return denied;
  const startedAt = Date.now();

  const body = (await req.json().catch(() => ({}))) as { userId?: string };
  const admin = serviceClient();

  const [{ data: settings }, { data: catalog }] = await Promise.all([
    admin
      .from('settings')
      .select('key, value')
      .in('key', ['sourcing', 'scoring_defaults']),
    admin.from('source_catalog').select('id, name'),
  ]);
  const setting = (k: string) =>
    (settings ?? []).find((s) => s.key === k)?.value as
      Record<string, unknown> | undefined;
  const cfg: Sourcing = {
    ...DEFAULT_SOURCING,
    ...(setting('sourcing') ?? {}),
  } as Sourcing;
  const defaults = setting('scoring_defaults');
  const sourceName = new Map(
    (catalog ?? []).map((c) => [c.id as string, c.name as string]),
  );

  let q = admin
    .from('search_profiles')
    .select(
      'user_id, target_roles, stacks, languages, employment_types, remote_rules, exclusions, home_country, allowed_countries, remote_only, min_seniority, scoring_weights, last_matched_at, profiles!inner(anthropic_key_ref)',
    )
    .eq('active', true);
  if (body.userId) q = q.eq('user_id', body.userId);
  const { data: profiles, error } = await q;
  if (error) return json(500, { error: error.message });

  const users: UserSummary[] = [];
  const deferred: string[] = [];
  for (const p of (profiles ?? []) as unknown as ProfileRow[]) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      deferred.push(p.user_id); // picked up next hour from the same watermark
      continue;
    }
    users.push(
      await matchForUser(
        admin,
        p,
        cfg,
        resolveWeights(defaults, p.scoring_weights),
        sourceName,
      ),
    );
  }
  return json(200, { users, deferred });
});

async function matchForUser(
  admin: SupabaseClient,
  p: ProfileRow,
  cfg: Sourcing,
  weights: Weights,
  sourceName: Map<string, string>,
): Promise<UserSummary> {
  const now = new Date();
  const summary: UserSummary = {
    userId: p.user_id,
    considered: 0,
    added: 0,
    excluded: 0,
    needsCountry: 0,
    aiScored: 0,
    aiFailed: 0,
    errors: [],
  };

  const floor = now.getTime() - cfg.lookback_days * 86_400_000;
  const since = new Date(
    Math.max(floor, p.last_matched_at ? Date.parse(p.last_matched_at) : 0),
  ).toISOString();

  const [postingsRes, rolesRes, excludedRes] = await Promise.all([
    admin
      .from('postings')
      .select(
        'id, title, company, url, description, tags, location, remote_policy, hiring_countries, hiring_regions, source_country, employment_type, seniority, salary_text, posted_at, expires_at, first_seen_at, posting_sources(source_id, url, first_seen_at)',
      )
      .gt('first_seen_at', since)
      .order('first_seen_at', { ascending: true })
      .limit(800),
    admin
      .from('roles')
      .select('url, company, title, posting_id')
      .eq('user_id', p.user_id)
      .limit(10_000),
    admin
      .from('excluded_roles')
      .select('url')
      .eq('user_id', p.user_id)
      .gte('found_at', new Date(now.getTime() - 60 * 86_400_000).toISOString())
      .limit(10_000),
  ]);
  if (postingsRes.error) {
    summary.errors.push(postingsRes.error.message);
    return summary;
  }
  const postings = (postingsRes.data ?? []) as unknown as PostingWithSources[];
  if (!postings.length) return summary;

  const haveIds = new Set(
    (rolesRes.data ?? []).map((r) => r.posting_id).filter(Boolean),
  );
  const haveUrls = new Set(
    (rolesRes.data ?? []).map((r) => normaliseUrl(r.url)),
  );
  const havePairs = new Set(
    (rolesRes.data ?? []).map((r) => pairKey(r.company, r.title)),
  );
  const excludedUrls = new Set(
    (excludedRes.data ?? []).map((r) => normaliseUrl(r.url)),
  );

  const profile: MatchProfile = {
    target_roles: p.target_roles ?? [],
    stacks: p.stacks ?? [],
    languages: p.languages?.length ? p.languages : ['english'],
    employment_types: p.employment_types ?? ['full_time', 'contract'],
    remote_rules: p.remote_rules ?? {},
    exclusions: p.exclusions ?? {},
    home_country: p.home_country,
    allowed_countries: p.allowed_countries ?? [],
    remote_only: p.remote_only !== false,
  };

  const candidates: {
    post: PostingWithSources;
    link: string;
    source: string;
    scored: ScoredPosting;
    method: 'heuristic' | 'ai';
    heuristic: number;
  }[] = [];
  const excludedRows: {
    user_id: string;
    company: string;
    title: string;
    url: string;
    reason: string;
  }[] = [];

  for (const post of postings) {
    const first = [...(post.posting_sources ?? [])].sort((a, b) =>
      a.first_seen_at.localeCompare(b.first_seen_at),
    )[0];
    const link = first?.url || post.url;
    if (
      haveIds.has(post.id) ||
      haveUrls.has(normaliseUrl(link)) ||
      haveUrls.has(normaliseUrl(post.url)) ||
      havePairs.has(pairKey(post.company, post.title))
    )
      continue;
    summary.considered++;

    const r = matchPosting(profile, post, now);
    if (r.kind === 'irrelevant') continue;
    if (r.kind === 'needs_country') {
      summary.needsCountry++;
      continue;
    }
    if (r.kind === 'excluded') {
      if (!excludedUrls.has(normaliseUrl(link)) && excludedRows.length < 50) {
        excludedRows.push({
          user_id: p.user_id,
          company: post.company,
          title: post.title,
          url: link,
          reason: r.reason,
        });
        excludedUrls.add(normaliseUrl(link));
      }
      continue;
    }
    const scored = heuristicScore(profile, post, weights);
    candidates.push({
      post,
      link,
      source: first?.source_id ?? '',
      scored,
      method: 'heuristic',
      heuristic: scored.score,
    });
    havePairs.add(pairKey(post.company, post.title)); // one role per company+title per run
  }

  // Strongest first; the model re-scores the top ones when the user has a key.
  candidates.sort((a, b) => b.scored.score - a.scored.score);
  const keyRef = (Array.isArray(p.profiles) ? p.profiles[0] : p.profiles)
    ?.anthropic_key_ref;
  const apiKey = keyRef ? await readVaultSecret(admin, keyRef) : null;
  if (apiKey && cfg.ai_scored_per_user_per_run > 0) {
    const top = candidates
      .filter((c) => c.scored.score >= cfg.ai_min_heuristic_score)
      .slice(0, cfg.ai_scored_per_user_per_run);
    for (let i = 0; i < top.length; i += 3) {
      await Promise.all(
        top.slice(i, i + 3).map(async (c) => {
          const ai = await aiScore(
            admin,
            p,
            apiKey,
            cfg.triage_model,
            weights,
            profile,
            c.post,
            c.heuristic,
          );
          if ('failed' in ai) {
            summary.aiFailed++;
            summary.aiError ??= ai.failed;
            return;
          }
          summary.aiScored++;
          c.method = 'ai';
          c.scored = {
            ...c.scored,
            score: ai.score,
            reasons: ai.reasons.length ? ai.reasons : c.scored.reasons,
            gaps: ai.gaps.length ? ai.gaps : c.scored.gaps,
            aiMatch: ai.aiMatch || c.scored.aiMatch,
          };
        }),
      );
    }
    candidates.sort((a, b) => b.scored.score - a.scored.score);
  }

  const toFile = candidates
    .filter((c) => c.scored.score >= cfg.min_file_score)
    .slice(0, cfg.max_new_per_user_per_run);
  for (const c of toFile) {
    const { post, scored } = c;
    const { data: inserted, error } = await admin
      .from('roles')
      .insert({
        user_id: p.user_id,
        company: post.company,
        title: post.title,
        url: c.link,
        source: sourceName.get(c.source) ?? c.source,
        location: post.location,
        remote_scope: post.location,
        type: post.employment_type,
        salary: post.salary_text,
        posted_at: post.posted_at ? post.posted_at.slice(0, 10) : null,
        found_at: now.toISOString(),
        stack: scored.stack,
        score: scored.score,
        score_breakdown: {
          ...scored.breakdown,
          method: c.method,
          heuristic: c.heuristic,
        },
        reasons: scored.reasons,
        gaps: scored.gaps,
        ai_match: scored.aiMatch,
        posting_text: post.description,
        posting_hash: post.description ? fnv1a(post.description) : '',
        posting_id: post.id,
        source_id: c.source || null,
        remote_policy: post.remote_policy,
        hiring_countries: post.hiring_countries,
      })
      .select('id')
      .single();
    if (error) {
      if (error.code !== '23505')
        summary.errors.push(
          `${post.company} / ${post.title}: ${error.message}`,
        );
      continue;
    }
    summary.added++;
    await admin.from('role_events').insert({
      user_id: p.user_id,
      role_id: inserted.id,
      kind: 'ingested',
      payload: {
        score: scored.score,
        source: sourceName.get(c.source) ?? c.source,
        method: c.method,
      },
    });
  }

  if (excludedRows.length) {
    const { error } = await admin
      .from('excluded_roles')
      .insert(excludedRows.map((x) => ({ ...x, found_at: now.toISOString() })));
    if (error) summary.errors.push(`excluded_roles: ${error.message}`);
    else summary.excluded = excludedRows.length;
  }

  await admin.from('role_events').insert({
    user_id: p.user_id,
    role_id: null,
    kind: 'run',
    payload: {
      at: now.toISOString(),
      searched: summary.considered,
      added: summary.added,
      excluded: summary.excluded,
      source: 'jobbotix',
      aiScored: summary.aiScored,
      aiFailed: summary.aiFailed,
      ...(summary.aiError ? { aiError: summary.aiError } : {}),
      needsCountry: summary.needsCountry,
    },
  });

  await admin
    .from('search_profiles')
    .update({ last_matched_at: postings[postings.length - 1].first_seen_at })
    .eq('user_id', p.user_id)
    .eq('active', true);

  return summary;
}

async function aiScore(
  admin: SupabaseClient,
  p: ProfileRow,
  apiKey: string,
  model: string,
  weights: Weights,
  profile: MatchProfile,
  post: MatchPosting,
  heuristic: number,
): Promise<
  NonNullable<ReturnType<typeof parseScoreReply>> | { failed: string }
> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 400,
        messages: [
          {
            role: 'user',
            content: scorePrompt(
              { ...profile, min_seniority: p.min_seniority },
              weights,
              post,
              heuristic,
            ),
          },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      // Anthropic error bodies name the problem ("invalid x-api-key", an
      // unknown model, no credit); keep that, never the key.
      const detail = payload?.error?.message ?? res.statusText;
      return {
        failed: `Anthropic ${res.status}: ${String(detail).slice(0, 200)}`,
      };
    }
    const reply = Array.isArray(payload?.content)
      ? payload.content.map((c: { text?: string }) => c.text ?? '').join('')
      : '';
    const parsed = parseScoreReply(reply);
    const u = payload?.usage ?? {};
    await admin.from('ai_usage').insert({
      user_id: p.user_id,
      job: 'score',
      model,
      tokens_in: Number(u.input_tokens ?? 0),
      tokens_out: Number(u.output_tokens ?? 0),
      cost_usd: 0,
    });
    return parsed ?? { failed: 'The model reply had no usable score' };
  } catch (e) {
    return { failed: `Could not reach Anthropic: ${(e as Error).message}` };
  }
}
