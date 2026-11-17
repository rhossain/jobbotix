/**
 * Freelance gigs added from Upwork. Jobbotix never reads Upwork itself: the
 * user opens Upwork in their own browser, copies the job post and pastes it
 * here. This module turns that pasted text into the fields a gig carries
 * (roles.gig, migration 0057), builds the "Search on Upwork" link, and writes
 * the proposal prompt. supabase/functions/_shared/gig.ts is a copy; keep the
 * two in step.
 */
import type { LetterContext } from './letter.ts';

export type EntryKind = 'job' | 'gig';

/** What only a gig has; stored on roles.gig. */
export interface GigDetails {
  budgetType: 'hourly' | 'fixed' | '';
  /** US dollars an hour. */
  rateMin: number | null;
  rateMax: number | null;
  /** US dollars for the whole fixed-price project. */
  budget: number | null;
  /** Connects it costs to send a proposal. */
  connects: number | null;
  clientCountry: string;
  /** null: the post did not say. */
  paymentVerified: boolean | null;
  experienceLevel: 'entry' | 'intermediate' | 'expert' | '';
  /** "1 to 3 months", as the post words it. */
  duration: string;
}

/** A gig read from pasted text, for the user to check before it is saved. */
export interface GigDraft extends GigDetails {
  url: string;
  title: string;
  skills: string[];
  /** The client's screening questions, in order. */
  questions: string[];
  postingText: string;
}

export const GIG_COMPANY = 'Upwork client';
export const GIG_SOURCE = 'Upwork';
export const GIG_TEXT_MIN = 80;

export function emptyGig(): GigDetails {
  return {
    budgetType: '',
    rateMin: null,
    rateMax: null,
    budget: null,
    connects: null,
    clientCountry: '',
    paymentVerified: null,
    experienceLevel: '',
    duration: '',
  };
}

const str = (v: unknown, max = 200) =>
  typeof v === 'string' ? v.trim().slice(0, max) : '';

/** A dollar amount: 0 < n < 10 million, two decimals at most; else null. */
function money(v: unknown): number | null {
  const n =
    typeof v === 'number'
      ? v
      : typeof v === 'string'
        ? Number(v.replace(/[$,\s]/g, ''))
        : NaN;
  return Number.isFinite(n) && n > 0 && n < 10_000_000
    ? Math.round(n * 100) / 100
    : null;
}

function count(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 500 ? n : null;
}

/** Gig details from anything: a database value, a model's reply, a form. */
export function normaliseGig(value: unknown): GigDetails {
  const o =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const budgetType =
    o['budgetType'] === 'hourly' || o['budgetType'] === 'fixed'
      ? o['budgetType']
      : '';
  let rateMin = budgetType === 'fixed' ? null : money(o['rateMin']);
  let rateMax = budgetType === 'fixed' ? null : money(o['rateMax']);
  if (rateMin !== null && rateMax !== null && rateMin > rateMax)
    [rateMin, rateMax] = [rateMax, rateMin];
  const level = str(o['experienceLevel']).toLowerCase();
  return {
    budgetType,
    rateMin,
    rateMax,
    budget: budgetType === 'hourly' ? null : money(o['budget']),
    connects: count(o['connects']),
    clientCountry: str(o['clientCountry'], 80),
    paymentVerified:
      typeof o['paymentVerified'] === 'boolean' ? o['paymentVerified'] : null,
    experienceLevel:
      level === 'entry' || level === 'intermediate' || level === 'expert'
        ? level
        : '',
    duration: str(o['duration'], 80),
  };
}

/** The gig details of a role, or null when the role is a job. */
export function gigOf(role: {
  entry_kind?: string | null;
  gig?: unknown;
}): GigDetails | null {
  return role.entry_kind === 'gig' ? normaliseGig(role.gig) : null;
}

/**
 * A gig nobody has asked a fit check for yet. Gigs are never scored on
 * their own: the user asks, on the gig's page.
 */
export function fitUnchecked(role: {
  entry_kind?: string | null;
  score: number;
  reasons: string[];
  gaps: string[];
}): boolean {
  return (
    role.entry_kind === 'gig' &&
    role.score === 0 &&
    !role.reasons.length &&
    !role.gaps.length
  );
}

const dollars = (n: number) =>
  `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

/** "$25–$40/hr", "$1,200 fixed price", "Hourly", or '' when nothing is known. */
export function gigBudgetLine(g: GigDetails): string {
  if (g.budgetType === 'fixed' || (g.budgetType === '' && g.budget !== null))
    return g.budget !== null
      ? `${dollars(g.budget)} fixed price`
      : 'Fixed price';
  if (g.rateMin !== null && g.rateMax !== null && g.rateMin !== g.rateMax)
    return `${dollars(g.rateMin)}–${dollars(g.rateMax)}/hr`;
  const one = g.rateMax ?? g.rateMin;
  if (one !== null) return `${dollars(one)}/hr`;
  return g.budgetType === 'hourly' ? 'Hourly' : '';
}

export const GIG_LEVEL_LABELS: Record<
  Exclude<GigDetails['experienceLevel'], ''>,
  string
> = { entry: 'Entry level', intermediate: 'Intermediate', expert: 'Expert' };

// --- Upwork links ----------------------------------------------------------

function upworkHost(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    const host = u.hostname.toLowerCase();
    return u.protocol === 'https:' &&
      (host === 'upwork.com' || host.endsWith('.upwork.com'))
      ? u
      : null;
  } catch {
    return null;
  }
}

/** Any page on upwork.com. Jobbotix must never fetch one. */
export function isUpworkUrl(raw: string): boolean {
  return upworkHost(raw) !== null;
}

/**
 * The one address a gig is kept under, from any of the links Upwork shows
 * for a job post (search result, apply page, details pane); null when the
 * link is not an Upwork job post.
 */
export function upworkJobUrl(raw: string): string | null {
  const u = upworkHost(raw);
  if (!u) return null;
  const id = decodeURIComponent(u.pathname + u.search).match(
    /~0[0-9a-z]{8,40}/i,
  );
  return id ? `https://www.upwork.com/jobs/${id[0].toLowerCase()}` : null;
}

/**
 * Upwork's own job search, newest first, for the user to open in their
 * browser. The title alone, or two skills when there is no title: Upwork
 * needs every word to match, so more words mean fewer jobs.
 */
export function upworkSearchUrl(title: string, skills: string[] = []): string {
  const words = [title, ...(title.trim() ? [] : skills.slice(0, 2))]
    .map((w) => w.trim())
    .filter(Boolean)
    .join(' ')
    .slice(0, 120);
  const q = words ? `?q=${encodeURIComponent(words)}&sort=recency` : '';
  return `https://www.upwork.com/nx/search/jobs/${q}`;
}

// --- Reading a pasted job post ---------------------------------------------

const NOISE =
  /^(posted|worldwide|save job|flag as inappropriate|apply now|send a proposal|summary|upwork|find work|jobs?|back|close|share)\b/i;

/**
 * Best-effort fields with no model: the patterns Upwork's job page uses when
 * its text is selected and copied. Anything it misses the user fills in.
 */
export function heuristicGig(
  text: string,
): GigDetails & { title: string; questions: string[] } {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const title =
    lines.find((l) => l.length >= 8 && l.length <= 140 && !NOISE.test(l)) ?? '';
  const g = emptyGig();

  const range = text.match(
    /\$\s?(\d[\d,]*(?:\.\d+)?)\s*[-–—]\s*\$\s?(\d[\d,]*(?:\.\d+)?)\s*(?:\/\s?hr|hourly)?/i,
  );
  const hourly = /\bhourly\b/i.test(text) || /\/\s?hr\b/i.test(text);
  const fixed = /\bfixed[- ]price\b/i.test(text);
  if (hourly && !fixed) g.budgetType = 'hourly';
  else if (fixed && !hourly) g.budgetType = 'fixed';
  else if (hourly && fixed) g.budgetType = range ? 'hourly' : 'fixed';
  if (g.budgetType !== 'fixed' && range) {
    g.rateMin = money(range[1]);
    g.rateMax = money(range[2]);
  }
  if (g.budgetType === 'fixed') {
    const m =
      text.match(/\$\s?(\d[\d,]*(?:\.\d+)?)\s*\n?\s*fixed[- ]price/i) ??
      text.match(
        /(?:budget|fixed[- ]price)[^\n$]{0,40}\$\s?(\d[\d,]*(?:\.\d+)?)/i,
      );
    g.budget = m ? money(m[1]) : null;
  }

  const connects = text.match(
    /(?:send a proposal for|required connects[^\d\n]*|proposal for)[:\s]*(\d{1,3})\s*connects/i,
  );
  g.connects = connects ? count(Number(connects[1])) : null;

  if (/payment (?:method )?not verified|payment unverified/i.test(text))
    g.paymentVerified = false;
  else if (/payment (?:method )?verified/i.test(text)) g.paymentVerified = true;

  const level = text.match(/\b(entry level|intermediate|expert)\b/i)?.[1];
  g.experienceLevel = level
    ? (level.toLowerCase().split(' ')[0] as GigDetails['experienceLevel'])
    : '';
  g.duration =
    text.match(
      /\b(less than (?:1|a|one) month|1 to 3 months|3 to 6 months|more than 6 months)\b/i,
    )?.[1] ?? '';

  // "About the client" is followed, a few lines down, by the country.
  const about = lines.findIndex((l) => /^about the client$/i.test(l));
  if (about >= 0) {
    const country = lines
      .slice(about + 1, about + 12)
      .find(
        (l) =>
          /^[A-Z][A-Za-z .'-]{2,40}$/.test(l) &&
          !/payment|verified|rating|review|member|jobs? posted|hire|spent|phone|client/i.test(
            l,
          ),
      );
    g.clientCountry = country ?? '';
  }

  return { ...g, title, questions: screeningQuestions(lines) };
}

/** The numbered questions under "You will be asked to answer the following questions". */
function screeningQuestions(lines: string[]): string[] {
  const at = lines.findIndex((l) =>
    /asked to answer the following questions?/i.test(l),
  );
  if (at < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(at + 1, at + 16)) {
    const q = l.replace(/^(?:\d{1,2}[.)]|[-•*])\s*/, '').trim();
    if (q.length < 8 || q.length > 400) break;
    if (!/\?$/.test(q) && !/^\d{1,2}[.)]/.test(l) && !/^[-•*]/.test(l)) break;
    out.push(q);
  }
  return out.slice(0, 10);
}

/** The prompt for a model, on the user's own connection or plan credits. */
export function gigPrompt(text: string): string {
  return `The text below is a freelance job post the user copied from Upwork. Extract it into JSON with exactly these keys:
{"title": string, "budgetType": "hourly" | "fixed" | "", "rateMin": number | null (US dollars an hour), "rateMax": number | null, "budget": number | null (fixed-price budget in US dollars), "connects": number | null (Connects needed to send a proposal), "clientCountry": string ("" if not stated), "paymentVerified": true | false | null (null if not stated), "experienceLevel": "entry" | "intermediate" | "expert" | "", "duration": string (project length as written, "" if not stated), "skills": string[] (skills and tools the post names, max 20), "questions": string[] (the screening questions the client asks with a proposal, in order, [] if none)}
Use only what the text states; never guess a number. Return only the JSON object, no prose.

JOB POST:
${text.slice(0, 30_000)}`;
}

/** Parses the model's JSON reply defensively. */
export function parseGig(
  reply: string,
):
  | (GigDetails & { title: string; skills: string[]; questions: string[] })
  | null {
  const m = reply.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as Record<string, unknown>;
    const list = (v: unknown, max: number, len: number) =>
      Array.isArray(v)
        ? v
            .filter((x): x is string => typeof x === 'string')
            .map((x) => x.trim().slice(0, len))
            .filter(Boolean)
            .slice(0, max)
        : [];
    return {
      ...normaliseGig(o),
      title: str(o['title'], 200),
      skills: list(o['skills'], 20, 60),
      questions: list(o['questions'], 10, 400),
    };
  } catch {
    return null;
  }
}

/**
 * A draft the user may save: the fields they confirmed, cleaned. Returns the
 * reason it cannot be saved instead when the link or the title is missing.
 */
export function checkGigDraft(value: unknown): GigDraft | { error: string } {
  const o =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  const url = upworkJobUrl(str(o['url'], 2000));
  if (!url)
    return {
      error:
        'Use the link of the job post on Upwork. It contains a code that starts with ~0.',
    };
  const title = str(o['title'], 200);
  if (title.length < 4) return { error: 'Give the job a title' };
  const postingText = str(o['postingText'], 50_000);
  if (postingText.length < GIG_TEXT_MIN)
    return { error: 'Paste the text of the job post' };
  const list = (v: unknown, max: number, len: number) =>
    Array.isArray(v)
      ? v
          .filter((x): x is string => typeof x === 'string')
          .map((x) => x.trim().slice(0, len))
          .filter(Boolean)
          .slice(0, max)
      : [];
  return {
    ...normaliseGig(o),
    url,
    title,
    skills: list(o['skills'], 20, 60),
    questions: list(o['questions'], 10, 400),
    postingText,
  };
}

// --- Proposals ---------------------------------------------------------------

export const PROPOSAL_MIN_WORDS = 90;
export const PROPOSAL_MAX_WORDS = 180;

/**
 * The task of writing an Upwork proposal. As with letters, the resume is the
 * call's context and is not repeated here. The user reads it, edits it and
 * sends it on Upwork themselves.
 */
export function proposalPrompt(ctx: LetterContext, gig: GigDetails): string {
  const { resume, posting } = ctx;
  const samples = (ctx.voiceSamples ?? []).filter((s) => s.trim());
  const budget = gigBudgetLine(gig);
  return [
    `Write a proposal for this freelance job on Upwork. Plain text, ${PROPOSAL_MIN_WORDS}-${PROPOSAL_MAX_WORDS} words, 3 short paragraphs, no greeting line beyond "Hi," and no sign-off block, no placeholders in square brackets.`,
    `Rules: every claim must come from the RESUME above; never invent clients, numbers or tools. The first two sentences decide whether the client reads on: open with the client's own problem in their words and the most relevant thing the candidate has already built, not with an introduction. Then give one or two concrete proofs from the resume that match what the post asks for. Close with one specific question about the project or a clear next step. Do not mention a price or an hourly rate. No flattery, no "I am excited", no bullet points, no links, no contact details.`,
    samples.length
      ? `Match the voice of these letters the candidate wrote (sentence length, directness, warmth), not their content:\n${samples.map((s, i) => `--- sample ${i + 1} ---\n${s.trim()}`).join('\n')}\n--- end samples ---`
      : 'Voice: direct, concrete, friendly. First person, short sentences.',
    ctx.current?.trim()
      ? `Improve this existing draft rather than starting over; keep what already works:\n${ctx.current.trim()}`
      : '',
    `Candidate: ${resume.contact.name || 'the candidate'}${resume.contact.headline ? `, ${resume.contact.headline}` : ''}`,
    `Job: ${posting.title}`,
    budget ? `Budget: ${budget}` : '',
    gig.duration ? `Length: ${gig.duration}` : '',
    posting.stack.length ? `Skills asked for: ${posting.stack.join(', ')}` : '',
    `Job post:\n${posting.text.slice(0, 6000)}`,
    'Reply with the proposal text only.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** A template proposal from the resume alone, for accounts with no model. */
export function localProposal(ctx: LetterContext): string {
  const { resume, posting } = ctx;
  const lower = (s: string) => s.toLowerCase();
  const allSkills = resume.skills.flatMap((g) => g.items);
  const matched = posting.stack.filter((s) =>
    allSkills.some((k) => lower(k) === lower(s) || lower(k).includes(lower(s))),
  );
  const proof = resume.experience
    .flatMap((e) => e.bullets)
    .filter((b) => /\d/.test(b))
    .slice(0, 2)
    .map((b) => b.replace(/\.$/, ''));
  const top = resume.experience[0];
  const years = resume.summary.match(/(\d{1,2})\+?\s*years/i)?.[1];
  const p1 = `Hi,\n\nI read your post "${posting.title.replace(/\.$/, '')}".${matched.length ? ` I work with ${listWords(matched.slice(0, 4))} every day` : ' This is the kind of work I do'}${years ? `, and have for ${years}+ years` : ''}${top ? `, most recently as ${top.title} at ${top.company.replace(/\.$/, '')}` : ''}.`;
  const p2 = proof.length
    ? `Recent work close to this: ${lowerFirst(proof[0])}.${proof[1] ? ` Also: ${lowerFirst(proof[1])}.` : ''}`
    : resume.summary;
  const p3 =
    'What does the first milestone look like for you? I can start this week and will send a short plan before any work begins.';
  return [p1, p2, p3]
    .map((p) => p.trim())
    .filter(Boolean)
    .join('\n\n');
}

function listWords(xs: string[]): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

function lowerFirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}
