/**
 * A first search profile read from the master resume: the roles to look
 * for, the stacks to match, the seniority floor and the home country. The
 * user reviews it on the Search profile page before anything is saved.
 */
import { toCountryCode } from './countries';
import type { ResumeSections } from './resume';

export interface ProfileSuggestion {
  targetRoles: string[];
  stacks: string[];
  minSeniority: 'mid' | 'senior' | 'lead';
  homeCountry: string | null;
  /** Whole years from the earliest job start to now; null if unknown. */
  years: number | null;
}

const LEVEL = /\b(senior|sr\.?|lead|principal|staff|head|junior|jr\.?|mid)\b/i;
const LEAD = /\b(lead|principal|staff|head)\b/i;

/** "Senior Frontend Engineer | AI-Augmented Development" → "Senior Frontend Engineer". */
function cleanTitle(t: string): string {
  return t
    .split(/\s[|·•–—-]\s|\s\||,|\(/)[0]
    .replace(/\s+/g, ' ')
    .trim();
}

function yearOf(v: string): number | null {
  const m = v.match(/(19|20)\d{2}/);
  return m ? Number(m[0]) : null;
}

export function suggestProfile(
  r: ResumeSections,
  now = new Date(),
): ProfileSuggestion {
  // years of experience from the earliest start date
  const starts = r.experience
    .map((e) => yearOf(e.start))
    .filter((y): y is number => y !== null);
  const years = starts.length
    ? Math.max(0, now.getUTCFullYear() - Math.min(...starts))
    : null;

  const titles = [
    r.contact.headline,
    ...r.experience.slice(0, 3).map((e) => e.title),
  ]
    .map(cleanTitle)
    .filter((t) => t.length >= 3 && t.length <= 60);
  const lead = titles.some((t) => LEAD.test(t));
  const senior =
    lead ||
    (years ?? 0) >= 5 ||
    titles.some((t) => /\b(senior|sr\.?)\b/i.test(t));
  // a lead's floor is still senior: lead-titled postings are rarer than the work
  const minSeniority: ProfileSuggestion['minSeniority'] = senior
    ? 'senior'
    : 'mid';

  // the same titles at the level the user is at, most recent first
  const seen = new Set<string>();
  const targetRoles: string[] = [];
  for (const t of titles) {
    const base = t.replace(LEVEL, '').replace(/\s+/g, ' ').trim();
    if (!base) continue;
    const at =
      LEVEL.test(t) && !/\b(junior|jr\.?|mid)\b/i.test(t)
        ? t
        : senior
          ? `Senior ${base}`
          : base;
    const key = at.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      targetRoles.push(at);
    }
    if (targetRoles.length >= 4) break;
  }

  // skills, ranked by how often the experience and projects mention them
  const corpus = [
    r.summary,
    ...r.experience.flatMap((e) => [e.title, ...e.bullets]),
    ...r.projects.flatMap((p) => [p.description, ...p.stack]),
  ]
    .join('\n')
    .toLowerCase();
  const items = r.skills.flatMap((g, gi) =>
    g.items.map((name, ii) => ({ name: name.trim(), order: gi * 100 + ii })),
  );
  const counted = new Map<string, { name: string; order: number; n: number }>();
  for (const it of items) {
    if (!it.name || it.name.length > 40) continue;
    const key = it.name.toLowerCase();
    if (counted.has(key)) continue;
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const n = (
      corpus.match(new RegExp(`(^|[^a-z0-9+#])${esc}([^a-z0-9+#]|$)`, 'g')) ??
      []
    ).length;
    counted.set(key, { ...it, n });
  }
  const stacks = [...counted.values()]
    .sort((a, b) => b.n - a.n || a.order - b.order)
    .slice(0, 8)
    .map((s) => s.name);

  const loc = r.contact.location
    .split(',')
    .map((s) => s.trim())
    .reverse();
  let homeCountry: string | null = null;
  for (const part of loc) {
    homeCountry = toCountryCode(part);
    if (homeCountry) break;
  }

  return { targetRoles, stacks, minSeniority, homeCountry, years };
}

/**
 * Other job titles for one target role, as the suggest-roles function
 * answers: from the built-in role families, or from the model for a role no
 * family lists. The user adds the ones they want to their target roles.
 */
export interface TitleSuggestion {
  role: string;
  /** Built in: its other names are matched already. */
  known: boolean;
  titles: string[];
  /** Why this role will find little, when it will. */
  warning: string;
  source: 'family' | 'ai' | 'none';
}

export function titleSuggestions(v: unknown): TitleSuggestion[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((o) => ({
      role: typeof o['role'] === 'string' ? o['role'] : '',
      known: o['known'] === true,
      titles: Array.isArray(o['titles'])
        ? o['titles'].filter((t): t is string => typeof t === 'string')
        : [],
      warning: typeof o['warning'] === 'string' ? o['warning'] : '',
      source: (o['source'] === 'family' || o['source'] === 'ai'
        ? o['source']
        : 'none') as TitleSuggestion['source'],
    }))
    .filter((s) => s.role);
}
