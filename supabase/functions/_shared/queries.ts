// Search terms for the adapters, built from every active search profile, and
// the role keywords the match step reuses. "Senior Angular Developer" and
// "Senior Frontend Engineer" become "angular" and "frontend": the words that
// say what the job is, without seniority or job-family filler.

import { normaliseTitle } from './sources/normalise.ts';

const FILLER = new Set([
  'senior',
  'sr',
  'lead',
  'staff',
  'principal',
  'junior',
  'jr',
  'mid',
  'level',
  'head',
  'chief',
  'engineer',
  'engineering',
  'developer',
  'development',
  'dev',
  'programmer',
  'specialist',
  'consultant',
  'expert',
  'remote',
  // Describe a lean, not a word a title would carry: "Frontend-leaning Full-stack".
  'leaning',
  'focused',
  'oriented',
  'heavy',
  'and',
  'or',
  'the',
  'of',
  'in',
  'a',
  'an',
  'for',
  'with',
  'i',
  'ii',
  'iii',
  'iv',
  'contract',
  'freelance',
  'full',
  'time',
  'part',
]);

/** The defining words of a target role, e.g. ["frontend"] or ["fullstack", "angular"]. */
export function roleKeywords(role: string): string[] {
  return normaliseTitle(role)
    .split(' ')
    .filter((w) => w.length > 1 && !FILLER.has(w));
}

/** A stack entry that works as a search term on its own ("Angular", "Vue.js"; not "HTML5/CSS3"). */
export function stackTerm(stack: string): string | null {
  const s = stack.trim().toLowerCase().replace(/\.js$/, '');
  if (!s || s.length > 20 || /[\/,;()]/.test(s)) return null;
  if (
    /^(html5?|css3?|scss|sass|less|bootstrap|git|rest|json|jquery|tailwind( css)?)$/.test(
      s,
    )
  ) {
    return null;
  }
  return s;
}

export interface QueryProfile {
  target_roles: string[];
  stacks: string[];
}

/** Up to `max` distinct search terms across all profiles, most common first. */
export function buildQueries(profiles: QueryProfile[], max = 12): string[] {
  const count = new Map<string, number>();
  const add = (q: string) => count.set(q, (count.get(q) ?? 0) + 1);
  for (const p of profiles) {
    for (const r of p.target_roles.slice(0, 4)) {
      const kw = roleKeywords(r);
      if (kw.length) add(kw.join(' '));
    }
    for (const s of p.stacks.slice(0, 2)) {
      const t = stackTerm(s);
      if (t) add(t);
    }
  }
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([q]) => q);
}
