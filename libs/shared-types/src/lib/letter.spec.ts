import { describe, expect, it } from 'vitest';
import {
  letterPrompt,
  localLetter,
  parseLetterReply,
  wordCount,
} from './letter';
import { emptyResume } from './resume';

const resume = {
  ...emptyResume(),
  contact: {
    ...emptyResume().contact,
    name: 'Sazzad Hossain',
    headline: 'Senior Frontend Engineer',
  },
  summary: 'Senior frontend engineer with 15+ years building Angular products.',
  skills: [{ name: 'Frontend', items: ['Angular', 'TypeScript', 'RxJS'] }],
  aiToolkit: ['Claude', 'Copilot'],
  experience: [
    {
      company: 'Brain Station 23',
      title: 'Senior Frontend Engineer',
      location: 'Dhaka',
      start: '2019-03',
      end: '',
      bullets: [
        'Cut bundle size by 38% across 40 stores.',
        'Mentored four engineers.',
      ],
    },
  ],
};
const posting = {
  company: 'Globex',
  title: 'Angular Developer',
  text: 'We need Angular and RxJS.',
  stack: ['Angular', 'RxJS', 'NgRx'],
};

describe('letters', () => {
  it('builds a prompt that carries the facts and the voice samples', () => {
    const p = letterPrompt({
      resume,
      posting,
      voiceSamples: ['Hi there, short and direct.'],
    });
    expect(p).toContain('Angular Developer at Globex');
    expect(p).toContain('Cut bundle size by 38%');
    expect(p).toContain('--- sample 1 ---');
    expect(p).not.toContain('Voice: direct');
    expect(letterPrompt({ resume, posting })).toContain('Voice: direct');
  });

  it('writes a local letter from resume facts only', () => {
    const l = localLetter({ resume, posting });
    expect(l).toMatch(
      /^I'd like to be considered for the Angular Developer role at Globex/,
    );
    expect(l).toContain('Angular and RxJS');
    expect(l).not.toContain('NgRx');
    expect(l).toContain('38%');
    expect(l).toContain('AI-assisted (Claude, Copilot)');
    const n = wordCount(l);
    expect(n).toBeGreaterThan(80);
    expect(n).toBeLessThan(260);
  });

  it('cleans a model reply', () => {
    expect(
      parseLetterReply('Here is the letter:\n\n```\nDear team,\n\nBody.\n```'),
    ).toBe('Dear team,\n\nBody.');
    expect(parseLetterReply('Hello [Your Name] here.')).toBe('Hello  here.');
    expect(wordCount('  ')).toBe(0);
  });
});
