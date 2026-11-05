import { describe, expect, it } from 'vitest';
import { emptyResume } from './resume';
import { localAnswer, parseScreeningReply, screeningPrompt } from './screening';

const resume = {
  ...emptyResume(),
  contact: {
    ...emptyResume().contact,
    name: 'Sazzad',
    location: 'Dhaka, Bangladesh',
    website: 'rshossain.me',
  },
  summary: '15+ years building Angular products.',
  skills: [{ name: 'Frontend', items: ['Angular', 'TypeScript'] }],
  aiToolkit: ['Claude Code', 'Cursor'],
  experience: [
    {
      company: 'BS23',
      title: 'Senior Frontend Engineer',
      location: '',
      start: '2019',
      end: '',
      bullets: ['Cut bundle size by 38%.'],
    },
  ],
};
const posting = {
  company: 'Globex',
  title: 'Angular Dev',
  text: '',
  stack: ['Angular', 'NgRx'],
};

describe('screening', () => {
  it('builds a prompt listing the questions by id and asks for JSON', () => {
    const p = screeningPrompt({
      resume,
      posting,
      questions: [{ id: 'q1', question: 'Years of Angular?' }],
    });
    expect(p).toContain('q1: Years of Angular?');
    expect(p).toContain('JSON only');
  });

  it('parses a fenced JSON reply and ignores unknown ids', () => {
    const m = parseScreeningReply(
      'Sure:\n```json\n[{"id":"q1","answer":" Six. "},{"id":"zz","answer":"x"}]\n```',
      [{ id: 'q1', question: '' }],
    );
    expect([...m.entries()]).toEqual([['q1', 'Six.']]);
    expect(parseScreeningReply('nope', []).size).toBe(0);
  });

  it('answers common questions from the resume and flags the rest', () => {
    expect(
      localAnswer(
        'How often do you use AI coding assistants?',
        resume,
        posting,
      ),
    ).toMatch(/^Daily\. Claude Code, Cursor/);
    expect(
      localAnswer(
        'How many years of experience with Angular?',
        resume,
        posting,
      ),
    ).toBe(
      '15+ years in production, with Angular as a daily tool; most recently as Senior Frontend Engineer at BS23.',
    );
    expect(localAnswer('Salary expectations?', resume, posting)).toContain(
      '[edit',
    );
    expect(
      localAnswer('Do you need visa sponsorship?', resume, posting),
    ).toContain('Dhaka, Bangladesh');
    expect(
      localAnswer('Why are you interested in this role?', resume, posting),
    ).toContain('(Angular)');
    expect(localAnswer('Portfolio link', resume, posting)).toBe('rshossain.me');
    expect(localAnswer('Tell us about a hard bug.', resume, posting)).toContain(
      '[edit',
    );
  });
});
