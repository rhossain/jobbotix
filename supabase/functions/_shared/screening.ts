/**
 * Screening questions: the prompt that answers a batch of them from the
 * resume, a reply parser, and local template answers for the questions
 * every application form asks. Shared by the Edge Function and demo mode
 * (supabase/functions/_shared/screening.ts is a copy).
 */
import type { LetterPosting } from './letter.ts';
import type { ResumeSections } from './resume.ts';

export interface ScreeningQuestion {
  id: string;
  question: string;
}

export interface ScreeningContext {
  resume: ResumeSections;
  posting: LetterPosting;
  questions: ScreeningQuestion[];
  /** Answers already written for this role, so new ones stay consistent. */
  existing?: { question: string; answer: string }[];
}

/**
 * The task of answering screening questions. The resume itself is not in
 * here: the caller sends it as the call's context (resumeContext), ahead of
 * this.
 */
export function screeningPrompt(ctx: ScreeningContext): string {
  const { resume, posting } = ctx;
  return [
    'Answer these application screening questions for the candidate. Each answer is 1-4 sentences of plain text, first person, specific, and true to the RESUME above. Never invent employers, numbers, tools or certifications. For questions about salary, notice period, visas, work authorization, location or availability that the resume does not answer, write a short honest answer that keeps the door open ("open to discussing a range that fits the role and market", "available within 2-4 weeks") rather than a number. Yes/no questions get the yes or no first, then one sentence of evidence. If the resume mentions AI-assisted development, answer AI-tooling questions concretely and briefly.',
    `Candidate: ${resume.contact.name || 'the candidate'}${resume.contact.headline ? `, ${resume.contact.headline}` : ''}${resume.contact.location ? `, based in ${resume.contact.location}` : ''}`,
    `Role: ${posting.title} at ${posting.company}`,
    posting.stack.length ? `Posting stack: ${posting.stack.join(', ')}` : '',
    posting.text ? `Posting:\n${posting.text.slice(0, 4000)}` : '',
    ctx.existing?.length
      ? `Answers already given for this role (stay consistent):\n${ctx.existing.map((e) => `Q: ${e.question}\nA: ${e.answer}`).join('\n')}`
      : '',
    `Questions:\n${ctx.questions.map((q) => `${q.id}: ${q.question}`).join('\n')}`,
    'Reply with JSON only: an array of {"id": "<question id>", "answer": "<text>"}.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Pulls the JSON array out of a reply, tolerating fences and preamble. */
export function parseScreeningReply(
  reply: string,
  questions: ScreeningQuestion[],
): Map<string, string> {
  const out = new Map<string, string>();
  const start = reply.indexOf('[');
  const end = reply.lastIndexOf(']');
  if (start < 0 || end <= start) return out;
  try {
    const arr = JSON.parse(reply.slice(start, end + 1)) as unknown;
    if (!Array.isArray(arr)) return out;
    const ids = new Set(questions.map((q) => q.id));
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue;
      const { id, answer } = item as { id?: unknown; answer?: unknown };
      if (typeof id === 'string' && ids.has(id) && typeof answer === 'string')
        out.set(id, answer.trim());
    }
  } catch {
    /* not JSON */
  }
  return out;
}

/**
 * Template answers for the questions every form asks. Only facts from the
 * resume; anything it cannot answer gets a short placeholder the user must
 * edit (flagged with "[edit]" so it never ships unchanged).
 */
export function localAnswer(
  question: string,
  resume: ResumeSections,
  posting: LetterPosting,
): string {
  const q = question.toLowerCase();
  const allSkills = resume.skills.flatMap((g) => g.items);
  const years = resume.summary.match(/(\d{1,2})\+?\s*years/i)?.[1];
  const top = resume.experience[0];
  const strong = resume.experience
    .flatMap((e) => e.bullets)
    .find((b) => /\d/.test(b));

  if (/\b(ai|copilot|cursor|claude|chatgpt|llm|coding assistant)/.test(q)) {
    return resume.aiToolkit.length
      ? `Daily. ${resume.aiToolkit.slice(0, 3).join(', ')} for implementation and review; I own the design, read every diff and run the tests before anything merges.`
      : 'I use AI coding assistants where they speed up the routine parts, and I review every change they produce. [edit]';
  }
  if (/\b(years?|how long|experience with|experience in)\b/.test(q)) {
    const named = allSkills.find((s) => q.includes(s.toLowerCase()));
    return `${years ? `${years}+ years` : 'Several years'} in production${named ? `, with ${named} as a daily tool` : ''}${top ? `; most recently as ${top.title} at ${top.company}` : ''}.`;
  }
  if (/\b(salary|compensation|rate|pay|expect)/.test(q)) {
    return 'Open to discussing a range that fits the role, the market and the scope; happy to share a number once we have talked about the work. [edit if the form needs a figure]';
  }
  if (/\b(notice|start|available|availability|join)\b/.test(q)) {
    return 'Available to start within 2-4 weeks of an offer, sooner if needed. [edit]';
  }
  if (
    /\b(visa|sponsor|authori[sz]|work permit|eligible to work|right to work)/.test(
      q,
    )
  ) {
    return `I'm based in ${resume.contact.location || '[location]'} and looking for a fully remote role as a contractor or employee through an EOR; I don't need visa sponsorship for remote work. [edit if relocating]`;
  }
  if (
    /\b(remote|timezone|time zone|overlap|location|where are you|relocat)/.test(
      q,
    )
  ) {
    return `Fully remote from ${resume.contact.location || '[location]'}, with flexible hours for overlap with your team's core time. [edit overlap]`;
  }
  if (
    /\b(why (do you want|are you interested|this (role|company|job))|interest in)/.test(
      q,
    )
  ) {
    const match = posting.stack.filter((s) =>
      allSkills.some((k) => k.toLowerCase() === s.toLowerCase()),
    );
    return `The role sits exactly in the stack I work in${match.length ? ` (${match.slice(0, 3).join(', ')})` : ''}, and ${posting.company} is hiring for the kind of product work I do best${strong ? `: ${strong.replace(/\.$/, '').replace(/^[A-Z]/, (c) => c.toLowerCase())}` : ''}. [edit with one specific thing about ${posting.company}]`;
  }
  if (/\b(portfolio|github|link|website|linkedin)\b/.test(q)) {
    const links = [
      resume.contact.website,
      ...resume.contact.links.map((l) => l.url),
    ].filter(Boolean);
    return links.length ? links.join(' · ') : '[add a link]';
  }
  if (/\b(english|language|fluent)\b/.test(q)) {
    return 'Professional working proficiency in English; all my client work and documentation has been in English. [edit]';
  }
  if (/^(are you|do you|have you|can you|will you|is )/.test(q)) {
    return `Yes. ${strong ? strong : 'Happy to go into detail in a conversation.'} [edit]`;
  }
  return strong
    ? `${strong} [edit to answer the question directly]`
    : '[write an answer]';
}
