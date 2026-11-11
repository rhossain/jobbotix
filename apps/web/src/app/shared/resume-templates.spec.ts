import { emptyResume, type ResumeSections } from '@jobbotix/shared-types';
import { buildResumePdf } from './resume-pdf';
import {
  DEFAULT_TEMPLATE_ID,
  RESUME_TEMPLATES,
  rgb,
  templateClasses,
  templateCssVars,
  templateOf,
} from './resume-templates';

const RESUME: ResumeSections = {
  ...emptyResume(),
  contact: {
    ...emptyResume().contact,
    name: 'Rafi Ahmed',
    headline: 'Senior Frontend Engineer',
    email: 'rafi@example.com',
    location: 'Dhaka',
  },
  summary: 'Frontend engineer with nine years on data-heavy dashboards.',
  skills: [{ name: 'Frontend', items: ['Angular', 'TypeScript'] }],
  experience: [
    {
      title: 'Senior Frontend Engineer',
      company: 'Northwind Analytics',
      location: 'Remote',
      start: '2020-01',
      end: '',
      bullets: ['Cut the main bundle by 38%'],
    },
  ],
  education: [
    { degree: 'B.Sc. Computer Science', institution: 'BUET', year: '2014' },
  ],
};

describe('resume templates', () => {
  it('offers three to five, named once each, with Classic free and first', () => {
    expect(RESUME_TEMPLATES.length).toBeGreaterThanOrEqual(3);
    expect(RESUME_TEMPLATES.length).toBeLessThanOrEqual(5);
    const ids = RESUME_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(RESUME_TEMPLATES.map((t) => t.name)).size).toBe(ids.length);
    expect(RESUME_TEMPLATES[0].id).toBe(DEFAULT_TEMPLATE_ID);
    expect(RESUME_TEMPLATES.filter((t) => !t.pro).map((t) => t.id)).toEqual([
      'classic',
    ]);
    // names the database's check accepts
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9_-]{1,30}$/);
  });

  it('falls back to Classic for a name it does not know', () => {
    expect(templateOf('serif').name).toBe('Elegant');
    for (const id of [undefined, null, '', 'gone'])
      expect(templateOf(id).id).toBe('classic');
  });

  it('gives the preview its colours, size and switches', () => {
    const compact = templateOf('compact');
    expect(templateCssVars(compact)['--scale']).toBe('0.9');
    expect(templateCssVars(compact)['--accent']).toBe(compact.accent);
    expect(templateCssVars(templateOf('serif'))['--resume-font']).toContain(
      'Times',
    );
    expect(templateClasses(templateOf('banner'))).toBe(
      'resume--head-banner resume--h-accent',
    );
    expect(rgb('#0b5f5a')).toEqual([11, 95, 90]);
  });
});

describe('the PDF in every template', () => {
  it.each(RESUME_TEMPLATES.map((t) => t.id))(
    '%s: real text, one column, sections in the same order',
    async (id) => {
      const { doc, dropped } = await buildResumePdf(RESUME, id);
      expect(dropped).toEqual([]);
      const pdf = doc.output();
      // Text an ATS can read: drawn as text operators, not as an image.
      for (const words of [
        'Rafi Ahmed',
        'Senior Frontend Engineer',
        'rafi@example.com',
        'Northwind Analytics',
        'Cut the main bundle by 38%',
        'Jan 2020',
      ])
        expect(pdf, `${id}: ${words}`).toContain(words);
      expect(pdf).not.toContain('/Subtype /Image');
      // The same reading order whatever the look.
      const at = [
        'Rafi Ahmed',
        'SUMMARY',
        'SKILLS',
        'EXPERIENCE',
        'EDUCATION',
      ].map((w) => pdf.indexOf(`(${w})`));
      expect(at.every((i) => i > 0)).toBe(true);
      expect([...at].sort((a, b) => a - b)).toEqual(at);
      // A font every reader has.
      expect(pdf).toContain(
        templateOf(id).font === 'serif' ? '/Times-Roman' : '/Helvetica',
      );
      expect(doc.getNumberOfPages()).toBe(1);
    },
  );

  it('draws a name it does not know as Classic', async () => {
    const classic = (await buildResumePdf(RESUME, 'classic')).doc.output();
    const unknown = (await buildResumePdf(RESUME, 'nope')).doc.output();
    const body = (s: string) => s.slice(0, s.indexOf('/CreationDate'));
    expect(body(unknown)).toBe(body(classic));
  });
});
