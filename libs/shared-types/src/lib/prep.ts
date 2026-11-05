/**
 * Interview prep sheet for one role: what to know about the company, the
 * questions they are likely to ask, and the stories from the resume that
 * answer them. Shared by the Edge Function and demo mode
 * (supabase/functions/_shared/prep.ts is a copy).
 */
import type { LetterPosting } from './letter';
import type { ResumeSections } from './resume';

export interface PrepQuestion {
  question: string;
  /** Why they will ask it, and what to hit in the answer. */
  why: string;
  /** Index into stories[], when one fits. */
  story?: number;
  practised?: boolean;
}

export interface PrepStory {
  title: string;
  situation: string;
  action: string;
  result: string;
  /** Where it comes from, e.g. "Senior Frontend Engineer at BS23". */
  source: string;
}

export interface PrepSheet {
  companyNotes: string[];
  questions: PrepQuestion[];
  stories: PrepStory[];
  /** What to ask them. */
  questionsToAsk: string[];
  userNotes: string;
  generatedAt: string;
  method: 'ai' | 'local' | '';
  model?: string;
}

export function emptyPrep(): PrepSheet {
  return {
    companyNotes: [],
    questions: [],
    stories: [],
    questionsToAsk: [],
    userNotes: '',
    generatedAt: '',
    method: '',
  };
}

export function normalisePrep(raw: unknown): PrepSheet {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Partial<PrepSheet>;
  const strs = (xs: unknown) =>
    Array.isArray(xs)
      ? xs.filter((x): x is string => typeof x === 'string')
      : [];
  return {
    companyNotes: strs(p.companyNotes),
    questions: Array.isArray(p.questions)
      ? p.questions
          .filter(
            (q): q is PrepQuestion =>
              !!q &&
              typeof q === 'object' &&
              typeof (q as PrepQuestion).question === 'string',
          )
          .map((q) => ({
            question: q.question,
            why: typeof q.why === 'string' ? q.why : '',
            story: typeof q.story === 'number' ? q.story : undefined,
            practised: q.practised === true,
          }))
      : [],
    stories: Array.isArray(p.stories)
      ? p.stories
          .filter(
            (s): s is PrepStory =>
              !!s &&
              typeof s === 'object' &&
              typeof (s as PrepStory).title === 'string',
          )
          .map((s) => ({
            title: s.title,
            situation: s.situation ?? '',
            action: s.action ?? '',
            result: s.result ?? '',
            source: s.source ?? '',
          }))
      : [],
    questionsToAsk: strs(p.questionsToAsk),
    userNotes: typeof p.userNotes === 'string' ? p.userNotes : '',
    generatedAt: typeof p.generatedAt === 'string' ? p.generatedAt : '',
    method: p.method === 'ai' || p.method === 'local' ? p.method : '',
    model: typeof p.model === 'string' ? p.model : undefined,
  };
}

export function prepPrompt(
  resume: ResumeSections,
  posting: LetterPosting,
): string {
  const experience = resume.experience
    .slice(0, 4)
    .map(
      (e) =>
        `${e.title} at ${e.company} (${e.start || '?'}–${e.end || 'present'}):\n` +
        e.bullets.map((b) => `  - ${b}`).join('\n'),
    )
    .join('\n');
  return [
    `Prepare a candidate for an interview. Reply with JSON only, this shape:
{"companyNotes": ["..."], "questions": [{"question": "...", "why": "...", "story": 0}], "stories": [{"title": "...", "situation": "...", "action": "...", "result": "...", "source": "..."}], "questionsToAsk": ["..."]}`,
    `companyNotes: 3-5 short facts or inferences about the company and the team from the posting only (product, stage, how they work, what the posting stresses). Never invent facts not in the posting; say "the posting suggests" when inferring.`,
    `questions: 8-10 questions this interviewer is likely to ask, mixing technical ones drawn from the posting's stack and requirements, one or two about the gaps, and three behavioural ones. "why" says in one sentence what they are probing and what to hit. "story" is the index of the story that answers it, when one does.`,
    `stories: 4-6 STAR stories built only from the resume bullets below, each with situation, action, result (keep the resume's numbers) and source (role and company).`,
    `questionsToAsk: 4 sharp questions for the candidate to ask them, specific to the posting.`,
    `Candidate: ${resume.contact.name || 'the candidate'}${resume.contact.headline ? `, ${resume.contact.headline}` : ''}`,
    resume.summary ? `Summary: ${resume.summary}` : '',
    resume.skills.length
      ? `Skills: ${resume.skills.map((g) => `${g.name}: ${g.items.join(', ')}`).join(' | ')}`
      : '',
    experience ? `Experience:\n${experience}` : '',
    resume.aiToolkit.length ? `AI toolkit: ${resume.aiToolkit.join(', ')}` : '',
    `Role: ${posting.title} at ${posting.company}`,
    posting.stack.length ? `Posting stack: ${posting.stack.join(', ')}` : '',
    posting.reasons?.length
      ? `Why it matched: ${posting.reasons.join('; ')}`
      : '',
    posting.gaps?.length ? `Known gaps: ${posting.gaps.join('; ')}` : '',
    `Posting:\n${posting.text.slice(0, 6000)}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function parsePrepReply(reply: string): PrepSheet | null {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const p = normalisePrep(JSON.parse(reply.slice(start, end + 1)));
    return p.questions.length ? p : null;
  } catch {
    return null;
  }
}

/** A prep sheet from the resume and posting alone: honest, template-shaped. */
export function localPrep(
  resume: ResumeSections,
  posting: LetterPosting,
): PrepSheet {
  const allSkills = resume.skills.flatMap((g) => g.items);
  const has = (s: string) =>
    allSkills.some(
      (k) =>
        k.toLowerCase() === s.toLowerCase() ||
        k.toLowerCase().includes(s.toLowerCase()),
    );
  const matched = posting.stack.filter(has);
  const missing = posting.stack.filter((s) => !has(s));

  const stories: PrepStory[] = [];
  for (const e of resume.experience) {
    for (const b of e.bullets) {
      if (stories.length >= 6) break;
      if (!/\d/.test(b) && stories.length >= 3) continue;
      const [action, result] = splitResult(b);
      stories.push({
        title:
          b.length > 60
            ? b.slice(0, 57).replace(/[,;:\s]+\S*$/, '') + '…'
            : b.replace(/\.$/, ''),
        situation: `${e.title} at ${e.company}${e.location ? `, ${e.location}` : ''}.`,
        action,
        result: result || '[add the measurable outcome]',
        source: `${e.title} at ${e.company}`,
      });
    }
  }

  const questions: PrepQuestion[] = [];
  const storyFor = (term: string) =>
    stories.findIndex((s) =>
      (s.title + s.action).toLowerCase().includes(term.toLowerCase()),
    );
  for (const s of matched.slice(0, 4)) {
    const idx = storyFor(s);
    questions.push({
      question: `Walk us through something you built with ${s}.`,
      why: `${s} is in the posting and on your resume; they want depth, not a list. Lead with a decision you made and its effect.`,
      story: idx >= 0 ? idx : undefined,
    });
  }
  for (const m of missing.slice(0, 2)) {
    questions.push({
      question: `How much have you worked with ${m}?`,
      why: `${m} is in the posting but not on your resume. Answer honestly, name the closest thing you have used, and say how you would get up to speed.`,
    });
  }
  for (const g of (posting.gaps ?? []).slice(0, 1)) {
    questions.push({
      question: `The role involves ${g.replace(/^no\s+|^lacks?\s+/i, '').replace(/\.$/, '')}. How does your background fit?`,
      why: 'Flagged as a gap by the match. Bridge from the nearest experience you do have; do not over-claim.',
    });
  }
  const behavioural: [string, string][] = [
    [
      'Tell us about a time you disagreed with a product or design decision.',
      'They are checking judgement and how you push back. Pick a case where you changed the outcome, or accepted it well.',
    ],
    [
      'Describe the hardest performance or reliability problem you fixed.',
      'Depth and method: how you measured it, what you tried, what moved the number.',
    ],
    [
      'How do you use AI tools in your work, and where do you not trust them?',
      'The posting or your resume mentions AI-assisted work; show a concrete workflow and your review habits.',
    ],
    [
      'Why this company, and why now?',
      'Fit and motivation. Use one specific thing from the posting; avoid generic praise.',
    ],
  ];
  for (const [q, why] of behavioural) {
    const idx = /performance|reliability/i.test(q)
      ? stories.findIndex((s) => /\d+\s*(%|s\b|ms|x\b)/i.test(s.result))
      : -1;
    questions.push({ question: q, why, story: idx >= 0 ? idx : undefined });
  }

  const sentences = posting.text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.length > 40 && s.length < 240);
  const companyNotes = sentences
    .filter((s) =>
      /\b(we|our|the team|you will|you'll|mission|customers|users|product|platform)\b/i.test(
        s,
      ),
    )
    .slice(0, 5)
    .map((s) => s.trim());

  return {
    companyNotes: companyNotes.length
      ? companyNotes
      : [
          `${posting.company} is hiring a ${posting.title}. The posting has no company description; look at their site and recent news before the call.`,
        ],
    questions,
    stories,
    questionsToAsk: [
      'What does the first 90 days look like for this role, and how will you know it is going well?',
      `Who owns the ${matched[0] ?? 'frontend'} architecture decisions today, and how do they get made?`,
      'How does the team review and ship: branch strategy, review turnaround, release cadence?',
      'What is the biggest thing slowing the team down right now?',
    ],
    userNotes: '',
    generatedAt: new Date().toISOString(),
    method: 'local',
  };
}

function splitResult(bullet: string): [string, string] {
  const m = bullet.match(
    /^(.*?)(;|:|, (?:cutting|reducing|raising|improving|which|resulting|from|taking))(.*)$/i,
  );
  if (m && m[3].trim().length > 8)
    return [
      m[1].trim().replace(/\.$/, '') + '.',
      (m[2].startsWith(',') ? m[2].slice(2) : '') + m[3].trim(),
    ];
  const num = bullet.match(/^(.*?\b)([^.]*\d[^.]*)\.?$/);
  if (num && num[1].length > 20)
    return [num[1].trim().replace(/[,;:]$/, '') + '.', num[2].trim()];
  return [bullet, ''];
}
