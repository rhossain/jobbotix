import { describe, expect, it } from 'vitest';
import { parseResumeText } from './resume-import';

const PIPED = `Sazzad Hossain
Senior Frontend Engineer | AI-Augmented Development
Dhaka, Bangladesh | +880 1711 000000 | rshossain.bd@gmail.com | linkedin.com/in/rshossain | github.com/rhossain | rshossain.me

SUMMARY
Senior frontend engineer with 15+ years building Angular products for retail and enterprise clients. Ships with an AI-assisted workflow.

TECHNICAL SKILLS
Frontend: Angular, TypeScript, RxJS, SCSS, Tailwind
Platforms: NopCommerce, WordPress
AI Toolkit
Claude, GitHub Copilot, Cursor

EXPERIENCE
Senior Frontend Engineer | Brain Station 23 Ltd. | Dhaka, Bangladesh | Mar 2019 – Present
- Led the Angular front end of a multi-tenant commerce platform serving 40 stores.
- Cut initial bundle size by 38% through route-level code splitting and
  lazy image loading.
Frontend Developer, Acme Studio (2014 - 2019)
• Built WordPress themes for 30+ clients.

PROJECTS
Styloviz – Angular/Tailwind UI component library. https://styloviz.dev
Stack: Angular, Tailwind, Nx
Iveraine: AI-powered real-estate platform

EDUCATION
B.Sc. in Computer Science, University of Dhaka, 2009

CERTIFICATIONS
Google UX Design Certificate (2022)
AWS Cloud Practitioner
`;

describe('parseResumeText', () => {
  it('reads contact details from a piped header', () => {
    const { resume: r } = parseResumeText(PIPED);
    expect(r.contact.name).toBe('Sazzad Hossain');
    expect(r.contact.headline).toBe(
      'Senior Frontend Engineer | AI-Augmented Development',
    );
    expect(r.contact.email).toBe('rshossain.bd@gmail.com');
    expect(r.contact.phone).toBe('+880 1711 000000');
    expect(r.contact.location).toBe('Dhaka, Bangladesh');
    expect(r.contact.website).toBe('rshossain.me');
    expect(r.contact.links.map((l) => l.label)).toEqual(['LinkedIn', 'GitHub']);
  });

  it('places summary, skill groups and the AI toolkit', () => {
    const { resume: r } = parseResumeText(PIPED);
    expect(r.summary).toMatch(/^Senior frontend engineer with 15\+ years/);
    expect(r.skills).toEqual([
      {
        name: 'Frontend',
        items: ['Angular', 'TypeScript', 'RxJS', 'SCSS', 'Tailwind'],
      },
      { name: 'Platforms', items: ['NopCommerce', 'WordPress'] },
    ]);
    expect(r.aiToolkit).toEqual(['Claude', 'GitHub Copilot', 'Cursor']);
  });

  it('splits experience on date ranges and joins wrapped bullets', () => {
    const { resume: r } = parseResumeText(PIPED);
    expect(r.experience).toHaveLength(2);
    const [a, b] = r.experience;
    expect(a).toMatchObject({
      title: 'Senior Frontend Engineer',
      company: 'Brain Station 23 Ltd.',
      location: 'Dhaka, Bangladesh',
      start: '2019-03',
      end: '',
    });
    expect(a.bullets).toHaveLength(2);
    expect(a.bullets[1]).toBe(
      'Cut initial bundle size by 38% through route-level code splitting and lazy image loading.',
    );
    expect(b).toMatchObject({
      title: 'Frontend Developer',
      company: 'Acme Studio',
      start: '2014',
      end: '2019',
      bullets: ['Built WordPress themes for 30+ clients.'],
    });
  });

  it('reads projects, education and certifications', () => {
    const { resume: r } = parseResumeText(PIPED);
    expect(r.projects[0]).toMatchObject({
      name: 'Styloviz',
      url: 'https://styloviz.dev',
      stack: ['Angular', 'Tailwind', 'Nx'],
    });
    expect(r.projects[0].description).toMatch(/UI component library/);
    expect(r.projects[1]).toMatchObject({ name: 'Iveraine' });
    expect(r.education).toEqual([
      {
        institution: 'University of Dhaka',
        degree: 'B.Sc. in Computer Science',
        year: '2009',
      },
    ]);
    expect(r.certifications).toEqual([
      'Google UX Design Certificate (2022)',
      'AWS Cloud Practitioner',
    ]);
  });

  it('handles the stacked company / title / dates layout', () => {
    const text = `Jane Doe
jane@example.com

Work Experience

Globex Corporation
Lead Developer
January 2020 — December 2022
Shipped the thing.
Did the other thing.

Initech
Software Engineer
2017 – 2020
Maintained legacy systems.
`;
    const { resume: r } = parseResumeText(text);
    expect(r.experience).toHaveLength(2);
    expect(r.experience[0]).toMatchObject({
      company: 'Globex Corporation',
      title: 'Lead Developer',
      start: '2020-01',
      end: '2022-12',
    });
    expect(r.experience[0].bullets).toEqual([
      'Shipped the thing.',
      'Did the other thing.',
    ]);
    expect(r.experience[1]).toMatchObject({
      company: 'Initech',
      title: 'Software Engineer',
      start: '2017',
      end: '2020',
    });
  });

  it('warns instead of failing on thin input', () => {
    const { resume, warnings } = parseResumeText('Just a name\n');
    expect(resume.contact.name).toBe('Just a name');
    expect(warnings).toContain(
      'No Experience section found; check the headings.',
    );
    expect(parseResumeText('   ').warnings).toEqual(['Nothing to import.']);
  });
});
