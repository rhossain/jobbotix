import { describe, expect, it } from 'vitest';
import { localPrep, normalisePrep, parsePrepReply, prepPrompt } from './prep';
import { emptyResume } from './resume';

const resume = {
  ...emptyResume(),
  contact: { ...emptyResume().contact, name: 'Sazzad' },
  summary: '15+ years of Angular.',
  skills: [{ name: 'Frontend', items: ['Angular', 'TypeScript', 'RxJS'] }],
  aiToolkit: ['Claude'],
  experience: [
    {
      company: 'BS23',
      title: 'Senior Frontend Engineer',
      location: 'Dhaka',
      start: '2019',
      end: '',
      bullets: [
        'Built a production news portal with Service Worker caching; time-to-interactive from 6s to under 2s on 3G.',
        'Led the Angular front end of a multi-tenant commerce platform serving 40 stores.',
        'Mentored four engineers.',
      ],
    },
  ],
};
const posting = {
  company: 'Globex',
  title: 'Angular Developer',
  text: 'We build a payments platform for 2,000 merchants across Europe. You will own the Angular front end. Requirements: Angular, NgRx, RxJS.',
  stack: ['Angular', 'NgRx', 'RxJS'],
  gaps: ['No payments domain experience'],
};

describe('prep', () => {
  it('builds stories from bullets and questions from the stack and gaps', () => {
    const p = localPrep(resume, posting);
    expect(p.stories.length).toBeGreaterThanOrEqual(3);
    expect(p.stories[0].result).toContain('under 2s');
    expect(p.stories[0].source).toBe('Senior Frontend Engineer at BS23');
    const qs = p.questions.map((q) => q.question);
    expect(qs).toContain('Walk us through something you built with Angular.');
    expect(qs).toContain('How much have you worked with NgRx?');
    expect(qs.some((q) => q.includes('payments domain experience'))).toBe(true);
    expect(
      qs.filter((q) => /disagreed|hardest|AI tools|Why this company/.test(q)),
    ).toHaveLength(4);
    expect(p.companyNotes[0]).toMatch(/^We build a payments platform/);
    expect(p.questionsToAsk).toHaveLength(4);
    expect(p.method).toBe('local');
  });

  it('links a question to the story that answers it', () => {
    const p = localPrep(resume, posting);
    const perf = p.questions.find((q) =>
      /hardest performance/.test(q.question),
    );
    expect(perf?.story).toBe(0);
  });

  it('round-trips through the prompt and the parser', () => {
    expect(prepPrompt(resume, posting)).toContain(
      'Angular Developer at Globex',
    );
    const sheet = parsePrepReply(
      'Here you go:\n{"companyNotes":["x"],"questions":[{"question":"Q?","why":"w","story":0}],"stories":[{"title":"t","situation":"s","action":"a","result":"r","source":"src"}],"questionsToAsk":["a?"]}',
    );
    expect(sheet?.questions[0]).toEqual({
      question: 'Q?',
      why: 'w',
      story: 0,
      practised: false,
    });
    expect(parsePrepReply('not json')).toBeNull();
    expect(normalisePrep(null).questions).toEqual([]);
  });
});
