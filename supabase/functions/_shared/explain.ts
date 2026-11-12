// Why a user's search finds what it finds: the same match and score rules as
// the hourly run, replayed over the recent pool and counted at every step.
// Writes nothing. It answers "why so few results?" without anyone reading
// the database: how many postings there were, how many were another kind of
// job, what excluded the rest, and which sources carried the matches.

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
  };
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
          if (r.why.startsWith('no target role')) res.not_relevant++;
          else res.too_old++;
          continue;
        }
        if (r.kind === 'needs_country') {
          res.needs_country++;
          continue;
        }
        if (r.kind === 'excluded') {
          const g = reasonGroup(r.reason);
          excluded.set(g, (excluded.get(g) ?? 0) + 1);
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
      scored.sort((a, b) => b.score - a.score);
      res.top = scored.filter((s) => s.score >= opts.threshold).slice(0, 10);
      res.low = scored.filter((s) => s.score < opts.threshold).slice(0, 5);
      return res;
    },
  };
}
