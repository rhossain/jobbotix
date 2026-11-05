import { normaliseResume, type ResumeSections } from './resume';

/**
 * A tailored variant is the master plus a list of proposed changes. Each
 * change targets one text field by path; the user accepts or rejects each
 * one, and the final sections are the master with accepted changes applied.
 * Storing changes (not a whole resume) is what lets a regenerate keep the
 * user's decisions.
 */
export interface VariantChange {
  id: string;
  /** Dot path into ResumeSections: "summary", "experience.0.bullets.2", "skills.1.items". */
  path: string;
  kind: 'replace' | 'add' | 'remove';
  /** For replace/remove: the text as it stood in the master. */
  before: string;
  /** For replace/add: the proposed text. */
  after: string;
  /** One line on why, in the model's words. */
  reason: string;
  decision: 'pending' | 'accepted' | 'rejected';
}

export interface VariantDiff {
  baseResumeId: string;
  changes: VariantChange[];
}

export interface KeywordReport {
  /** Keywords found in the posting (deduplicated, lower-case). */
  keywords: string[];
  /** Of those, present in the resume text. */
  matched: string[];
  /** Of those, absent from the resume text. */
  missing: string[];
  /** matched / keywords, 0-100. */
  coverage: number;
}

const getAt = (obj: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (o, k) =>
        o && typeof o === 'object'
          ? (o as Record<string, unknown>)[k]
          : undefined,
      obj,
    );

function setAt(obj: unknown, path: string, value: unknown) {
  const keys = path.split('.');
  let o = obj as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
  o[keys[keys.length - 1]] = value;
}

/** Master + accepted changes. Pending and rejected changes are ignored. */
export function applyVariant(
  master: ResumeSections,
  diff: VariantDiff,
): ResumeSections {
  const out = normaliseResume(JSON.parse(JSON.stringify(master)));
  // removals last and from the highest index, so earlier indexes stay valid
  const accepted = diff.changes.filter((c) => c.decision === 'accepted');
  for (const c of accepted.filter((c) => c.kind !== 'remove')) {
    if (c.kind === 'replace') {
      if (typeof getAt(out, c.path) === 'string') setAt(out, c.path, c.after);
    } else {
      // add: path points at an array; append
      const arr = getAt(out, c.path);
      if (Array.isArray(arr)) arr.push(c.after);
    }
  }
  const removals = accepted
    .filter((c) => c.kind === 'remove')
    .map((c) => ({ c, parts: c.path.split('.') }))
    .sort(
      (a, b) =>
        Number(b.parts[b.parts.length - 1]) -
        Number(a.parts[a.parts.length - 1]),
    );
  for (const { c, parts } of removals) {
    const idx = Number(parts[parts.length - 1]);
    const arr = getAt(out, parts.slice(0, -1).join('.'));
    if (Array.isArray(arr) && Number.isInteger(idx) && arr[idx] === c.before)
      arr.splice(idx, 1);
  }
  return out;
}

/** Every reader-visible string of a resume, for keyword matching. */
export function resumeText(r: ResumeSections): string {
  return [
    r.contact.headline,
    r.summary,
    ...r.skills.flatMap((g) => [g.name, ...g.items]),
    ...r.experience.flatMap((e) => [e.title, e.company, ...e.bullets]),
    ...r.projects.flatMap((p) => [p.name, p.description, ...p.stack]),
    ...r.aiToolkit,
    ...r.education.flatMap((e) => [e.degree, e.institution]),
    ...r.certifications,
  ]
    .join('\n')
    .toLowerCase();
}

const STOP = new Set(
  'a an and are as at be by for from has have in is it its of on or that the this to with we you your our will can able should must plus role team work working experience years year strong good great new help build building develop developing design designing join looking seeking remote full time job position candidate company about across also any more most other some such than their them they there these those through under using well what when where which who while within without'.split(
    ' ',
  ),
);

/**
 * Keywords a screening system would look for: known tech terms plus
 * capitalised or hyphenated tokens that appear at least twice in the posting.
 */
export function extractKeywords(
  postingText: string,
  known: readonly string[] = DEFAULT_KEYWORDS,
): string[] {
  const text = postingText.toLowerCase();
  const found = new Set<string>();
  for (const k of known)
    if (hasWord(text, k.toLowerCase())) found.add(k.toLowerCase());
  const counts = new Map<string, number>();
  for (const tok of text.match(/[a-z][a-z0-9+#.-]{2,}/g) ?? []) {
    if (STOP.has(tok) || /^\d/.test(tok)) continue;
    counts.set(tok, (counts.get(tok) ?? 0) + 1);
  }
  for (const [tok, n] of counts)
    if (n >= 3 && tok.length >= 5 && !found.has(tok)) found.add(tok);
  return [...found].sort();
}

export function keywordReport(
  postingText: string,
  resume: ResumeSections,
  known?: readonly string[],
): KeywordReport {
  const keywords = extractKeywords(postingText, known);
  const text = resumeText(resume);
  const matched = keywords.filter((k) => hasWord(text, k));
  const missing = keywords.filter((k) => !hasWord(text, k));
  return {
    keywords,
    matched,
    missing,
    coverage: keywords.length
      ? Math.round((matched.length / keywords.length) * 100)
      : 100,
  };
}

function hasWord(haystack: string, word: string): boolean {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, 'i').test(haystack);
}

export const DEFAULT_KEYWORDS: readonly string[] = [
  'Angular',
  'React',
  'Vue',
  'Svelte',
  'Next.js',
  'Nuxt',
  'TypeScript',
  'JavaScript',
  'RxJS',
  'NgRx',
  'Signals',
  'Redux',
  'Tailwind',
  'SCSS',
  'Sass',
  'CSS',
  'HTML',
  'Angular Material',
  'Bootstrap',
  'Storybook',
  'Jest',
  'Vitest',
  'Jasmine',
  'Karma',
  'Cypress',
  'Playwright',
  'Node.js',
  'NestJS',
  'Express',
  'GraphQL',
  'REST',
  'PostgreSQL',
  'MongoDB',
  'Supabase',
  'Firebase',
  'AWS',
  'Azure',
  'GCP',
  'Docker',
  'Kubernetes',
  'CI/CD',
  'GitHub Actions',
  'Figma',
  'WordPress',
  'NopCommerce',
  'Shopify',
  'accessibility',
  'WCAG',
  'performance',
  'SSR',
  'PWA',
  'micro-frontends',
  'design system',
  'design tokens',
  'component library',
  'Cursor',
  'Claude Code',
  'Copilot',
  'Anthropic',
  'OpenAI',
  'LLM',
  'agentic',
  'AI-assisted',
  'mentoring',
  'code review',
  'agile',
  'Scrum',
];

/** The prompt that asks the model for tailored changes. The reply is parsed by parseVariantReply. */
export function tailorPrompt(
  master: ResumeSections,
  posting: { company: string; title: string; text: string; stack: string[] },
): string {
  return `You are tailoring a resume for one specific job. Propose changes to the MASTER RESUME so it speaks to the POSTING, without inventing experience. Keep the person's voice; prefer rewording existing bullets to adding new ones; never change dates, employers, degrees or links.

Reply with a JSON array of changes, each: {"path": "<dot path>", "kind": "replace"|"add"|"remove", "before": "<exact current text or empty>", "after": "<new text or empty>", "reason": "<one short sentence>"}.
Paths: "summary"; "contact.headline"; "experience.<i>.bullets.<j>" (replace/remove); "experience.<i>.bullets" (add); "skills.<i>.items" (add); "projects.<i>.description" (replace); "aiToolkit" (add).
Propose at most 10 changes, best first. Return only the JSON array.

POSTING: ${posting.title} at ${posting.company}
Stack named: ${posting.stack.join(', ') || 'not stated'}
${posting.text.slice(0, 12_000)}

MASTER RESUME (JSON):
${JSON.stringify(master)}`;
}

export function parseVariantReply(
  reply: string,
  master: ResumeSections,
): Omit<VariantChange, 'id' | 'decision'>[] {
  const m = reply.match(/\[[\s\S]*\]/);
  if (!m) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(m[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out: Omit<VariantChange, 'id' | 'decision'>[] = [];
  for (const x of arr.slice(0, 12)) {
    if (!x || typeof x !== 'object') continue;
    const c = x as Record<string, unknown>;
    const path = String(c['path'] ?? '');
    const kind =
      c['kind'] === 'add' || c['kind'] === 'remove' ? c['kind'] : 'replace';
    const after = typeof c['after'] === 'string' ? c['after'].trim() : '';
    const current = getAt(master, path);
    if (kind === 'replace' && typeof current !== 'string') continue;
    if (kind === 'add' && !Array.isArray(current)) continue;
    if (kind === 'remove' && typeof current !== 'string') continue;
    if (kind !== 'remove' && !after) continue;
    out.push({
      path,
      kind,
      before: typeof current === 'string' ? current : '',
      after: kind === 'remove' ? '' : after,
      reason:
        typeof c['reason'] === 'string' ? c['reason'].trim().slice(0, 300) : '',
    });
  }
  return out;
}

/**
 * Demo-mode tailoring without a model: surfaces missing keywords into the
 * summary and skills so the flow can be exercised end to end.
 */
export function localTailor(
  master: ResumeSections,
  posting: { company: string; title: string; text: string; stack: string[] },
): Omit<VariantChange, 'id' | 'decision'>[] {
  const report = keywordReport(posting.text, master);
  const changes: Omit<VariantChange, 'id' | 'decision'>[] = [];
  const stackMissing = posting.stack
    .filter((s) => report.missing.includes(s.toLowerCase()))
    .slice(0, 4);
  if (master.summary && posting.title) {
    changes.push({
      path: 'summary',
      kind: 'replace',
      before: master.summary,
      after: `${master.summary.replace(/\.$/, '')}. Applying for ${posting.title} at ${posting.company}${stackMissing.length ? `, with hands-on ${stackMissing.join(', ')}` : ''}.`,
      reason:
        'Name the role and the posting’s stack in the opening so a screener sees the match immediately.',
    });
  }
  if (stackMissing.length && master.skills.length) {
    changes.push({
      path: 'skills.0.items',
      kind: 'add',
      before: '',
      after: stackMissing[0],
      reason: `The posting names ${stackMissing[0]} and the resume does not.`,
    });
  }
  if (
    master.contact.headline &&
    posting.title &&
    !master.contact.headline.toLowerCase().includes(posting.title.toLowerCase())
  ) {
    changes.push({
      path: 'contact.headline',
      kind: 'replace',
      before: master.contact.headline,
      after: `${posting.title} | ${master.contact.headline.split('|').pop()?.trim() ?? master.contact.headline}`,
      reason: 'Mirror the posting’s title in the headline.',
    });
  }
  return changes;
}
