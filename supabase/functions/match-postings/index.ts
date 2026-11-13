// POST /functions/v1/match-postings     (pg_cron hourly at :50, or by hand)
//   Authorization: Bearer <CRON_SECRET>
//   { "userId": "..." }   optional: one user only
//
// For each search profile (an account can hold several; a plan's limit
// decides how many of them are searched), reads pool postings that arrived
// since the profile was last matched, and for each one:
//   - drops it if it is not their kind of job or already in their roles
//   - stores it in excluded_roles with the reason if a rule rules it out
//   - otherwise scores it with their weights; the strongest candidates are
//     re-scored by the model when the user has an AI connection
// and files the best as new roles (score, reasons, gaps, a link to the pool).
// One "run" event per profile summarises it for Today and the digest.

import { judgePrompt, nearMiss, parseJudgeReply } from '../_shared/judge.ts';
import type { Grade } from '../_shared/role.ts';
import { FAST_MODEL } from '../_shared/models.ts';
import { loadConnections, runAi } from '../_shared/ai.ts';
import { platformKey } from '../_shared/credits.ts';
import { alertWorthy, buildAlert, type AlertRole } from '../_shared/alert.ts';
import { json, requireCronSecret, serviceClient } from '../_shared/auth.ts';
import { normaliseUrl, pairKey } from '../_shared/dedupe.ts';
import { fnv1a } from '../_shared/ingest.ts';
import {
  matchPosting,
  type MatchPosting,
  type MatchProfile,
  roleFit,
} from '../_shared/match.ts';
import {
  heuristicScore,
  parseScoreReply,
  resolveWeights,
  scorePrompt,
  type ScoredPosting,
  type Weights,
} from '../_shared/score.ts';
import { can, limitOf } from '../_shared/entitlements.ts';
import { searchedProfiles } from '../_shared/profiles.ts';
import { loadEntitlements } from '../_shared/gate.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM = Deno.env.get('DIGEST_FROM') ?? 'Jobbotix <digest@jobbotix.com>';
const APP_URL = Deno.env.get('APP_URL') ?? 'https://jobbotix.com';
const TIME_BUDGET_MS = 110_000;

interface Sourcing {
  max_new_per_user_per_run: number;
  min_file_score: number;
  ai_scored_per_user_per_run: number;
  ai_min_heuristic_score: number;
  triage_model: string;
  lookback_days: number;
  /** Titles the AI check looks at per user per run (uncertain matches and near misses); 0 turns it off. */
  ai_judged_per_user_per_run: number;
  /** How far back the pool is matched: for a new or just-changed profile, and after a long pause. */
  first_match_days: number;
}

const DEFAULT_SOURCING: Sourcing = {
  max_new_per_user_per_run: 40,
  min_file_score: 30,
  ai_scored_per_user_per_run: 10,
  ai_min_heuristic_score: 40,
  triage_model: FAST_MODEL,
  lookback_days: 3,
  first_match_days: 30,
  ai_judged_per_user_per_run: 30,
};

type PostingWithSources = MatchPosting & {
  id: string;
  url: string;
  salary_text: string;
  first_seen_at: string;
  posting_sources: { source_id: string; url: string; first_seen_at: string }[];
};

type ProfileRow = MatchProfile & {
  id: string;
  name: string;
  /** True on the account's main profile. */
  active: boolean;
  created_at: string;
  user_id: string;
  min_seniority: string;
  scoring_weights: unknown;
  last_matched_at: string | null;
  alert_min_score: number | null;
  profiles: ProfileBits | ProfileBits[];
};

type ProfileBits = {
  email: string;
  name: string;
};

interface UserSummary {
  userId: string;
  /** The profile's name, when the account searches with several. */
  profile?: string;
  considered: number;
  added: number;
  excluded: number;
  /** Region-locked postings left unjudged because the profile has no country. */
  needsCountry: number;
  /** Another kind of job: no target role or stack in the title. */
  notRelevant: number;
  /** Their kind of job, but scored under the filing threshold. */
  lowMatch: number;
  /** Titles the AI check looked at, turned down, and brought in. */
  aiJudged: number;
  aiRejected: number;
  aiRescued: number;
  /** Near misses the AI check called the same job, before the other rules. */
  aiConfirmed: number;
  aiScored: number;
  /** Model calls that failed, and the first reason (never the key). */
  aiFailed: number;
  aiError?: string;
  /** Roles in the instant-alert email this run. */
  alerted?: number;
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
      'id, name, active, created_at, user_id, target_roles, stacks, languages, employment_types, remote_rules, exclusions, home_country, allowed_countries, remote_only, min_seniority, scoring_weights, last_matched_at, alert_min_score, profiles!inner(email, name, suspended_at)',
    )
    // a suspended account is not matched (or scored, or mailed)
    .is('profiles.suspended_at', null);
  if (body.userId) q = q.eq('user_id', body.userId);
  const { data: profiles, error } = await q;
  if (error) return json(500, { error: error.message });

  const byUser = new Map<string, ProfileRow[]>();
  for (const p of (profiles ?? []) as unknown as ProfileRow[])
    byUser.set(p.user_id, [...(byUser.get(p.user_id) ?? []), p]);

  const users: UserSummary[] = [];
  const deferred: string[] = [];
  /** Profiles kept but not searched: over the plan's limit. */
  let overLimit = 0;
  for (const [userId, rows] of byUser) {
    // One profile needs no plan lookup: the main one is always searched.
    const mine =
      rows.length > 1
        ? searchedProfiles(
            rows,
            limitOf(await loadEntitlements(admin, userId), 'search_profiles'),
          )
        : rows;
    overLimit += rows.length - mine.length;
    for (const p of mine) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        // picked up next hour from the same watermark
        if (!deferred.includes(userId)) deferred.push(userId);
        continue;
      }
      users.push(
        await matchForUser(
          admin,
          p,
          cfg,
          resolveWeights(defaults, p.scoring_weights),
          sourceName,
          mine.length > 1,
        ),
      );
    }
  }
  return json(200, { users, deferred, ...(overLimit ? { overLimit } : {}) });
});

async function matchForUser(
  admin: SupabaseClient,
  p: ProfileRow,
  cfg: Sourcing,
  weights: Weights,
  sourceName: Map<string, string>,
  /** The account searches with several profiles. */
  several = false,
): Promise<UserSummary> {
  const now = new Date();
  const summary: UserSummary = {
    userId: p.user_id,
    ...(several ? { profile: p.name } : {}),
    considered: 0,
    added: 0,
    excluded: 0,
    needsCountry: 0,
    notRelevant: 0,
    lowMatch: 0,
    aiJudged: 0,
    aiRejected: 0,
    aiRescued: 0,
    aiConfirmed: 0,
    aiScored: 0,
    aiFailed: 0,
    errors: [],
  };

  // The watermark is used as Postgres wrote it (microseconds): a JS Date
  // would round it down and re-read the last posting every hour.
  // A profile that is new or was just changed (last_matched_at cleared) is
  // judged against the pool it already holds, weeks back, so a new
  // designation gets results at once. The pool is read oldest first, 800
  // postings a run, and the watermark carries the catch-up from hour to hour.
  const floor = new Date(now.getTime() - cfg.first_match_days * 86_400_000);
  const since =
    p.last_matched_at && Date.parse(p.last_matched_at) >= floor.getTime()
      ? p.last_matched_at
      : floor.toISOString();

  const [postingsRes, rolesRes, excludedRes] = await Promise.all([
    admin
      .from('postings')
      .select(
        'id, title, company, url, description, tags, location, remote_policy, hiring_countries, hiring_regions, source_country, employment_type, seniority, salary_min, salary_max, salary_currency, salary_text, posted_at, expires_at, first_seen_at, posting_sources(source_id, url, first_seen_at)',
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
    min_seniority: p.min_seniority,
  };

  const candidates: {
    post: PostingWithSources;
    link: string;
    source: string;
    scored: ScoredPosting;
    method: 'heuristic' | 'ai';
    heuristic: number;
    /** How the rules recognised it: a title grade, a stack alone, or the AI check. */
    grade: Grade | 'stack' | 'judged';
  }[] = [];
  /** Rejected by the rules, but close enough for the AI check to look at. */
  const nearMisses: {
    post: PostingWithSources;
    link: string;
    source: string;
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
    if (r.kind === 'irrelevant') {
      if (r.why.startsWith('no target role')) {
        summary.notRelevant++;
        if (
          nearMisses.length < 60 &&
          nearMiss(profile.target_roles, post.title)
        )
          nearMisses.push({ post, link, source: first?.source_id ?? '' });
      }
      continue;
    }
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
      grade: roleFit(profile, post)?.grade ?? 'stack',
    });
    havePairs.add(pairKey(post.company, post.title)); // one role per company+title per run
  }

  // Model help only for accounts whose plan covers AI (everyone while billing
  // is off); the rules above are never gated. (An account without a key can
  // still be served on credits, where the Pro route exists; runAi finds out.)
  const connections =
    candidates.length || nearMisses.length
      ? await loadConnections(admin, p.user_id)
      : [];
  const aiAllowed =
    (candidates.length > 0 || nearMisses.length > 0) &&
    (connections.length > 0 || !!platformKey()) &&
    can(await loadEntitlements(admin, p.user_id), 'ai');

  // The AI check: one call for the titles the rules are unsure about. An
  // uncertain match it turns down goes to the excluded list with the reason;
  // a near miss it confirms goes through the remaining rules like any other.
  if (aiAllowed && cfg.ai_judged_per_user_per_run > 0) {
    const half = Math.max(1, Math.floor(cfg.ai_judged_per_user_per_run / 2));
    const uncertain = candidates
      .filter((c) => c.grade !== 'exact' && c.grade !== 'variant')
      .sort((a, b) => b.heuristic - a.heuristic)
      .slice(0, half);
    const near = nearMisses.slice(
      0,
      cfg.ai_judged_per_user_per_run - uncertain.length,
    );
    const items = [...uncertain.map((c) => c.post), ...near.map((n) => n.post)];
    if (items.length) {
      const ai = await runAi(
        admin,
        p.user_id,
        {
          prompt: judgePrompt(
            profile.target_roles,
            items.map((post) => ({
              title: post.title,
              company: post.company,
              about: post.description.replace(/\s+/g, ' ').slice(0, 160),
            })),
          ),
          maxTokens: 900,
          timeoutMs: 30_000,
        },
        {
          job: 'score',
          fast: true,
          anthropicFastModel: cfg.triage_model,
          parse: (reply) =>
            parseJudgeReply(reply, items.length, profile.target_roles.length),
          connections,
        },
      );
      if (ai.ok) {
        summary.aiJudged = items.length;
        const turnedDown = new Set<PostingWithSources>();
        uncertain.forEach((c, i) => {
          if (ai.value.get(i)?.same !== false) return; // no verdict: the rules stand
          turnedDown.add(c.post);
          summary.aiRejected++;
          if (
            !excludedUrls.has(normaliseUrl(c.link)) &&
            excludedRows.length < 60
          ) {
            excludedRows.push({
              user_id: p.user_id,
              company: c.post.company,
              title: c.post.title,
              url: c.link,
              reason: 'A different job from your target roles (checked by AI)',
            });
            excludedUrls.add(normaliseUrl(c.link));
          }
        });
        if (turnedDown.size)
          for (let i = candidates.length - 1; i >= 0; i--)
            if (turnedDown.has(candidates[i].post)) candidates.splice(i, 1);
        near.forEach((n, i) => {
          const v = ai.value.get(uncertain.length + i);
          if (!v?.same || havePairs.has(pairKey(n.post.company, n.post.title)))
            return;
          summary.aiConfirmed++;
          const again = matchPosting(profile, n.post, now, {
            assumeRelevant: true,
          });
          if (again.kind === 'needs_country') summary.needsCountry++;
          if (again.kind === 'excluded') {
            if (
              !excludedUrls.has(normaliseUrl(n.link)) &&
              excludedRows.length < 60
            ) {
              excludedRows.push({
                user_id: p.user_id,
                company: n.post.company,
                title: n.post.title,
                url: n.link,
                reason: again.reason,
              });
              excludedUrls.add(normaliseUrl(n.link));
            }
          }
          if (again.kind !== 'match') return;
          const role = profile.target_roles[v.role] ?? profile.target_roles[0];
          const scored = heuristicScore(profile, n.post, weights, {
            role,
            index: v.role,
          });
          candidates.push({
            post: n.post,
            link: n.link,
            source: n.source,
            scored,
            method: 'heuristic',
            heuristic: scored.score,
            grade: 'judged',
          });
          havePairs.add(pairKey(n.post.company, n.post.title));
          summary.aiRescued++;
        });
      } else if (ai.reason !== 'no_connection' && ai.reason !== 'no_credits') {
        // the rules stand for this run; the next one asks again
        summary.aiFailed++;
        summary.aiError ??= ai.message;
      }
    }
  }

  // Strongest first; the model re-scores the top ones when the user has an
  // AI connection.
  candidates.sort((a, b) => b.scored.score - a.scored.score);
  const top =
    cfg.ai_scored_per_user_per_run > 0
      ? candidates
          .filter((c) => c.scored.score >= cfg.ai_min_heuristic_score)
          .slice(0, cfg.ai_scored_per_user_per_run)
      : [];
  const mayUseAi = top.length > 0 && aiAllowed;
  if (mayUseAi) {
    // Free tiers allow only a few calls a minute, so one at a time there;
    // three at once when every connection is Anthropic.
    const atOnce = connections.every((c) => c.provider === 'anthropic') ? 3 : 1;
    let limited = false;
    for (let i = 0; i < top.length && !limited; i += atOnce) {
      await Promise.all(
        top.slice(i, i + atOnce).map(async (c) => {
          const ai = await runAi(
            admin,
            p.user_id,
            {
              prompt: scorePrompt(
                { ...profile, min_seniority: p.min_seniority },
                weights,
                c.post,
                c.heuristic,
              ),
              maxTokens: 400,
              timeoutMs: 30_000,
            },
            {
              job: 'score',
              fast: true,
              anthropicFastModel: cfg.triage_model,
              parse: parseScoreReply,
              connections,
            },
          );
          if (!ai.ok) {
            // Nothing can answer for this account right now (every
            // connection at its rate limit, or no key and no credits to
            // use): the rest of this run keeps the rule-based score and
            // the next run tries again.
            if (ai.reason !== 'failed' && ai.reason !== 'bad_output')
              limited = true;
            // Having no key and no credits is not a failure to report.
            if (ai.reason === 'no_connection' || ai.reason === 'no_credits')
              return;
            summary.aiFailed++;
            summary.aiError ??= ai.message;
            return;
          }
          summary.aiScored++;
          c.method = 'ai';
          c.scored = {
            ...c.scored,
            score: ai.value.score,
            reasons: ai.value.reasons.length
              ? ai.value.reasons
              : c.scored.reasons,
            gaps: ai.value.gaps.length ? ai.value.gaps : c.scored.gaps,
            aiMatch: ai.value.aiMatch || c.scored.aiMatch,
          };
        }),
      );
    }
    candidates.sort((a, b) => b.scored.score - a.scored.score);
  }

  const filed: AlertRole[] = [];
  const filedUrls: string[] = [];
  const toFile = candidates
    .filter((c) => c.scored.score >= cfg.min_file_score)
    .slice(0, cfg.max_new_per_user_per_run);

  // Their kind of job, but too weak to file: kept with the score, so "why
  // not" has an answer. The strongest few, not the whole tail.
  const low = candidates.filter((c) => c.scored.score < cfg.min_file_score);
  summary.lowMatch = low.length;
  for (const c of low.slice(0, 15)) {
    if (excludedUrls.has(normaliseUrl(c.link)) || excludedRows.length >= 60)
      continue;
    excludedRows.push({
      user_id: p.user_id,
      company: c.post.company,
      title: c.post.title,
      url: c.link,
      reason: `Low match (score ${c.scored.score}): ${c.scored.gaps[0] ?? 'few of your signals'}`,
    });
    excludedUrls.add(normaliseUrl(c.link));
  }
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
        search_profile_id: p.id,
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
    filedUrls.push(c.link);
    filed.push({
      id: inserted.id,
      company: post.company,
      title: post.title,
      score: scored.score,
      source: sourceName.get(c.source) ?? c.source,
      location: post.location,
    });
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

  // What one profile passed over, another may have just filed: a role is not
  // also listed as passed over.
  if (several && filedUrls.length) {
    const { error } = await admin
      .from('excluded_roles')
      .delete()
      .eq('user_id', p.user_id)
      .in('url', filedUrls);
    if (error) summary.errors.push(`excluded_roles: ${error.message}`);
  }

  if (excludedRows.length) {
    const { error } = await admin
      .from('excluded_roles')
      .insert(excludedRows.map((x) => ({ ...x, found_at: now.toISOString() })));
    if (error) summary.errors.push(`excluded_roles: ${error.message}`);
    else summary.excluded = excludedRows.length;
  }

  // Instant alert for roles at or above the user's threshold. Alerts are
  // part of Pro (feature instant_alerts): a plan without them keeps its
  // threshold and gets the roles in the digest instead. The plan is only
  // looked up when there is something to send.
  const worthy = alertWorthy(filed, p.alert_min_score);
  const me = Array.isArray(p.profiles) ? p.profiles[0] : p.profiles;
  const mayAlert =
    worthy.length > 0 &&
    !!RESEND_KEY &&
    !!me?.email &&
    can(await loadEntitlements(admin, p.user_id), 'instant_alerts');
  if (mayAlert && me?.email) {
    const email = buildAlert({
      name: me.name ?? '',
      appUrl: APP_URL,
      roles: worthy,
    });
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${RESEND_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: [me.email],
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
    }).catch((e: Error) => ({ ok: false, statusText: e.message }) as Response);
    if (res.ok) summary.alerted = worthy.length;
    else summary.errors.push(`alert email: ${res.statusText}`);
  }

  // A run that saw nothing new (all already tracked) is not worth reporting.
  if (summary.considered > 0)
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
        notRelevant: summary.notRelevant,
        lowMatch: summary.lowMatch,
        ...(summary.aiJudged
          ? {
              aiJudged: summary.aiJudged,
              aiRejected: summary.aiRejected,
              aiRescued: summary.aiRescued,
              aiConfirmed: summary.aiConfirmed,
            }
          : {}),
        ...(summary.alerted ? { alerted: summary.alerted } : {}),
        ...(several ? { profile: p.name } : {}),
      },
    });

  await admin
    .from('search_profiles')
    .update({ last_matched_at: postings[postings.length - 1].first_seen_at })
    .eq('id', p.id);

  return summary;
}
