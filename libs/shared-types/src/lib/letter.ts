/**
 * Cover letters: the prompt for the model, a local template draft for users
 * without a key, and the reply cleaner. Shared by the Edge Function and the
 * demo-mode repo (supabase/functions/_shared/letter.ts is a copy).
 */
import type { ResumeSections } from './resume';

export interface LetterPosting {
  company: string;
  title: string;
  text: string;
  stack: string[];
  reasons?: string[];
  gaps?: string[];
}

export interface LetterContext {
  resume: ResumeSections;
  posting: LetterPosting;
  /** 0-3 letters the user wrote themselves, to steer tone. */
  voiceSamples?: string[];
  /** The existing draft, if the user wants a rewrite rather than a fresh start. */
  current?: string;
}

export const LETTER_MIN_WORDS = 150;
export const LETTER_MAX_WORDS = 260;

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function letterPrompt(ctx: LetterContext): string {
  const { resume, posting } = ctx;
  const samples = (ctx.voiceSamples ?? []).filter((s) => s.trim());
  const skills = resume.skills
    .map((g) => `${g.name}: ${g.items.join(', ')}`)
    .join('\n');
  const experience = resume.experience
    .slice(0, 3)
    .map(
      (e) =>
        `${e.title} at ${e.company} (${e.start || '?'}–${e.end || 'present'})\n` +
        e.bullets.map((b) => `  - ${b}`).join('\n'),
    )
    .join('\n');
  return [
    `Write a cover letter for this application. Plain text, ${LETTER_MIN_WORDS}-${LETTER_MAX_WORDS} words, 3-4 short paragraphs, no subject line, no address block, no placeholders in square brackets.`,
    `Rules: every claim must come from the resume below; never invent employers, numbers or tools. Name the company and the role once each in the first paragraph. Pick the two or three posting requirements the resume matches best and show them with specifics from the experience bullets. If the resume mentions AI-assisted development, say so plainly in one sentence as a way of working, not a buzzword. End with one sentence on availability or next step. No flattery of the company, no "I am writing to apply", no bullet points.`,
    samples.length
      ? `Match the voice of these letters the candidate wrote (sentence length, directness, warmth), not their content:\n${samples.map((s, i) => `--- sample ${i + 1} ---\n${s.trim()}`).join('\n')}\n--- end samples ---`
      : 'Voice: direct, concrete, warm but not effusive. First person, short sentences.',
    ctx.current?.trim()
      ? `Improve this existing draft rather than starting over; keep what already works:\n${ctx.current.trim()}`
      : '',
    `Candidate: ${resume.contact.name || 'the candidate'}${resume.contact.headline ? `, ${resume.contact.headline}` : ''}`,
    resume.summary ? `Summary: ${resume.summary}` : '',
    skills ? `Skills:\n${skills}` : '',
    experience ? `Experience:\n${experience}` : '',
    resume.aiToolkit.length ? `AI toolkit: ${resume.aiToolkit.join(', ')}` : '',
    `Role: ${posting.title} at ${posting.company}`,
    posting.stack.length ? `Posting stack: ${posting.stack.join(', ')}` : '',
    posting.reasons?.length
      ? `Why it matched: ${posting.reasons.join('; ')}`
      : '',
    posting.gaps?.length
      ? `Known gaps (address at most one, honestly, or skip): ${posting.gaps.join('; ')}`
      : '',
    `Posting:\n${posting.text.slice(0, 6000)}`,
    'Reply with the letter text only.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Strips fences, a leading "Here is…" line and bracketed placeholders. */
export function parseLetterReply(reply: string): string {
  let t = reply.trim();
  t = t.replace(/^(here('s| is)[^\n]*:?\s*\n+)/i, '');
  t = t.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '');
  t = t.replace(/\[(?:your|insert|company)[^\]]*\]/gi, '');
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * A template letter from the resume alone. It is honest about what it is:
 * only facts from the resume, matched against the posting's stack.
 */
export function localLetter(ctx: LetterContext): string {
  const { resume, posting } = ctx;
  const name = resume.contact.name || 'I';
  const headline = lowerFirst(
    (resume.contact.headline || 'Software engineer').split(/\s*[|·•]\s*/)[0],
  );
  const allSkills = resume.skills.flatMap((g) => g.items);
  const lower = (s: string) => s.toLowerCase();
  const matched = posting.stack.filter((s) =>
    allSkills.some((k) => lower(k) === lower(s) || lower(k).includes(lower(s))),
  );
  const top = resume.experience[0];
  const strongBullets = resume.experience
    .flatMap((e) => e.bullets)
    .filter((b) => /\d/.test(b))
    .slice(0, 2);
  const years = resume.summary.match(/(\d{1,2})\+?\s*years/i)?.[1];
  const aiLine =
    resume.aiToolkit.length || /ai[- ]assisted/i.test(resume.summary)
      ? ` I work AI-assisted${resume.aiToolkit.length ? ` (${resume.aiToolkit.slice(0, 3).join(', ')})` : ''}: the tools draft, I design, review and own the result.`
      : '';

  const p1 = `I'd like to be considered for the ${posting.title} role at ${posting.company}. I'm ${name === 'I' ? 'a' : `${name}, a`} ${headline}${years ? ` with ${years}+ years` : ''}${top ? `, most recently ${top.title} at ${top.company.replace(/\.$/, '')}` : ''}.`;
  const p2 = matched.length
    ? `The posting asks for ${listWords(matched.slice(0, 4))}; that is the stack I work in every day.${strongBullets[0] ? ` For example: ${lowerFirst(strongBullets[0].replace(/\.$/, ''))}.` : ''}`
    : strongBullets[0]
      ? `Some of what I've shipped recently: ${lowerFirst(strongBullets[0].replace(/\.$/, ''))}.`
      : resume.summary || '';
  const p3 = strongBullets[1]
    ? `${strongBullets[1].replace(/\.$/, '')}.${aiLine}`
    : aiLine.trim();
  const p4 = `I'm available to start quickly and happy to do a short technical conversation or a take-home at your convenience. Thank you for reading.`;
  return [p1, p2, p3, p4]
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
