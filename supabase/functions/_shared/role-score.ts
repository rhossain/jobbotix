// Scoring one role the user added by hand (a posting URL or pasted text).
//
// The scheduled run scores pool postings in match-postings; a role added from
// a URL never passes through it, so it would sit at 0 with no reasons. This
// applies the same rules to one role: the user's search profile and weights,
// the same keyword pass (heuristicScore), and the same model re-score when the
// user has an AI connection. Where the run would have dropped or excluded the posting,
// the reason is shown first in "Watch out" instead, since the user chose it.
//
// guessRemote and rolePosting are pure (tested in role-score.test.ts);
// scoreRole reads the profile and settings and calls the model.

import { FAST_MODEL } from './models.ts';
import { runAi, type ConnectionRow } from './ai.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { parseLocations } from './countries.ts';
import { matchPosting, type MatchPosting, type MatchProfile } from './match.ts';
import {
  heuristicScore,
  parseScoreReply,
  resolveWeights,
  scorePrompt,
  type ScoredPosting,
  type Weights,
} from './score.ts';
import type { RemotePolicy } from './sources/types.ts';
import type { EmploymentType } from './employment.ts';

const DEFAULT_TRIAGE_MODEL = FAST_MODEL;

export interface RemoteGuess {
  remote_policy: RemotePolicy;
  hiring_countries: string[];
  hiring_regions: string[];
}

/** "Worldwide" said about hiring, not about customers ("used worldwide"). */
const HIRING_WORLDWIDE =
  /\b(remote[\s,(–-]*(worldwide|globally|global|anywhere)|work(ing)? from anywhere|anywhere in the world|hire (talent |people |engineers )?(from )?anywhere|open to (candidates|applicants|people) (from |in )?(anywhere|any country|all countries|worldwide)|no (location|country) restrictions?|location[- ]independent)\b/i;
const REMOTE_IN_TEXT =
  /\b(fully remote|100% remote|remote[- ]first|remote[- ]only|remote (position|role|job|team|company)|work remotely|distributed team)\b/i;

/**
 * Remote policy from the role's location line and posting text, in the terms
 * the pool uses (worldwide / region_locked / hybrid / onsite / unknown).
 */
export function guessRemote(location: string, text: string): RemoteGuess {
  const loc = (location ?? '').trim();
  const head = (text ?? '').slice(0, 8000);
  const none: RemoteGuess = {
    remote_policy: 'unknown',
    hiring_countries: [],
    hiring_regions: [],
  };
  const places = (s: string) => {
    const q = s
      .replace(/\b(remote|hybrid|on[- ]?site|in[- ]office|only|based)\b/gi, ' ')
      .replace(/[()]/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\s\-–:,]+|[\s\-–:,]+$/g, '')
      .trim();
    return q ? parseLocations([q]) : null;
  };

  if (/\bhybrid\b/i.test(loc)) {
    const p = places(loc);
    return {
      remote_policy: 'hybrid',
      hiring_countries: p?.countries ?? [],
      hiring_regions: p?.regions ?? [],
    };
  }
  const remote = /\bremote\b/i.test(loc) || REMOTE_IN_TEXT.test(head);
  if (remote) {
    if (HIRING_WORLDWIDE.test(loc) || HIRING_WORLDWIDE.test(head))
      return { ...none, remote_policy: 'worldwide' };
    const p = places(loc);
    if (p?.worldwide) return { ...none, remote_policy: 'worldwide' };
    if (p && (p.countries.length || p.regions.length))
      return {
        remote_policy: 'region_locked',
        hiring_countries: p.countries,
        hiring_regions: p.regions,
      };
    return none;
  }
  if (loc) {
    const p = places(loc);
    if (p && (p.countries.length || p.regions.length || p.unknown.length))
      return {
        remote_policy: 'onsite',
        hiring_countries: p.countries,
        hiring_regions: p.regions,
      };
  }
  return none;
}

export interface RoleForScoring {
  company: string;
  title: string;
  location: string;
  type: EmploymentType;
  posting_text: string;
  stack: string[];
  posted_at?: string | null;
  /** The pay line as written on the role. */
  salary?: string;
  /** Known remote policy (a role the run filed from the pool); guessed otherwise. */
  remote?: RemoteGuess;
}

/** The role in the shape the match and score rules read. */
export function rolePosting(role: RoleForScoring): MatchPosting {
  const remote = role.remote ?? guessRemote(role.location, role.posting_text);
  return {
    title: role.title,
    company: role.company,
    description: role.posting_text ?? '',
    tags: role.stack ?? [],
    location: role.location ?? '',
    remote_policy: remote.remote_policy,
    hiring_countries: remote.hiring_countries,
    hiring_regions: remote.hiring_regions,
    source_country: null,
    employment_type: role.type,
    seniority: '',
    posted_at: role.posted_at ?? null,
    expires_at: null,
    salary_text: role.salary ?? '',
  };
}

/**
 * Where the run would have dropped or excluded the posting, that reason leads
 * "Watch out". When the reason is where it can be done from, the remote bonus
 * no longer applies, so that part comes off the score.
 */
export function applyVerdict(
  profile: MatchProfile,
  post: MatchPosting,
  scored: ScoredPosting,
): ScoredPosting {
  const r = matchPosting(profile, post);
  if (r.kind === 'match') return scored;
  const lead = (line: string) => ({
    ...scored,
    gaps: [line, ...scored.gaps.filter((g) => g !== line)].slice(0, 4),
  });
  if (r.kind === 'irrelevant')
    return lead(
      r.why === 'expired'
        ? 'The posting has expired'
        : r.why.startsWith('older')
          ? 'Posted longer ago than your profile allows'
          : 'Not one of your target roles or stacks',
    );
  if (r.kind === 'needs_country')
    return lead(
      'Limited to some countries; set your country in Search profile to check',
    );
  // Ruled out on where it can be done from: the remote bonus no longer applies.
  if (!/^(Limited to|Hybrid|On-site|Requires local)/.test(r.reason))
    return lead(r.reason);
  const breakdown = { ...scored.breakdown };
  delete breakdown.remote_worldwide;
  delete breakdown.remote_overlap;
  delete breakdown.remote_vague;
  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return {
    ...scored,
    breakdown,
    score: Math.max(0, Math.min(100, total)),
    reasons: scored.reasons.filter((x) => !/^remote/i.test(x)),
    gaps: [r.reason, ...scored.gaps].slice(0, 4),
  };
}

export interface RoleScoreFields {
  score: number;
  score_breakdown: Record<string, unknown>;
  reasons: string[];
  gaps: string[];
  ai_match: boolean;
  stack: string[];
  remote_policy: RemotePolicy;
  hiring_countries: string[];
}

export type RoleScoreResult =
  | {
      fields: RoleScoreFields;
      method: 'heuristic' | 'ai';
      model?: string;
      /** The provider that scored it, when a model did. */
      provider?: string;
      aiError?: string;
    }
  | { error: string };

type ProfileRow = {
  target_roles: string[] | null;
  stacks: string[] | null;
  languages: string[] | null;
  employment_types: EmploymentType[] | null;
  remote_rules: Record<string, unknown> | null;
  exclusions: Record<string, unknown> | null;
  home_country: string | null;
  allowed_countries: string[] | null;
  remote_only: boolean | null;
  min_seniority: string | null;
  scoring_weights: unknown;
};

/**
 * Scores one role for its owner: search profile and weights, keyword pass,
 * the run's verdict, then the model on one of the user's AI connections
 * (unless `useAi` is false). Never throws on a model failure; the keyword
 * score stands and `aiError` says why.
 */
export async function scoreRole(
  admin: SupabaseClient,
  userId: string,
  role: RoleForScoring,
  useAi = true,
  connections?: ConnectionRow[],
): Promise<RoleScoreResult> {
  const [{ data: sp }, { data: settings }] = await Promise.all([
    admin
      .from('search_profiles')
      .select(
        'target_roles, stacks, languages, employment_types, remote_rules, exclusions, home_country, allowed_countries, remote_only, min_seniority, scoring_weights',
      )
      .eq('user_id', userId)
      .maybeSingle(),
    admin
      .from('settings')
      .select('key, value')
      .in('key', ['sourcing', 'scoring_defaults']),
  ]);
  if (!sp)
    return {
      error:
        'Set up your search profile first, so there is something to score against.',
    };
  const p = sp as ProfileRow;
  const setting = (k: string) =>
    (settings ?? []).find((s) => s.key === k)?.value as
      Record<string, unknown> | undefined;
  const weights: Weights = resolveWeights(
    setting('scoring_defaults'),
    p.scoring_weights,
  );
  const triageModel =
    (setting('sourcing')?.['triage_model'] as string | undefined) ||
    DEFAULT_TRIAGE_MODEL;

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
  const post = rolePosting(role);
  const keyword = heuristicScore(profile, post, weights);
  let scored = keyword;
  let method: 'heuristic' | 'ai' = 'heuristic';
  let aiError: string | undefined;

  let provider: string | undefined;
  let usedModel: string | undefined;

  if (useAi && post.description.length >= 80) {
    // Scoring is a fast job: each provider's fast model, and the admin's
    // triage model on an Anthropic connection.
    const ai = await runAi(
      admin,
      userId,
      {
        prompt: scorePrompt(
          { ...profile, min_seniority: p.min_seniority ?? undefined },
          weights,
          post,
          keyword.score,
        ),
        maxTokens: 400,
        timeoutMs: 30_000,
      },
      {
        job: 'score',
        fast: true,
        anthropicFastModel: triageModel,
        parse: parseScoreReply,
        connections,
      },
    );
    if (ai.ok) {
      method = 'ai';
      provider = ai.provider;
      usedModel = ai.model;
      scored = {
        ...keyword,
        score: ai.value.score,
        reasons: ai.value.reasons.length ? ai.value.reasons : keyword.reasons,
        gaps: ai.value.gaps.length ? ai.value.gaps : keyword.gaps,
        aiMatch: ai.value.aiMatch || keyword.aiMatch,
      };
    } else if (ai.reason !== 'no_connection') aiError = ai.message;
  }

  // The model reads the location rules itself; the keyword score gets the
  // run's verdict applied. Either way the verdict leads "Watch out".
  const verdict = applyVerdict(profile, post, keyword);
  if (method === 'heuristic') scored = verdict;
  else if (verdict.gaps[0] !== keyword.gaps[0])
    scored = {
      ...scored,
      gaps: [
        verdict.gaps[0],
        ...scored.gaps.filter((g) => g !== verdict.gaps[0]),
      ].slice(0, 4),
    };

  return {
    method,
    model: usedModel,
    provider,
    aiError,
    fields: {
      score: scored.score,
      score_breakdown: {
        ...scored.breakdown,
        method,
        heuristic: keyword.score,
        added_by_hand: true,
      },
      reasons: scored.reasons,
      gaps: scored.gaps,
      ai_match: scored.aiMatch,
      stack: role.stack?.length ? role.stack : scored.stack,
      remote_policy: post.remote_policy,
      hiring_countries: post.hiring_countries,
    },
  };
}
