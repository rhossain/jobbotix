import { describe, expect, it } from 'vitest';
import { emptyResume, type ResumeSections } from './resume';
import {
  applyVariant,
  extractKeywords,
  keywordReport,
  localTailor,
  parseVariantReply,
} from './variant';

const master = (): ResumeSections => ({
  ...emptyResume(),
  contact: {
    ...emptyResume().contact,
    headline: 'Senior Frontend Engineer | AI-Augmented',
  },
  summary: 'Senior frontend engineer with Angular.',
  skills: [{ name: 'Frontend', items: ['Angular', 'TypeScript'] }],
  experience: [
    {
      company: 'Acme',
      title: 'Dev',
      location: '',
      start: '2020-01',
      end: '',
      bullets: ['Built things.', 'Fixed things.'],
    },
  ],
});

describe('applyVariant', () => {
  it('applies accepted changes only and keeps indexes valid on removals', () => {
    const r = applyVariant(master(), {
      baseResumeId: 'm',
      changes: [
        {
          id: '1',
          path: 'summary',
          kind: 'replace',
          before: '',
          after: 'New summary',
          reason: '',
          decision: 'accepted',
        },
        {
          id: '2',
          path: 'experience.0.bullets.0',
          kind: 'remove',
          before: 'Built things.',
          after: '',
          reason: '',
          decision: 'accepted',
        },
        {
          id: '3',
          path: 'experience.0.bullets',
          kind: 'add',
          before: '',
          after: 'Shipped NgRx.',
          reason: '',
          decision: 'accepted',
        },
        {
          id: '4',
          path: 'skills.0.items',
          kind: 'add',
          before: '',
          after: 'RxJS',
          reason: '',
          decision: 'rejected',
        },
        {
          id: '5',
          path: 'contact.headline',
          kind: 'replace',
          before: '',
          after: 'X',
          reason: '',
          decision: 'pending',
        },
      ],
    });
    expect(r.summary).toBe('New summary');
    expect(r.experience[0].bullets).toEqual(['Fixed things.', 'Shipped NgRx.']);
    expect(r.skills[0].items).toEqual(['Angular', 'TypeScript']);
    expect(r.contact.headline).toBe('Senior Frontend Engineer | AI-Augmented');
  });

  it('does not remove when the master text no longer matches', () => {
    const r = applyVariant(master(), {
      baseResumeId: 'm',
      changes: [
        {
          id: '1',
          path: 'experience.0.bullets.0',
          kind: 'remove',
          before: 'stale',
          after: '',
          reason: '',
          decision: 'accepted',
        },
      ],
    });
    expect(r.experience[0].bullets).toHaveLength(2);
  });
});

describe('keywords', () => {
  const posting =
    'We need Angular and NgRx experience. Strong TypeScript. Accessibility matters: accessibility audits, accessibility reviews, accessibility training. GraphQL a plus.';

  it('extracts known tech terms and repeated words', () => {
    const k = extractKeywords(posting);
    expect(k).toContain('angular');
    expect(k).toContain('ngrx');
    expect(k).toContain('graphql');
    expect(k).toContain('accessibility');
    expect(k).not.toContain('strong');
  });

  it('reports coverage against the resume', () => {
    const rep = keywordReport(posting, master());
    expect(rep.matched).toEqual(
      expect.arrayContaining(['angular', 'typescript']),
    );
    expect(rep.missing).toEqual(expect.arrayContaining(['ngrx', 'graphql']));
    expect(rep.coverage).toBeGreaterThan(0);
    expect(rep.coverage).toBeLessThan(100);
  });
});

describe('parseVariantReply', () => {
  it('keeps only changes that fit the master', () => {
    const out = parseVariantReply(
      'Here: [{"path":"summary","kind":"replace","after":"Better","reason":"r"},{"path":"nope.x","kind":"replace","after":"x"},{"path":"skills.0.items","kind":"add","after":"NgRx"},{"path":"experience.0.bullets.1","kind":"remove"}]',
      master(),
    );
    expect(out.map((c) => c.path)).toEqual([
      'summary',
      'skills.0.items',
      'experience.0.bullets.1',
    ]);
    expect(out[0].before).toBe('Senior frontend engineer with Angular.');
    expect(out[2].before).toBe('Fixed things.');
  });
});

describe('localTailor', () => {
  it('proposes summary, skill and headline changes from the posting', () => {
    const out = localTailor(master(), {
      company: 'Northwind',
      title: 'Senior Angular Engineer',
      text: 'Angular, NgRx and RxJS.',
      stack: ['Angular', 'NgRx', 'RxJS'],
    });
    expect(out.find((c) => c.path === 'summary')?.after).toContain(
      'Senior Angular Engineer at Northwind',
    );
    expect(out.find((c) => c.path === 'skills.0.items')?.after).toBe('NgRx');
    expect(out.find((c) => c.path === 'contact.headline')?.after).toBe(
      'Senior Angular Engineer | AI-Augmented',
    );
  });
});
