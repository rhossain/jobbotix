/**
 * Real-world resume layouts that broke (or would break) the import. Each
 * case is the text a reader hands the parser, as messy as it arrives.
 */
import { describe, expect, it } from 'vitest';
import { parseResumeText } from './resume-import';
import {
  htmlToResumeText,
  pdfPagesToText,
  type PdfTextItem,
} from './resume-text';

/** Exactly what pdf.js extracts from Sazzad's own PDF resume. */
const SAZZAD_PDF = `MD. SAZZAD HOSSAIN
rshossain.bd@gmail.com
+8801713204761
www.linkedin.com/in/rhossain
South Banasree, Dhaka, 1219
PROFESSIONAL SUMMARY
Innovative & results-oriented frontend developer with 10+ years of experience in design, development,
and management of e-commerce sites, CMS solutions and responsive web applications for various
companies.
SKILLS
• CSS3 (★★★★★)
• Bootstrap (★★★★★)
• HTML5 (★★★★☆)
• jQuery (★★★☆☆)
• Tailwind CSS (★★★☆☆)
• Angular Material (★★★★☆)
• Angular (★★★☆☆)
• NopCommerce (★★★★☆)
• WordPress (★★★☆☆)
• Figma (★★★☆☆)
• WooCommerce (★★★☆☆)
• Git (★★★★☆)
• Task prioritization (★★★★★)
• Teamwork (★★★★★)
• Problem-solving (★★★★☆)
• Multitasking (★★★★☆)
WORK EXPERIENCES
Senior UI Engineer, Brain Station 23 Ltd., Aug 2016 - Current
• Implemented wireframes (Figma, Invision, Zeplin) or PSD to HTML templates.
• Analyzed and developed themes for different platforms with responsive feature (SEO friendly)·
Software Engineer, Blueliner Digital Ltd., Jul 2013 - Jul 2016
• Implemented PSD to HTML templates with responsive feature.

Software Engineer, Codemen Solution Inc, Jan 2012 - Jun 2013
• Developed dynamic websites with PHP, MySQL and jQuery.
Web Developer, Uranus BD, Jul 2009 - Dec 2011
• Customized web templates for existing projects.
EDUCATION
Bachelor of Science in Computing & Information System, 2009
London Metropolitan University, UK
International Advanced Diploma in Computing System, 2007
NCC Education, UK
International Diploma in E-Commerce, 2006
NCC Education, UK
LANGUAGE PROFICENCY
• English (★★★☆☆) | • Bengali (★★★★★)
PROJECT URLs
https://kidstoys.nop-station.com/
https://nop-kalles.nop-station.com/
https://www.rhossain.com/demo/myrealty/
`;

describe('Sazzad’s PDF resume (regression)', () => {
  const { resume: r, warnings } = parseResumeText(SAZZAD_PDF);

  it('reads the contact block and tidies an all-caps name', () => {
    expect(r.contact).toMatchObject({
      name: 'Md. Sazzad Hossain',
      email: 'rshossain.bd@gmail.com',
      phone: '+8801713204761',
      location: 'South Banasree, Dhaka, 1219',
    });
    expect(r.contact.links).toEqual([
      { label: 'LinkedIn', url: 'https://www.linkedin.com/in/rhossain' },
    ]);
    expect(r.contact.headline).toBe('Senior UI Engineer');
    expect(warnings.some((w) => w.includes('No headline found'))).toBe(true);
  });

  it('finds "WORK EXPERIENCES" and all four roles', () => {
    expect(
      r.experience.map((e) => [e.title, e.company, e.start, e.end]),
    ).toEqual([
      ['Senior UI Engineer', 'Brain Station 23 Ltd.', '2016-08', ''],
      ['Software Engineer', 'Blueliner Digital Ltd.', '2013-07', '2016-07'],
      ['Software Engineer', 'Codemen Solution Inc', '2012-01', '2013-06'],
      ['Web Developer', 'Uranus BD', '2009-07', '2011-12'],
    ]);
    expect(r.experience[0].bullets[1]).toBe(
      'Analyzed and developed themes for different platforms with responsive feature (SEO friendly)',
    );
  });

  it('strips star ratings and sorts the flat skills list into groups', () => {
    const flat = r.skills
      .filter((g) => g.name !== 'Languages')
      .flatMap((g) => g.items)
      .join(' ');
    expect(flat).not.toMatch(/[★☆()]/);
    const group = (n: string) => r.skills.find((g) => g.name === n)?.items;
    expect(group('Frontend')).toEqual(['HTML5', 'jQuery', 'Angular']);
    expect(group('Styling & UI')).toEqual([
      'CSS3',
      'Bootstrap',
      'Tailwind CSS',
      'Angular Material',
    ]);
    expect(group('CMS & e-commerce')).toEqual([
      'NopCommerce',
      'WordPress',
      'WooCommerce',
    ]);
    expect(group('Soft skills')).toEqual([
      'Task prioritization',
      'Teamwork',
      'Problem-solving',
      'Multitasking',
    ]);
    expect(group('Languages')).toEqual([
      'English (Professional)',
      'Bengali (Native)',
    ]);
  });

  it('pairs each degree with its own institution', () => {
    expect(r.education).toEqual([
      {
        degree: 'Bachelor of Science in Computing & Information System',
        institution: 'London Metropolitan University, UK',
        year: '2009',
      },
      {
        degree: 'International Advanced Diploma in Computing System',
        institution: 'NCC Education, UK',
        year: '2007',
      },
      {
        degree: 'International Diploma in E-Commerce',
        institution: 'NCC Education, UK',
        year: '2006',
      },
    ]);
  });

  it('turns a list of bare links into projects', () => {
    expect(r.projects.map((p) => [p.name, p.url])).toEqual([
      ['Kidstoys', 'https://kidstoys.nop-station.com/'],
      ['Nop Kalles', 'https://nop-kalles.nop-station.com/'],
      ['Myrealty', 'https://www.rhossain.com/demo/myrealty/'],
    ]);
    expect(warnings).toContain(
      '3 projects have only a link; add a line on what each one is.',
    );
  });
});

describe('hard layouts', () => {
  it('date-first (Europass) entries with labelled contact lines', () => {
    const { resume: r } = parseResumeText(`Ana María López
Email: ana.lopez@example.es
Phone: +34 612 345 678
LinkedIn: linkedin.com/in/analopez
Madrid, Spain

EMPLOYMENT HISTORY:
03/2020 – Present
Senior Frontend Developer
Fintech Labs S.L. — Remote
• Led the migration from AngularJS to Angular 17.
• Built a design system used by four product teams.

09/2016 – 02/2020
Frontend Developer
Acme Corp, Barcelona, Spain
• Shipped the customer portal.
`);
    expect(r.contact).toMatchObject({
      name: 'Ana María López',
      email: 'ana.lopez@example.es',
      phone: '+34 612 345 678',
      location: 'Madrid, Spain',
    });
    expect(r.experience).toHaveLength(2);
    expect(r.experience[0]).toMatchObject({
      title: 'Senior Frontend Developer',
      company: 'Fintech Labs S.L.',
      location: 'Remote',
      start: '2020-03',
      end: '',
    });
    expect(r.experience[0].bullets).toHaveLength(2);
    expect(r.experience[1]).toMatchObject({
      title: 'Frontend Developer',
      start: '2016-09',
      end: '2020-02',
    });
  });

  it('letter-spaced headings, tabs, ligatures and wrapped hyphens', () => {
    const { resume: r } = parseResumeText(`JOHN  SMITH
john@smith.dev\t+1 415 555 0100\tSan Francisco, CA

S U M M A R Y
Frontend engineer who ﬁxes slow apps.

E X P E R I E N C E
Staff Engineer\tGlobex Inc.\tJan 2019 – Present
• Rebuilt the check-out flow in front-
end code, cutting drop-off by 12%.

S K I L L S
Angular, React, TypeScript, Tailwind, Jest, Git
`);
    expect(r.contact.name).toBe('John Smith');
    expect(r.contact.location).toBe('San Francisco, CA');
    expect(r.summary).toBe('Frontend engineer who fixes slow apps.');
    expect(r.experience[0]).toMatchObject({
      title: 'Staff Engineer',
      company: 'Globex Inc.',
      start: '2019-01',
    });
    expect(r.experience[0].bullets).toEqual([
      'Rebuilt the check-out flow in front-end code, cutting drop-off by 12%.',
    ]);
    expect(r.skills.flatMap((g) => g.items)).toEqual(
      expect.arrayContaining([
        'Angular',
        'React',
        'TypeScript',
        'Tailwind',
        'Jest',
        'Git',
      ]),
    );
  });

  it('markdown resumes', () => {
    const { resume: r } = parseResumeText(`# Priya Raman
**Senior Angular Developer** · priya@raman.io · github.com/priyar

## About
Angular developer with nine years across fintech and health tech products.

## Work Experience
### Lead Developer @ MedTech Labs | 2021 - 2024
- Owned the Angular 15 to 17 upgrade.

## Skills
- **Frontend:** Angular, RxJS, NgRx
- **Testing:** Jest, Cypress
`);
    expect(r.contact).toMatchObject({
      name: 'Priya Raman',
      headline: 'Senior Angular Developer',
      email: 'priya@raman.io',
    });
    expect(r.contact.links[0]).toEqual({
      label: 'GitHub',
      url: 'https://github.com/priyar',
    });
    expect(r.summary).toMatch(/^Angular developer with nine years/);
    expect(r.experience[0]).toMatchObject({
      title: 'Lead Developer',
      company: 'MedTech Labs',
      start: '2021',
      end: '2024',
    });
    expect(r.skills).toEqual([
      { name: 'Frontend', items: ['Angular', 'RxJS', 'NgRx'] },
      { name: 'Testing', items: ['Jest', 'Cypress'] },
    ]);
  });

  it('headings it has never seen are placed by their content', () => {
    const { resume: r, warnings } = parseResumeText(`Kim Lee
kim@lee.dev

PROFILE
Designer turned frontend engineer.

WHERE I'VE WORKED
Frontend Engineer, Initech, 2018 – 2022
• Built dashboards.

TOOLBOX
Figma, Angular, SCSS, Storybook

THINGS I LOVE
Bouldering and film photography.
`);
    expect(r.experience[0]).toMatchObject({
      title: 'Frontend Engineer',
      company: 'Initech',
    });
    expect(r.skills.flatMap((g) => g.items)).toContain('Storybook');
    expect(r.summary).toBe('Designer turned frontend engineer.');
    expect(warnings.some((w) => w.includes("Where I've Worked"))).toBe(true);
  });

  it('roles with no Experience heading at all', () => {
    const { resume: r, warnings } = parseResumeText(`Sam Ortiz
sam@ortiz.dev

Senior Developer | Umbrella Corp | 2020 – Present
• Ran the frontend guild.
Developer | Hooli | 2017 – 2020
• Built the search page.
`);
    expect(r.experience.map((e) => e.company)).toEqual([
      'Umbrella Corp',
      'Hooli',
    ]);
    expect(warnings).toContain(
      'Found roles without an Experience heading; check them.',
    );
  });

  it('skill ratings in every format, and a programming "Languages" group', () => {
    const { resume: r } = parseResumeText(`Lee Park
lee@park.dev
Skills
Languages: TypeScript, JavaScript, Python
Frameworks: Angular (Expert), React - Advanced, Vue 60%, Svelte 3/5
Languages
English - Fluent, Korean - Native
`);
    expect(r.skills).toEqual([
      {
        name: 'Programming languages',
        items: ['TypeScript', 'JavaScript', 'Python'],
      },
      { name: 'Frameworks', items: ['Angular', 'React', 'Vue', 'Svelte'] },
      { name: 'Languages', items: ['English (Fluent)', 'Korean (Native)'] },
    ]);
  });

  it('education with year ranges and institution first', () => {
    const { resume: r } = parseResumeText(`Nadia Akter
nadia@akter.dev
Education
University of Dhaka | 2010 – 2014
BSc in Computer Science and Engineering
CGPA 3.6
Dhaka College
HSC, Science, 2010
`);
    expect(r.education).toEqual([
      {
        institution: 'University of Dhaka',
        degree: 'BSc in Computer Science and Engineering',
        year: '2014',
      },
      { institution: 'Dhaka College', degree: 'HSC', year: '2010' },
    ]);
  });

  it('never crashes on junk and says what is missing', () => {
    for (const junk of [
      '\u0000\u0001',
      '★★★★★',
      '|||',
      '2019 - 2020',
      'a\n\n\n\nb',
    ]) {
      const { warnings } = parseResumeText(junk);
      expect(Array.isArray(warnings)).toBe(true);
    }
    const { warnings } = parseResumeText(
      'random words with no structure at all',
    );
    expect(warnings).toContain('Could not find an email address.');
  });
});

describe('pdfPagesToText', () => {
  const run = (str: string, x: number, y: number, size = 10): PdfTextItem => ({
    str,
    x,
    y,
    width: str.length * size * 0.5,
    height: size,
  });

  it('spaces runs by their real gaps', () => {
    const text = pdfPagesToText([
      {
        width: 600,
        height: 800,
        items: [
          run('Senior UI Engineer', 72, 700),
          run(',', 162, 700),
          run(' ', 167, 700),
          run('Brain Station', 167, 700),
          run('Ltd.', 237, 700),
          run('•', 72, 680),
          run('Built themes.', 90, 680),
        ],
      },
    ]);
    expect(text).toBe(
      'Senior UI Engineer, Brain Station Ltd.\n• Built themes.',
    );
  });

  it('reads a scrambled two-column page column by column', () => {
    const left = [
      'SKILLS',
      'Angular',
      'TypeScript',
      'SCSS',
      'Figma',
      'Git',
      'Jest',
    ];
    const right = [
      'EXPERIENCE',
      'Lead Engineer, Globex Inc., 2019 - 2024',
      '• Led the platform team of six engineers.',
      '• Rebuilt the design system from scratch.',
      '• Cut build times by half with Nx caching.',
      '• Mentored four junior frontend developers.',
      '• Ran the hiring loop for the web team.',
    ];
    const items: PdfTextItem[] = [];
    // Interleave the two columns in the content stream, as some tools do.
    for (let i = 0; i < 7; i++) {
      items.push(run(right[i], 220, 700 - i * 20 - 3));
      items.push(run(left[i], 40, 700 - i * 20));
    }
    items.unshift(run('JANE DOE', 40, 760, 20));
    const text = pdfPagesToText([
      { width: 600, height: 800, items: items.reverse() },
    ]);
    const lines = text.split('\n').filter(Boolean);
    expect(lines[0]).toBe('JANE DOE');
    expect(lines.slice(1, 8)).toEqual(left);
    expect(lines.slice(8)).toEqual(right);
  });

  it('reads a two-column page written row by row across both columns', () => {
    const left = [
      'CONTACT',
      'jane@doe.dev',
      'London, UK',
      'SKILLS',
      'Angular',
      'RxJS',
      'Jest',
    ];
    const right = [
      'EXPERIENCE',
      'Lead Engineer, Globex Inc., 2019 - 2024',
      '• Led the platform team of six engineers.',
      '• Rebuilt the design system from scratch.',
      '• Cut build times by half with Nx caching.',
      '• Mentored four junior frontend developers.',
      '• Ran the hiring loop for the web team.',
    ];
    const items: PdfTextItem[] = [];
    for (let i = 0; i < 7; i++) {
      items.push(run(right[i], 220, 700 - i * 20));
      items.push(run(left[i], 40, 700 - i * 20));
    }
    const lines = pdfPagesToText([{ width: 600, height: 800, items }])
      .split('\n')
      .filter(Boolean);
    expect(lines).toEqual([...left, ...right]);
  });

  it('drops page numbers and running headers', () => {
    const page = (n: number, body: string) => ({
      width: 600,
      height: 800,
      items: [
        run('Jane Doe — Resume', 40, 780),
        run(body, 40, 700),
        run(`Page ${n} of 2`, 40, 30),
      ],
    });
    expect(
      pdfPagesToText([page(1, 'First page.'), page(2, 'Second page.')]),
    ).toBe('First page.\n\nSecond page.');
  });
});

describe('htmlToResumeText', () => {
  it('reads a skills table as named groups (Word templates)', () => {
    const html =
      '<p>Jane Doe</p><p>jane@doe.dev</p><h2>Core Skills</h2>' +
      '<table><tr><td><p>Frontend</p></td><td><p>Angular, TypeScript, RxJS</p></td></tr>' +
      '<tr><td><p>Styling</p></td><td><p>SCSS, Tailwind CSS</p></td></tr></table>';
    const { resume: r } = parseResumeText(htmlToResumeText(html));
    expect(r.skills).toEqual([
      { name: 'Frontend', items: ['Angular', 'TypeScript', 'RxJS'] },
      { name: 'Styling', items: ['SCSS', 'Tailwind CSS'] },
    ]);
  });

  it('keeps headings, bullets and table cells from a .docx', () => {
    const html =
      '<table><tr><td><p>Jane Doe</p></td><td><p>jane@doe.dev</p></td></tr></table>' +
      '<p>Site: <a href="https://jane.dev">my site</a></p>' +
      '<h2>Experience</h2><p><strong>Lead Engineer</strong>, Globex Inc., 2019 &ndash; 2024</p>' +
      '<ul><li>Led the &amp; platform team.</li><li>Rebuilt it.</li></ul>';
    const text = htmlToResumeText(html);
    expect(text).toBe(
      'Jane Doe | jane@doe.dev\n\nSite: my site https://jane.dev\n\nExperience\nLead Engineer, Globex Inc., 2019 – 2024\n\n• Led the & platform team.\n• Rebuilt it.',
    );
    const { resume: r } = parseResumeText(text);
    expect(r.contact).toMatchObject({
      name: 'Jane Doe',
      email: 'jane@doe.dev',
      website: 'https://jane.dev',
    });
    expect(r.experience[0]).toMatchObject({
      title: 'Lead Engineer',
      company: 'Globex Inc.',
    });
    expect(r.experience[0].bullets).toEqual([
      'Led the & platform team.',
      'Rebuilt it.',
    ]);
  });
});
