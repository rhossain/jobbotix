// The full check of an AI connection: the four jobs every drafting and
// scoring feature is built on (scoring a posting, reading a posting,
// tailoring a resume, writing a letter), run once each against the provider
// with a made-up resume and posting, and judged by the same parsers the
// real functions use plus a few facts the answer must get right.
//
// "Test" on a connection only proves the key works. This proves the model
// behind it follows Jobbotix's prompts: a model that passes here drafts and
// scores in the app; one that fails falls back to local drafts.
//
// Run from Settings (set-ai-connection, action "check") or from a terminal
// (tools/ai-golden.ts) with a key in the environment.

import { callProvider, type AiAnswer, type AiCall } from './ai.ts';
import { extractionPrompt, parseExtraction } from './extract.ts';
import {
  LETTER_MIN_WORDS,
  letterPrompt,
  parseLetterReply,
  wordCount,
} from './letter.ts';
import type { MatchPosting, MatchProfile } from './match.ts';
import { PROVIDERS, type ProviderId } from './providers.ts';
import { normaliseResume } from './resume.ts';
import { parseScoreReply, resolveWeights, scorePrompt } from './score.ts';
import { resumeContext } from './resume-context.ts';
import { parseVariantReply, tailorPrompt } from './variant.ts';

export type GoldenJob = 'score' | 'extract' | 'tailor' | 'letter';

export const GOLDEN_LABELS: Record<GoldenJob, string> = {
  score: 'Scoring a posting',
  extract: 'Reading a posting',
  tailor: 'Tailoring a resume',
  letter: 'Writing a cover letter',
};

export interface GoldenResult {
  job: GoldenJob;
  label: string;
  ok: boolean;
  /** What was wrong, in a sentence; '' when it passed. */
  detail: string;
  model: string;
  ms: number;
  tokensIn: number;
  tokensOut: number;
  /** The provider's rate limit stopped this job: not a verdict on the model. */
  limited?: boolean;
}

// --- the made-up candidate and job -------------------------------------------

export const GOLDEN_RESUME = normaliseResume({
  contact: {
    name: 'Rafi Ahmed',
    headline: 'Senior Frontend Engineer',
    email: 'rafi@example.com',
    phone: '',
    location: 'Dhaka, Bangladesh',
    website: '',
    links: [],
  },
  summary:
    'Frontend engineer with nine years building data-heavy web apps in Angular and TypeScript for remote product teams.',
  skills: [
    { name: 'Frontend', items: ['Angular', 'TypeScript', 'RxJS', 'Tailwind'] },
    { name: 'Testing', items: ['Vitest', 'Playwright'] },
    { name: 'Backend', items: ['Node.js', 'PostgreSQL'] },
  ],
  experience: [
    {
      company: 'Northwind Analytics',
      title: 'Senior Frontend Engineer',
      location: 'Remote',
      start: '2021-02',
      end: '',
      bullets: [
        'Led the move of a 140-screen dashboard from AngularJS to Angular with signals, cutting the main bundle by 38%.',
        'Built a shared component library used by four product teams.',
        'Mentored three engineers and ran the weekly frontend review.',
      ],
    },
    {
      company: 'Brightlane',
      title: 'Frontend Engineer',
      location: 'Dhaka',
      start: '2016-06',
      end: '2021-01',
      bullets: [
        'Shipped the booking flow used by 60,000 monthly customers.',
        'Introduced end-to-end tests that caught regressions before release.',
      ],
    },
  ],
  projects: [],
  aiToolkit: ['Claude Code for refactors and test scaffolding'],
  education: [
    {
      institution: 'University of Dhaka',
      degree: 'BSc Computer Science',
      year: '2016',
    },
  ],
  certifications: [],
});

const POSTING_TEXT = `Senior Angular Engineer at Lumenstack

Lumenstack builds reporting tools for logistics companies. We are a remote team of 45 people across Europe and Asia.

We are looking for a Senior Angular Engineer to own our customer dashboard. This is a full-time, fully remote role open to candidates worldwide. Salary: USD 70,000 to 90,000 a year.

What you will do
- Build and maintain features in Angular and TypeScript
- Improve performance of data-heavy screens
- Write tests with Playwright and review other engineers' code
- Work with designers and a Node.js backend team

What we look for
- 5+ years of frontend experience, at least 3 with Angular
- Strong TypeScript and RxJS
- Experience with component libraries and design systems
- Clear written English

Posted 3 November 2026.`;

const POSTING_URL =
  'https://jobs.example.com/lumenstack/senior-angular-engineer';

const POSTING = {
  company: 'Lumenstack',
  title: 'Senior Angular Engineer',
  text: POSTING_TEXT,
  stack: ['Angular', 'TypeScript', 'RxJS', 'Playwright', 'Node.js'],
};

const PROFILE: MatchProfile & { min_seniority?: string } = {
  target_roles: ['Senior Frontend Engineer', 'Angular Engineer'],
  stacks: ['Angular', 'TypeScript', 'RxJS'],
  languages: ['english'],
  employment_types: ['full_time', 'contract'],
  remote_rules: {},
  exclusions: {},
  home_country: 'BD',
  allowed_countries: [],
  remote_only: true,
  min_seniority: 'senior',
};

const MATCH_POSTING: MatchPosting = {
  title: POSTING.title,
  company: POSTING.company,
  description: POSTING_TEXT,
  tags: POSTING.stack,
  location: 'Remote, worldwide',
  remote_policy: 'worldwide',
  hiring_countries: [],
  hiring_regions: [],
  source_country: null,
  employment_type: 'full_time',
  seniority: 'senior',
  posted_at: '2026-11-03',
  expires_at: null,
  salary_text: 'USD 70,000 to 90,000 a year',
};

// --- the four jobs -------------------------------------------------------------

interface GoldenCase {
  job: GoldenJob;
  /** Scoring runs on the provider's fast model, like the hourly run. */
  fast: boolean;
  call: AiCall;
  /** '' when the reply is right; otherwise what is wrong with it. */
  judge: (reply: string) => string;
}

const has = (hay: string, needle: string) =>
  hay.toLowerCase().includes(needle.toLowerCase());

export const GOLDEN_CASES: GoldenCase[] = [
  {
    job: 'score',
    fast: true,
    call: {
      prompt: scorePrompt(PROFILE, resolveWeights(), MATCH_POSTING, 70),
      maxTokens: 400,
      timeoutMs: 30_000,
    },
    judge: (reply) => {
      const s = parseScoreReply(reply);
      if (!s) return 'The reply had no score Jobbotix could read.';
      // An Angular senior, remote worldwide, against exactly that profile.
      if (s.score < 55)
        return `Scored a close match only ${s.score} out of 100.`;
      if (!s.reasons.length) return 'Gave a score without any reasons.';
      return '';
    },
  },
  {
    job: 'extract',
    fast: false,
    call: {
      prompt: extractionPrompt(POSTING_URL, POSTING_TEXT),
      maxTokens: 800,
      timeoutMs: 30_000,
    },
    judge: (reply) => {
      const r = parseExtraction(reply);
      if (!r) return 'The reply was not the JSON the prompt asks for.';
      if (!has(r.company ?? '', 'Lumenstack'))
        return `Read the company as "${r.company ?? ''}".`;
      if (!has(r.title ?? '', 'Angular'))
        return `Read the title as "${r.title ?? ''}".`;
      if (r.type !== 'full_time')
        return `Read a full-time role as "${r.type ?? 'nothing'}".`;
      if (!(r.stack ?? []).some((t) => has(t, 'angular')))
        return 'Left Angular out of the stack.';
      if (!/70[,.]?000|70k/i.test(r.salary ?? ''))
        return `Read the salary as "${r.salary ?? ''}".`;
      return '';
    },
  },
  {
    job: 'tailor',
    fast: false,
    call: {
      context: resumeContext(GOLDEN_RESUME),
      prompt: tailorPrompt(POSTING),
      maxTokens: 2500,
      timeoutMs: 45_000,
    },
    judge: (reply) => {
      // The parser drops changes aimed at paths the resume does not have.
      const changes = parseVariantReply(reply, GOLDEN_RESUME);
      if (!changes.length)
        return 'Proposed no change Jobbotix could apply to the resume.';
      if (changes.some((c) => has(c.after, 'Lumenstack was')))
        return 'Wrote about the employer instead of the candidate.';
      return '';
    },
  },
  {
    job: 'letter',
    fast: false,
    call: {
      context: resumeContext(GOLDEN_RESUME),
      prompt: letterPrompt({ resume: GOLDEN_RESUME, posting: POSTING }),
      maxTokens: 1200,
      timeoutMs: 45_000,
    },
    judge: (reply) => {
      const text = parseLetterReply(reply);
      const words = wordCount(text);
      if (words < LETTER_MIN_WORDS / 2)
        return `Wrote ${words} words where a letter needs about ${LETTER_MIN_WORDS}.`;
      if (words > 450)
        return `Wrote ${words} words: far too long for a letter.`;
      if (!has(text, 'Lumenstack')) return 'Never named the company.';
      if (/\[[^\]]{2,40}\]/.test(text))
        return 'Left a placeholder in square brackets.';
      if (/^\s*[{[]/.test(text))
        return 'Answered with JSON instead of a letter.';
      return '';
    },
  },
];

/**
 * What came back when a job failed, so the cause can be read off the check:
 * the start and the end of the reply (a reply usually goes wrong at one of
 * the two), or why there was none. The reply is about the made-up resume and
 * posting, never an account's own content.
 */
export function replyNote(
  answer: Extract<AiAnswer, { ok: true }>,
  max = 160,
): string {
  const text = answer.text.replace(/\s+/g, ' ').trim();
  const cut = answer.finish === 'length' ? ' It was cut off at the limit.' : '';
  if (!text)
    return (
      (answer.thoughtOnly
        ? 'The model reasoned but wrote no answer.'
        : 'The reply was empty.') + cut
    );
  if (text.length <= max * 2) return `The reply was: ${text}${cut}`;
  return `The reply began: ${text.slice(0, max)} … and ended: ${text.slice(-max)}${cut}`;
}

/** The model a job runs on: the saved one, or the provider's fast model for scoring. */
export function goldenModel(
  provider: ProviderId,
  model: string,
  fast: boolean,
): string {
  const info = PROVIDERS[provider];
  return fast ? info.fastModel : model || info.defaultModel;
}

/**
 * Runs the four jobs one after another (free tiers allow few calls a
 * minute). `onAnswer` sees every provider answer, so the caller can meter it.
 */
export async function runGolden(
  provider: ProviderId,
  apiKey: string,
  model: string,
  opts: {
    jobs?: GoldenJob[];
    onAnswer?: (job: GoldenJob, answer: AiAnswer) => void | Promise<void>;
  } = {},
): Promise<GoldenResult[]> {
  const results: GoldenResult[] = [];
  let limited = false;
  for (const c of GOLDEN_CASES) {
    if (opts.jobs && !opts.jobs.includes(c.job)) continue;
    const used = goldenModel(provider, model, c.fast);
    const base = { job: c.job, label: GOLDEN_LABELS[c.job], model: used };
    if (limited) {
      results.push({
        ...base,
        ok: false,
        limited: true,
        detail: 'Not run: the provider was already at its rate limit.',
        ms: 0,
        tokensIn: 0,
        tokensOut: 0,
      });
      continue;
    }
    const started = Date.now();
    const answer = await callProvider(provider, apiKey, used, c.call);
    const ms = Date.now() - started;
    await opts.onAnswer?.(c.job, answer);
    if (!answer.ok) {
      limited = answer.kind === 'rate_limited';
      results.push({
        ...base,
        ok: false,
        limited: limited || undefined,
        detail: limited
          ? 'The provider is at its rate limit. Wait a minute and run the check again.'
          : `No answer (${answer.kind}): ${answer.message}`.slice(0, 300),
        ms,
        tokensIn: 0,
        tokensOut: 0,
      });
      continue;
    }
    const wrong = c.judge(answer.text);
    const detail = wrong ? `${wrong} ${replyNote(answer)}` : '';
    results.push({
      ...base,
      ok: !detail,
      detail,
      ms,
      tokensIn: answer.tokensIn,
      tokensOut: answer.tokensOut,
    });
  }
  return results;
}

/** "4 of 4 passed", "3 of 4 passed", or what stopped it. */
export function goldenSummary(results: GoldenResult[]): string {
  const ran = results.filter((r) => !r.limited);
  const passed = ran.filter((r) => r.ok).length;
  if (!ran.length)
    return 'The provider is rate limited; nothing could be checked.';
  const stopped = results.length - ran.length;
  return (
    `${passed} of ${ran.length} passed` +
    (stopped ? `, ${stopped} not run (rate limit)` : '')
  );
}
