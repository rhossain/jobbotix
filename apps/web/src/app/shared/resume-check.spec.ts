import { emptyResume, type ResumeSections } from '@jobbotix/shared-types';
import { checkResume, hasMetric, slips } from './resume-check';

/** A resume with nothing to fix. */
const STRONG: ResumeSections = {
  ...emptyResume(),
  contact: {
    name: 'Rafi Ahmed',
    headline: 'Senior Frontend Engineer',
    email: 'rafi@example.com',
    phone: '+880 1700 000000',
    location: 'Dhaka, Bangladesh',
    website: 'https://rafi.example',
    links: [{ label: 'LinkedIn', url: 'https://www.linkedin.com/in/rafi' }],
  },
  summary:
    'Senior frontend engineer with nine years building data-heavy dashboards in Angular and TypeScript. Led the move of a 140-screen product to signals and cut its main bundle by 38 percent. Strongest at performance work, design systems and mentoring.',
  skills: [
    { name: 'Frontend', items: ['Angular', 'TypeScript', 'RxJS', 'SCSS'] },
    { name: 'Tooling', items: ['Nx', 'Vitest', 'Cypress', 'GitHub Actions'] },
  ],
  experience: [
    {
      title: 'Senior Frontend Engineer',
      company: 'Northwind Analytics',
      location: 'Remote',
      start: '2020-01',
      end: '',
      bullets: [
        'Cut the main bundle by 38% by moving 140 screens to Angular signals',
        'Led a team of 5 engineers shipping a release every 2 weeks',
        'Built the design system used by 12 product teams',
        'Mentored junior engineers through code review and pairing',
      ],
    },
    {
      title: 'Frontend Developer',
      company: 'Earlier Agency',
      location: 'Dhaka',
      start: '2015-06',
      end: '2019-12',
      bullets: [
        'Shipped responsive sites for 40+ clients in HTML5 and SCSS',
        'Reduced page load from 6s to under 2s on 3G',
        'Owned the agency component library and coding standards',
      ],
    },
  ],
  education: [
    { degree: 'B.Sc. Computer Science', institution: 'BUET', year: '2014' },
  ],
};
const padded = (r: ResumeSections): ResumeSections => ({
  ...r,
  // enough words to pass the length check without touching what is tested
  aiToolkit: Array.from({ length: 250 }, (_, i) => `tool${i}`),
});
const check = (r: ResumeSections) => checkResume(padded(r));
const failedIds = (r: ResumeSections) => check(r).failed.map((c) => c.id);

describe('hasMetric', () => {
  it('counts a figure that measures something', () => {
    for (const s of [
      'Cut the bundle by 38%',
      'Shipped sites for 40+ clients',
      'From 6s to under 2s',
      'Moved 140 screens',
      'Saved $2M a year',
      'A 3x gain',
      'Led 5 engineers',
    ])
      expect(hasMetric(s), s).toBe(true);
  });

  it('does not count a digit in a name, or a year', () => {
    for (const s of [
      'Built sites in HTML5 and CSS3',
      'A cinematic 3D viewer',
      'Joined the team in 2019',
      'Lead frontend delivery on client Angular products',
    ])
      expect(hasMetric(s), s).toBe(false);
  });
});

describe('slips', () => {
  it('finds doubled words and stray spaces, and leaves clean text alone', () => {
    expect(slips('Led the the team')).toEqual(['"the the" repeats a word']);
    expect(slips('Built it  fast')).toEqual(['two spaces in a row']);
    expect(slips('Fast , reliable')).toEqual(['a space before punctuation']);
    expect(slips('Angular,TypeScript')).toEqual([
      'no space after a comma or colon',
    ]);
    expect(
      slips(
        'Built a portal (https://a.example/x:1) with Service Worker/IndexedDB caching: fast.',
      ),
    ).toEqual([]);
  });
});

describe('checkResume', () => {
  it('gives a strong resume 100 and nothing to fix', () => {
    const c = check(STRONG);
    // the points on offer are out of 100
    expect(
      c.areas.flatMap((a) => a.checks).reduce((n, x) => n + x.max, 0),
    ).toBe(100);
    expect(c.failed.map((f) => `${f.id}: ${f.advice}`)).toEqual([]);
    expect(c.score).toBe(100);
    expect(c.passed).toBe(c.total);
    expect(c.areas.map((a) => a.score)).toEqual([100, 100, 100, 100, 100]);
  });

  it('gives an empty resume a low score and says where to start', () => {
    const c = checkResume(emptyResume());
    expect(c.score).toBe(0);
    expect(c.failed.map((f) => f.id)).toContain('experience');
    expect(c.failed.map((f) => f.id)).toContain('email');
  });

  it('flags what a public checker flagged on a real resume: no LinkedIn, no education, bullets without numbers', () => {
    const r: ResumeSections = {
      ...STRONG,
      contact: { ...STRONG.contact, links: [] },
      education: [],
      experience: [
        {
          ...STRONG.experience[0],
          bullets: [
            'Lead frontend delivery on client Angular products',
            'Built and maintained a production Angular news portal',
            'Delivered NopCommerce and WordPress themes for clients',
            'Introduced AI-assisted workflows into day-to-day delivery',
          ],
        },
      ],
    };
    const c = check(r);
    expect(c.failed.map((f) => f.id)).toEqual([
      'metrics',
      'education',
      'linkedin',
    ]);
    const metrics = c.failed[0];
    expect(metrics.points).toBe(0);
    expect(metrics.advice).toContain('4 of 4 bullets have no figure');
    expect(metrics.items[0]).toEqual({
      text: 'Lead frontend delivery on client Angular products',
      field: 'r-exp-bullets-0',
    });
    expect(c.failed[2].items[0].field).toBe('rc-links');
    expect(c.score).toBe(Math.round(((100 - 16 - 5 - 3) / 100) * 100));
  });

  it('earns part of the points for bullets with numbers', () => {
    const r: ResumeSections = {
      ...STRONG,
      experience: [
        {
          ...STRONG.experience[0],
          bullets: [
            'Cut the bundle by 38%',
            'Built the design system',
            'Mentored engineers',
            'Owned releases',
          ],
        },
      ],
    };
    const metrics = check(r).areas[2].checks[0];
    // one in four, where half is the target
    expect(metrics.points).toBe(8);
    expect(metrics.ok).toBe(false);
  });

  it('names weak openers, long bullets, stock phrases and repeated verbs', () => {
    const long = `Built ${'a very detailed thing and '.repeat(8)}more for 9 clients`;
    const r: ResumeSections = {
      ...STRONG,
      summary: `${STRONG.summary} A hard-working team player.`,
      experience: [
        {
          ...STRONG.experience[0],
          bullets: [
            'Responsible for the dashboard used by 12 teams',
            'I worked on 3 releases',
            long,
            'Built 4 internal tools',
            'Built 2 design systems.',
            'Built the the pipeline for 6 apps',
          ],
        },
      ],
    };
    const ids = failedIds(r);
    for (const id of [
      'openers',
      'long-bullets',
      'cliches',
      'repetition',
      'full-stops',
      'slips',
    ])
      expect(ids, id).toContain(id);
    const c = check(r);
    const by = (id: string) => c.failed.find((f) => f.id === id);
    expect(by('openers')?.items.map((i) => i.text)).toEqual([
      'Responsible for the dashboard used by 12 teams',
      'I worked on 3 releases',
    ]);
    expect(by('cliches')?.items.map((i) => i.text)).toEqual([
      'hard-working',
      'team player',
    ]);
    expect(by('repetition')?.items[0].text).toBe('"built" opens 4 bullets');
    // every wording finding can go to the AI review
    expect(by('openers')?.wording).toBe(true);
    expect(by('slips')?.wording).toBeUndefined();
  });

  it('checks the order of roles, their dates, and characters the PDF cannot show', () => {
    const r: ResumeSections = {
      ...STRONG,
      summary: `${STRONG.summary} ✅`,
      experience: [
        STRONG.experience[1],
        { ...STRONG.experience[0], start: '' },
      ],
    };
    const c = check(r);
    const by = (id: string) => c.failed.find((f) => f.id === id);
    expect(by('characters')?.items[0].text).toBe('✅');
    expect(by('experience')?.items).toEqual([
      {
        text: 'Senior Frontend Engineer at Northwind Analytics, no start date',
        field: 'r-exp-start-1',
      },
    ]);
    const swapped = check({
      ...STRONG,
      experience: [STRONG.experience[1], STRONG.experience[0]],
    });
    expect(swapped.failed.map((f) => f.id)).toContain('order');
  });

  it('asks for the country code on a phone number', () => {
    const phone = (v: string) =>
      check({
        ...STRONG,
        contact: { ...STRONG.contact, phone: v },
      }).areas[0].checks.find((x) => x.id === 'phone');
    expect(phone('+880 1713 204761')?.ok).toBe(true);
    expect(phone('00880 1713 204761')?.ok).toBe(true);
    const national = phone('01713204761');
    expect(national?.points).toBe(1.5);
    expect(national?.advice).toContain('country code');
    expect(phone('')?.points).toBe(0);
  });

  it('lists what costs the most points first', () => {
    const c = check({
      ...STRONG,
      education: [],
      contact: { ...STRONG.contact, location: '' },
    });
    expect(c.failed.map((f) => f.id)).toEqual(['education', 'location']);
  });
});
