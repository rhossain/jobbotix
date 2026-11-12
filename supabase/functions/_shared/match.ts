// The match step: does a pool posting belong in this user's roles?
//
//   not relevant  -> dropped silently (not their kind of job, or too old)
//   excluded      -> stored in excluded_roles with the reason, so "why not"
//                    works the same as it did for the scheduled task
//   matched       -> scored next (score.ts) and filed as a role
//
// Pure functions of a search profile and a posting so the rules are tested
// without a database. Exclusion switches default to on, as in the profile
// form: a key that is missing means "exclude".

import { regionIncludes } from './countries.ts';
import { stackTerm } from './queries.ts';
import { bestRoleFit, type RoleFit, stackOnlyFits } from './role.ts';
import { normaliseTitle } from './sources/normalise.ts';
import type { RemotePolicy } from './sources/types.ts';
import { formatYearly, meetsMinimum, salaryFrom, yearlyIn } from './salary.ts';
import {
  EMPLOYMENT_LABEL,
  type EmploymentType,
  typeList,
} from './employment.ts';

export interface MatchProfile {
  target_roles: string[];
  stacks: string[];
  languages: string[];
  employment_types: EmploymentType[];
  remote_rules: Record<string, unknown> | null;
  exclusions: Record<string, unknown> | null;
  home_country: string | null;
  allowed_countries: string[];
  remote_only: boolean;
  /** 'mid' | 'senior' | 'lead'; absent means senior, as the profile form defaults. */
  min_seniority?: string | null;
}

export interface MatchPosting {
  title: string;
  company: string;
  description: string;
  tags: string[];
  location: string;
  remote_policy: RemotePolicy;
  hiring_countries: string[];
  hiring_regions: string[];
  source_country: string | null;
  employment_type: EmploymentType;
  seniority: string;
  posted_at: string | null;
  expires_at: string | null;
  /** Yearly figures from the board, when it gives them. */
  salary_min?: number | null;
  salary_max?: number | null;
  salary_currency?: string | null;
  /** The pay line as written ("$55/h", "USD 80k–120k"). */
  salary_text?: string | null;
}

export type MatchResult =
  | { kind: 'irrelevant'; why: string }
  | { kind: 'excluded'; reason: string }
  /** Region-locked, and the profile has no country to compare: not stored, so
   *  the posting is judged again once the user sets one. */
  | { kind: 'needs_country' }
  | { kind: 'match' };

const word = (term: string) =>
  new RegExp(
    `(^|[^a-z0-9+#])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9+#]|$)`,
    'i',
  );

const JUNIOR =
  /\b(junior|jr\.?|intern(ship)?|graduate|entry[- ]level|trainee|apprentice)\b/i;
const MID = /\b(mid[- ]level|mid[- ]senior|intermediate)\b/i;

const LANGUAGES = [
  'German',
  'French',
  'Spanish',
  'Portuguese',
  'Dutch',
  'Italian',
  'Polish',
  'Swedish',
  'Danish',
  'Norwegian',
  'Finnish',
  'Czech',
  'Hungarian',
  'Romanian',
  'Turkish',
  'Arabic',
  'Hebrew',
  'Japanese',
  'Korean',
  'Mandarin',
  'Chinese',
  'Cantonese',
  'Russian',
  'Ukrainian',
  'Greek',
  'Vietnamese',
  'Thai',
  'Indonesian',
  'Hindi',
];
const LEVEL =
  '(fluent|fluency|native|business[- ]level|professional[- ]level|proficien\\w*|c1|c2|b2|excellent|strong|written and spoken|spoken and written)';
const LANG_RE = new RegExp(
  `\\b${LEVEL}\\b[^.\\n]{0,40}\\b(${LANGUAGES.join('|')})\\b|\\b(${LANGUAGES.join('|')})\\b[^.\\n]{0,25}\\b${LEVEL}\\b`,
  'i',
);

const AUTH =
  /\b(must|need to|required to|should) (be|have)[^.\n]{0,40}\b(authori[sz]ed|eligible|right) to work\b|\bwork (authori[sz]ation|permit|visa) (is )?required\b|\b(US|U\.S\.|American|EU|UK|Canadian) citizen(ship)?\b|\bgreen card\b|\bsecurity clearance\b|\bno (visa )?sponsorship\b/i;

const bool = (v: unknown, fallback: boolean) =>
  typeof v === 'boolean' ? v : fallback;

/** How a posting's title fits one of the profile's target roles, if it does. */
export function roleFit(p: MatchProfile, post: MatchPosting): RoleFit | null {
  return bestRoleFit(
    p.target_roles,
    post.title,
    `${post.tags.join(' | ')} | ${post.description.slice(0, 1500)}`,
  );
}

/** The target role or stack that makes a posting "their kind of job". */
export function relevance(p: MatchProfile, post: MatchPosting): string | null {
  const fit = roleFit(p, post);
  if (fit) return fit.role;
  const title = normaliseTitle(post.title);
  const tags = post.tags.map((t) => t.toLowerCase()).join(' | ');
  // A stack alone makes it their kind of job only when the title is the same
  // broad kind of work as a target role (role.ts, stackOnlyFits): a tool a QA
  // engineer uses does not make a developer or DevOps role theirs.
  if (!stackOnlyFits(p.target_roles, post.title, p.stacks)) return null;
  // Any stack in the title counts; in the tags only the primary stack or a
  // frontend framework does: "TypeScript" or "Node" tags sit on countless
  // backend, data and interviewer jobs.
  for (const [i, s] of p.stacks.entries()) {
    const t = stackTerm(s);
    if (!t) continue;
    if (word(t).test(title)) return s;
    if ((i === 0 || FRAMEWORKS.has(t)) && word(t).test(tags)) return s;
  }
  return null;
}

const FRAMEWORKS = new Set([
  'angular',
  'angularjs',
  'react',
  'vue',
  'svelte',
  'next',
  'nextjs',
  'nuxt',
  'solid',
  'solidjs',
  'ember',
  'preact',
  'qwik',
  'remix',
  'astro',
]);

export function matchPosting(
  p: MatchProfile,
  post: MatchPosting,
  now = new Date(),
): MatchResult {
  const excl = p.exclusions ?? {};

  // 1. Their kind of job at all?
  if (!relevance(p, post)) {
    return { kind: 'irrelevant', why: 'no target role or stack in title' };
  }

  // 2. Still open and recent enough
  const maxAge = Number(excl['older_than_days'] ?? 45) || 45;
  if (
    post.posted_at &&
    Date.parse(post.posted_at) < now.getTime() - maxAge * 86_400_000
  ) {
    return { kind: 'irrelevant', why: 'older than the profile allows' };
  }
  if (post.expires_at && Date.parse(post.expires_at) < now.getTime()) {
    return { kind: 'irrelevant', why: 'expired' };
  }

  // 3. Level and contract type
  if (bool(excl['junior_or_mid'], true)) {
    // someone whose floor is mid still wants mid-level roles
    const midOk = p.min_seniority === 'mid';
    const junior =
      JUNIOR.test(post.title) || /junior|entry|intern/i.test(post.seniority);
    if (junior || (!midOk && MID.test(post.title))) {
      return {
        kind: 'excluded',
        reason: midOk ? 'Junior role' : 'Junior or mid-level role',
      };
    }
  }
  if (
    p.employment_types.length &&
    !p.employment_types.includes(post.employment_type)
  ) {
    return {
      kind: 'excluded',
      reason: `${EMPLOYMENT_LABEL[post.employment_type]} role; profile wants ${typeList(
        p.employment_types,
      ).toLowerCase()}`,
    };
  }
  const minPay = Number(excl['min_salary'] ?? 0);
  if (minPay > 0) {
    const cur = String(excl['min_salary_currency'] || 'USD');
    const range = salaryFrom(post, post.salary_text);
    if (range && meetsMinimum(range, minPay, cur) === false) {
      const y = yearlyIn(range, cur);
      const top = y ? (y.max ?? y.min) : null;
      return {
        kind: 'excluded',
        reason:
          top === null
            ? 'Pay below your minimum'
            : `Pay below your minimum (about ${formatYearly(top, cur)} a year)`,
      };
    }
  }

  // 4. Where it can be done from
  const allowed = new Set(
    [p.home_country, ...p.allowed_countries].filter((c): c is string => !!c),
  );
  const fits = (countries: string[], regions: string[]) =>
    countries.some((c) => allowed.has(c)) ||
    regions.some((r) => [...allowed].some((c) => regionIncludes(r, c)));
  const placeList = [
    ...post.hiring_countries.map(countryLabel),
    ...post.hiring_regions.map(titleCase),
  ];
  const place = placeList.length
    ? placeList.slice(0, 4).join(', ') + (placeList.length > 4 ? ', …' : '')
    : post.location || 'specific locations';

  switch (post.remote_policy) {
    case 'worldwide':
    case 'unknown':
      break;
    case 'region_locked':
      if (!post.hiring_countries.length && !post.hiring_regions.length) break;
      if (!allowed.size) return { kind: 'needs_country' };
      if (!fits(post.hiring_countries, post.hiring_regions)) {
        return { kind: 'excluded', reason: `Limited to ${place}` };
      }
      break;
    case 'hybrid':
    case 'onsite': {
      const onsiteOk =
        !p.remote_only &&
        !bool(excl['hybrid_or_onsite'], true) &&
        fits(
          [
            ...post.hiring_countries,
            ...(post.source_country ? [post.source_country] : []),
          ],
          post.hiring_regions,
        );
      if (!onsiteOk) {
        return {
          kind: 'excluded',
          reason:
            post.remote_policy === 'hybrid' ? 'Hybrid role' : 'On-site role',
        };
      }
      break;
    }
  }

  // 5. Language and work authorisation, read from the text
  const text = `${post.title}\n${post.description}`;
  if (bool(excl['non_english'], true)) {
    const m = text.match(LANG_RE);
    const lang = (m?.[2] ?? m?.[3] ?? '').toLowerCase();
    const speaks = p.languages.map((l) => l.toLowerCase());
    if (lang && !speaks.includes(lang)) {
      return { kind: 'excluded', reason: `Requires ${titleCase(lang)}` };
    }
  }
  if (bool(excl['visa_required'], true) && post.remote_policy !== 'worldwide') {
    const m = text.match(AUTH);
    // the country usually follows the phrase: "... authorized to work in the US"
    const around = m
      ? text.slice(m.index ?? 0, (m.index ?? 0) + m[0].length + 60)
      : '';
    if (m && !mentionsAllowedCountry(around, allowed)) {
      return { kind: 'excluded', reason: 'Requires local work authorisation' };
    }
  }

  return { kind: 'match' };
}

const COUNTRY_WORDS: Record<string, RegExp> = {
  US: /\b(US|U\.S\.|United States|American|green card)\b/i,
  GB: /\b(UK|United Kingdom|British)\b/i,
  CA: /\bCanad(a|ian)\b/i,
  EU: /\bEU\b/,
};

function mentionsAllowedCountry(phrase: string, allowed: Set<string>): boolean {
  for (const [code, re] of Object.entries(COUNTRY_WORDS)) {
    if (!re.test(phrase)) continue;
    if (code === 'EU') return [...allowed].some((c) => regionIncludes('eu', c));
    return allowed.has(code);
  }
  return false;
}

function titleCase(s: string): string {
  return s
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\bEu\b/, 'EU')
    .replace(/\bEmea\b/, 'EMEA')
    .replace(/\bApac\b/, 'APAC')
    .replace(/\bLatam\b/, 'LATAM');
}

const REGION_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });
/** "US" -> "United States": exclusion reasons are read by people. */
function countryLabel(code: string): string {
  try {
    return REGION_NAMES.of(code) ?? code;
  } catch {
    return code;
  }
}
