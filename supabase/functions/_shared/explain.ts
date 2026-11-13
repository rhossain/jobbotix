// Why a user's search finds what it finds: the same match and score rules as
// the hourly run, replayed over the recent pool and counted at every step.
// Writes nothing. It answers "why so few results?" without anyone reading
// the database: how many postings there were, how many were another kind of
// job, what excluded the rest, and which sources carried the matches.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { nearMiss } from './judge.ts';
import { matchPosting, type MatchPosting, type MatchProfile } from './match.ts';
import { stackTerm } from './queries.ts';
import { bestRoleFit, type Grade, parseRole, searchTerm } from './role.ts';
import { heuristicScore, type Weights } from './score.ts';

export interface ExplainPosting extends MatchPosting {
  sources: string[];
}

export interface SearchExplain {
  days: number;
  target_roles: string[];
  search_terms: string[];
  /** Things about the profile that limit what it can find. */
  warnings: string[];
  pool: number;
  not_relevant: number;
  /** Of those, titles close enough that the AI check looks at them when the account has AI. */
  near_miss: number;
  too_old: number;
  needs_country: number;
  excluded: { reason: string; count: number }[];
  low_score: number;
  would_file: number;
  threshold: number;
  /** How the matches were recognised: by title grade, or by a stack alone. */
  by_grade: Record<Grade | 'stack', number>;
  by_source: { source: string; pool: number; matched: number }[];
  top: { title: string; company: string; score: number }[];
  low: { title: string; company: string; score: number }[];
  /** Where the country-limited postings are limited to, most common first. */
  limited_to: { place: string; count: number }[];
  /** Title matches that a setting ruled out, with the reason and the posting's own location line. */
  ruled_out: {
    title: string;
    company: string;
    reason: string;
    where: string;
    source: string;
  }[];
}

/** One line per kind of exclusion, so forty "Limited to ..." reasons read as one. */
export function reasonGroup(reason: string): string {
  if (reason.startsWith('Limited to')) return 'Open to other countries only';
  if (reason.startsWith('Pay below')) return 'Pay below the minimum';
  if (reason === 'Requires local work authorisation') return reason;
  if (reason.startsWith('Requires ')) return 'Requires another language';
  if (reason.includes('profile wants')) return 'Contract type not wanted';
  return reason;
}

/** A posting's remote scope in plain words, for the examples. */
const SCOPE: Record<string, string> = {
  worldwide: 'remote, worldwide',
  region_locked: 'remote, named places only',
  hybrid: 'hybrid',
  onsite: 'on-site',
  unknown: 'remote scope not stated',
};

const GENERIC = new Set([
  'engineer',
  'manager',
  'lead',
  'director',
  'specialist',
  'consultant',
  'analyst',
  'designer',
  'assistant',
  'coordinator',
  'executive',
  'officer',
]);

export function profileWarnings(p: MatchProfile): string[] {
  const out: string[] = [];
  if (!p.target_roles.length)
    out.push('No target roles are set, so only stacks can match.');
  for (const r of p.target_roles) {
    const parsed = parseRole(r);
    if (!parsed) out.push(`"${r}" has no job word to search for.`);
    else if (parsed.words.length === 1 && GENERIC.has(parsed.head))
      out.push(
        `"${r}" is very broad: it matches every ${parsed.head} title, at a low grade.`,
      );
  }
  if (!p.stacks.some((s) => stackTerm(s)))
    out.push(
      'No stack is set that works as a search term, so scores rest on the title and remote scope.',
    );
  if (!p.home_country && !p.allowed_countries.length)
    out.push(
      'No country is set: postings limited to a region cannot be judged.',
    );
  return out;
}

export function createExplain(
  profile: MatchProfile,
  weights: Weights,
  opts: { days: number; threshold: number; now?: Date },
) {
  const now = opts.now ?? new Date();
  const res: SearchExplain = {
    days: opts.days,
    target_roles: profile.target_roles,
    search_terms: [
      ...new Set(
        profile.target_roles.map(searchTerm).filter((t): t is string => !!t),
      ),
    ],
    warnings: profileWarnings(profile),
    pool: 0,
    not_relevant: 0,
    near_miss: 0,
    too_old: 0,
    needs_country: 0,
    excluded: [],
    low_score: 0,
    would_file: 0,
    threshold: opts.threshold,
    by_grade: { exact: 0, variant: 0, partial: 0, described: 0, stack: 0 },
    by_source: [],
    top: [],
    low: [],
    limited_to: [],
    ruled_out: [],
  };
  const places = new Map<string, number>();
  const excluded = new Map<string, number>();
  const sources = new Map<string, { pool: number; matched: number }>();
  const scored: { title: string; company: string; score: number }[] = [];
  const src = (id: string) => {
    let s = sources.get(id);
    if (!s) sources.set(id, (s = { pool: 0, matched: 0 }));
    return s;
  };

  return {
    add(posts: ExplainPosting[]) {
      for (const post of posts) {
        res.pool++;
        const from = post.sources.length ? post.sources : ['unknown'];
        for (const id of from) src(id).pool++;
        const r = matchPosting(profile, post, now);
        if (r.kind === 'irrelevant') {
          if (r.why.startsWith('no target role')) {
            res.not_relevant++;
            if (nearMiss(profile.target_roles, post.title)) res.near_miss++;
          } else res.too_old++;
          continue;
        }
        if (r.kind === 'needs_country') {
          res.needs_country++;
          continue;
        }
        if (r.kind === 'excluded') {
          const g = reasonGroup(r.reason);
          excluded.set(g, (excluded.get(g) ?? 0) + 1);
          if (r.reason.startsWith('Limited to ')) {
            const place = r.reason.slice('Limited to '.length);
            places.set(place, (places.get(place) ?? 0) + 1);
          }
          // examples a person can check: the title is their job, a setting stopped it
          if (
            res.ruled_out.length < 25 &&
            bestRoleFit(profile.target_roles, post.title)
          )
            res.ruled_out.push({
              title: post.title,
              company: post.company,
              reason: r.reason,
              where: [post.location, SCOPE[post.remote_policy] ?? '']
                .filter(Boolean)
                .join(' · ')
                .slice(0, 120),
              source: from[0],
            });
          continue;
        }
        const fit = bestRoleFit(
          profile.target_roles,
          post.title,
          `${post.tags.join(' | ')} | ${post.description.slice(0, 1500)}`,
        );
        res.by_grade[fit?.grade ?? 'stack']++;
        for (const id of from) src(id).matched++;
        const s = heuristicScore(profile, post, weights);
        if (s.score >= opts.threshold) res.would_file++;
        else res.low_score++;
        scored.push({
          title: post.title,
          company: post.company,
          score: s.score,
        });
      }
    },
    result(): SearchExplain {
      res.excluded = [...excluded.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count);
      res.by_source = [...sources.entries()]
        .map(([source, v]) => ({ source, ...v }))
        .sort((a, b) => b.matched - a.matched || b.pool - a.pool);
      res.limited_to = [...places.entries()]
        .map(([place, count]) => ({ place, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
      scored.sort((a, b) => b.score - a.score);
      res.top = scored.filter((s) => s.score >= opts.threshold).slice(0, 10);
      res.low = scored.filter((s) => s.score < opts.threshold).slice(0, 5);
      return res;
    },
  };
}

/** The columns a search profile contributes to matching. */
export const PROFILE_COLUMNS =
  'target_roles, stacks, languages, employment_types, remote_rules, exclusions, home_country, allowed_countries, remote_only, min_seniority, scoring_weights';

/** A search_profiles row as the match rules read it. */
// deno-lint-ignore no-explicit-any
export function toMatchProfile(sp: any): MatchProfile {
  return {
    target_roles: sp.target_roles ?? [],
    stacks: sp.stacks ?? [],
    languages: sp.languages?.length ? sp.languages : ['english'],
    employment_types: sp.employment_types ?? ['full_time', 'contract'],
    remote_rules: sp.remote_rules ?? {},
    exclusions: sp.exclusions ?? {},
    home_country: sp.home_country ?? null,
    allowed_countries: sp.allowed_countries ?? [],
    remote_only: sp.remote_only !== false,
    min_seniority: sp.min_seniority ?? null,
  };
}

/**
 * Replays a profile over the last `days` of the pool, a page at a time so a
 * month of postings never sits in memory at once. Returns an error message
 * when the pool could not be read.
 */
export async function replayPool(
  admin: SupabaseClient,
  profile: MatchProfile,
  weights: Weights,
  opts: { days: number; threshold: number; maxPostings?: number },
): Promise<{ result: SearchExplain } | { error: string }> {
  const explain = createExplain(profile, weights, opts);
  const since = new Date(Date.now() - opts.days * 86_400_000).toISOString();
  const PAGE = 400;
  const max = opts.maxPostings ?? 4000;
  for (let from = 0; from < max; from += PAGE) {
    const { data: rows, error } = await admin
      .from('postings')
      .select(
        'title, company, description, tags, location, remote_policy, hiring_countries, hiring_regions, source_country, employment_type, seniority, salary_min, salary_max, salary_currency, salary_text, posted_at, expires_at, posting_sources(source_id)',
      )
      .gt('first_seen_at', since)
      .order('first_seen_at', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) return { error: error.message };
    explain.add(
      (rows ?? []).map((r) => ({
        ...(r as unknown as ExplainPosting),
        sources: ((r.posting_sources ?? []) as { source_id: string }[]).map(
          (x) => x.source_id,
        ),
      })),
    );
    if ((rows ?? []).length < PAGE) break;
  }
  return { result: explain.result() };
}
