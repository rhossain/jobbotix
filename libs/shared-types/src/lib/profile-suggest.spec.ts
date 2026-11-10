import { describe, expect, it } from 'vitest';
import { emptyResume, type ResumeSections } from './resume';
import { suggestProfile } from './profile-suggest';

const resume = (p: Partial<ResumeSections>): ResumeSections => ({
  ...emptyResume(),
  ...p,
});

describe('suggestProfile', () => {
  const r = resume({
    contact: {
      ...emptyResume().contact,
      headline: 'Senior Frontend Engineer | AI-Augmented Development',
      location: 'Dhaka, Bangladesh',
    },
    skills: [
      { name: 'Frontend', items: ['Angular', 'TypeScript', 'SCSS', 'React'] },
      { name: 'Tools', items: ['Nx', 'Figma'] },
    ],
    experience: [
      {
        company: 'Brain Station 23',
        title: 'Senior Software Engineer (Frontend)',
        location: 'Dhaka',
        start: '2019-03',
        end: '',
        bullets: [
          'Led Angular and TypeScript migration to Nx',
          'Built Angular design system with SCSS tokens',
        ],
      },
      {
        company: 'Earlier Co',
        title: 'Angular Developer',
        location: '',
        start: '2010',
        end: '2019',
        bullets: ['Angular storefronts'],
      },
    ],
  });

  it('reads target roles at the right level, newest first', () => {
    const s = suggestProfile(r, new Date('2026-11-10'));
    expect(s.targetRoles).toEqual([
      'Senior Frontend Engineer',
      'Senior Software Engineer',
      'Senior Angular Developer',
    ]);
    expect(s.minSeniority).toBe('senior');
    expect(s.years).toBe(16);
  });

  it('ranks stacks by how often the experience uses them', () => {
    const s = suggestProfile(r);
    expect(s.stacks.slice(0, 3)).toEqual(['Angular', 'TypeScript', 'SCSS']);
    expect(s.stacks).toContain('React');
    expect(s.stacks.length).toBeLessThanOrEqual(8);
  });

  it('reads the home country from the location', () => {
    expect(suggestProfile(r).homeCountry).toBe('BD');
    expect(
      suggestProfile(
        resume({ contact: { ...emptyResume().contact, location: 'Remote' } }),
      ).homeCountry,
    ).toBeNull();
  });

  it('stays at mid level for a short career', () => {
    const s = suggestProfile(
      resume({
        experience: [
          {
            company: 'X',
            title: 'Frontend Developer',
            location: '',
            start: '2024',
            end: '',
            bullets: [],
          },
        ],
      }),
      new Date('2026-11-10'),
    );
    expect(s.minSeniority).toBe('mid');
    expect(s.targetRoles).toEqual(['Frontend Developer']);
  });

  it('copes with an empty resume', () => {
    expect(suggestProfile(emptyResume())).toEqual({
      targetRoles: [],
      stacks: [],
      minSeniority: 'mid',
      homeCountry: null,
      years: null,
    });
  });
});
