import { deepStrictEqual as assertEquals, ok as assert } from 'node:assert';
import { type MatchPosting, matchPosting, type MatchProfile } from './match.ts';
import { bestRoleFit, coreWords, parseRole, searchTerm } from './role.ts';
import { DEFAULT_WEIGHTS, heuristicScore } from './score.ts';
import { buildQueries } from './queries.ts';
import { wanted } from './sources/ats.ts';

// The designation test set: for each target role, titles that are that job
// and titles that are not. Any profession; the bars are 90% of "yes" titles
// accepted and at most 5% of "no" titles accepted, across the whole set.
const SET: [role: string, yes: string[], no: string[]][] = [
  [
    'SQA Engineer',
    [
      'SQA Engineer',
      'Senior QA Engineer',
      'Quality Assurance Engineer',
      'Software Quality Assurance Engineer',
      'QA Automation Engineer',
      'Test Automation Engineer',
      'Software Tester',
      'SDET',
      'Software Engineer in Test',
      'QA Analyst',
      'Manual QA Tester',
      'Sr. Software Test Engineer',
      'QA Engineer (Playwright)',
      'Engineer, Quality Assurance',
    ],
    [
      'Quality Assurance Nurse',
      'Software Sales Executive',
      'Frontend Engineer',
      'Call Quality Analyst',
      'Data Engineer',
      'Penetration Tester',
    ],
  ],
  [
    'Senior Frontend Engineer',
    [
      'Front-End Developer',
      'Sr. Front End Engineer (React)',
      'Software Engineer, Frontend',
      'UI Engineer',
      'Frontend Lead',
      'Web Developer (React)',
      'JavaScript Engineer',
      'Frontend Architect',
      'Lead Frontend Developer',
    ],
    [
      'Backend Engineer',
      'Senior Java Engineer',
      'Frontend QA Engineer',
      'Product Designer',
      'Data Scientist',
      'Front Desk Coordinator',
    ],
  ],
  [
    'Senior Angular Developer',
    [
      'Angular Developer',
      'Senior Angular Engineer',
      'Angular Frontend Developer',
      'Frontend Lead (Angular)',
      'Angular Architect',
    ],
    ['React Developer', 'Senior Java Engineer', 'Product Manager'],
  ],
  [
    'Software Engineer',
    [
      'Software Engineer',
      'Senior Software Developer',
      'Backend Engineer',
      'Full-Stack Engineer',
      'Software Engineer II',
      'Staff Software Engineer, Payments',
      'Programmer',
    ],
    [
      'Software Sales Executive',
      'Sales Engineer',
      'Software Engineering Manager',
      'Technical Writer',
      'Software Trainer',
    ],
  ],
  [
    'Senior Developer',
    ['Senior Developer', 'Software Developer', 'Backend Engineer'],
    ['Business Development Manager', 'Office Manager'],
  ],
  [
    'Full Stack Developer',
    [
      'Full-Stack Engineer',
      'Fullstack Developer',
      'Software Engineer (Full Stack)',
      'Full Stack Web Developer',
    ],
    ['Stack Operator', 'Data Analyst'],
  ],
  [
    'Node.js Developer',
    [
      'NodeJS Developer',
      'Node.js Engineer',
      'Backend Engineer (Node)',
      'Senior Node Developer',
    ],
    ['React Developer', 'Network Engineer', 'Nodes Coordinator'],
  ],
  [
    'DevOps Engineer',
    [
      'DevOps Engineer',
      'Site Reliability Engineer',
      'SRE',
      'Platform Engineer',
      'Cloud Infrastructure Engineer',
      'Senior DevOps Lead',
    ],
    ['Frontend Engineer', 'Operations Manager', 'Product Manager'],
  ],
  [
    'Engineering Manager',
    [
      'Engineering Manager',
      'Software Engineering Manager',
      'Manager, Engineering',
      'Senior Engineering Manager',
    ],
    [
      'Office Manager',
      'Account Manager',
      'Engineering Program Manager',
      'Product Manager',
    ],
  ],
  [
    'Technical Lead',
    ['Tech Lead', 'Technical Lead', 'Engineering Team Lead'],
    ['Technical Writer', 'Technical Support Agent', 'Sales Lead Generator'],
  ],
  [
    'Head of Engineering',
    [
      'Head of Engineering',
      'VP of Engineering',
      'Director of Engineering',
      'VP, Engineering',
    ],
    ['Head of People', 'Head of Sales', 'Engineering Intern'],
  ],
  [
    'Product Manager',
    [
      'Senior Product Manager',
      'Product Manager, Growth',
      'Technical Product Manager',
      'Product Owner',
      'Product Manager II',
    ],
    [
      'Product Marketing Manager',
      'Manager, Product Design',
      'Project Manager',
      'Product Designer',
      'Production Manager',
    ],
  ],
  [
    'Project Manager',
    [
      'Project Manager',
      'Senior Technical Project Manager',
      'IT Project Manager',
      'Scrum Master',
    ],
    ['Product Manager', 'Project Engineer', 'Account Manager'],
  ],
  [
    'UI/UX Designer',
    [
      'UX Designer',
      'Product Designer',
      'UI/UX Designer',
      'Senior UX/UI Designer',
      'UI Designer',
      'User Experience Designer',
    ],
    [
      'Graphic Designer',
      'Instructional Designer',
      'UX Writer',
      'Frontend Engineer',
    ],
  ],
  [
    'Graphic Designer',
    ['Graphic Designer', 'Senior Visual Designer', 'Brand Designer'],
    ['UX Designer', 'Fashion Designer', 'Instructional Designer'],
  ],
  [
    'Data Analyst',
    [
      'Data Analyst',
      'Senior Data Analyst',
      'BI Analyst',
      'Business Intelligence Analyst',
    ],
    [
      'Data Entry Clerk',
      'Financial Analyst',
      'Data Engineer',
      'Security Analyst',
    ],
  ],
  [
    'Data Scientist',
    [
      'Data Scientist',
      'Senior Data Scientist',
      'Applied Scientist',
      'Machine Learning Engineer',
    ],
    ['Data Entry Specialist', 'Political Scientist', 'Lab Scientist'],
  ],
  [
    'Business Analyst',
    [
      'Business Analyst',
      'Senior Business Systems Analyst',
      'IT Business Analyst',
    ],
    ['Business Development Manager', 'Data Analyst', 'Financial Analyst'],
  ],
  [
    'Digital Marketing Manager',
    [
      'Digital Marketing Manager',
      'Digital Marketing Specialist',
      'Performance Marketing Manager',
      'Senior Digital Marketer',
    ],
    ['Product Manager', 'Marketing Designer', 'Sales Manager'],
  ],
  [
    'Content Writer',
    [
      'Content Writer',
      'Copywriter',
      'Senior Content Writer',
      'Freelance Writer',
    ],
    ['Underwriter', 'Grant Manager', 'Content Moderator'],
  ],
  [
    'Customer Support Specialist',
    [
      'Customer Support Specialist',
      'Customer Service Representative',
      'Customer Support Agent',
      'Customer Support Rep',
      'Support Specialist',
    ],
    [
      'Customer Success Manager',
      'Sales Support Coordinator',
      'Support Engineer Manager',
    ],
  ],
  [
    'Sales Executive',
    [
      'Sales Executive',
      'Account Executive',
      'Sales Development Representative',
      'SDR',
    ],
    ['Sales Engineer', 'Executive Assistant', 'Chief Executive Officer'],
  ],
  [
    'HR Manager',
    [
      'HR Manager',
      'Human Resources Manager',
      'HR Business Partner',
      'Senior HR Generalist',
    ],
    ['Engineering Manager', 'HR Software Engineer', 'Office Manager'],
  ],
  [
    'Recruiter',
    [
      'Technical Recruiter',
      'Senior Recruiter',
      'Talent Acquisition Specialist',
    ],
    ['Recruiting Software Engineer', 'HR Manager'],
  ],
  [
    'Accountant',
    ['Accountant', 'Senior Accountant', 'Staff Accountant', 'Bookkeeper'],
    ['Account Executive', 'Account Manager', 'Accounting Software Engineer'],
  ],
  [
    'Registered Nurse',
    ['Registered Nurse', 'RN', 'Telehealth Nurse', 'Nurse Practitioner'],
    ['Nursing Recruiter', 'Medical Coder', 'Software Engineer'],
  ],
  [
    'Teacher',
    ['Online English Teacher', 'Math Tutor', 'Instructor'],
    ['Teaching Software Engineer', 'Instructional Designer'],
  ],
  [
    'Virtual Assistant',
    ['Virtual Assistant', 'Executive Assistant', 'Administrative Assistant'],
    ['Assistant Professor', 'Research Assistant', 'Marketing Assistant'],
  ],
  // designations no family lists: they still match on their own words
  [
    'Salesforce Administrator',
    [
      'Salesforce Administrator',
      'Senior Salesforce Admin',
      'Salesforce Admin (Remote)',
    ],
    ['System Administrator', 'Salesforce Developer', 'Office Administrator'],
  ],
  [
    'Supply Chain Analyst',
    [
      'Supply Chain Analyst',
      'Senior Supply Chain Analyst',
      'Analyst, Supply Chain',
    ],
    ['Data Analyst', 'Supply Chain Manager'],
  ],
  [
    'Medical Coder',
    ['Medical Coder', 'Certified Medical Coder'],
    ['Medical Assistant', 'Software Developer'],
  ],
  [
    'Game Designer',
    ['Game Designer', 'Senior Game Designer'],
    ['Graphic Designer', 'Game Developer'],
  ],
  [
    'Scrum Master',
    ['Scrum Master', 'Senior Scrum Master'],
    ['Product Manager', 'Master Electrician'],
  ],
  [
    'Compliance Officer',
    ['Compliance Officer', 'Senior Compliance Officer'],
    ['Chief Executive Officer', 'Compliance Analyst'],
  ],
  [
    'Civil Engineer',
    ['Civil Engineer', 'Senior Civil Engineer'],
    ['Software Engineer', 'Civil Litigation Paralegal'],
  ],
  [
    'Video Editor',
    ['Video Editor', 'Senior Video Editor'],
    ['Content Editor', 'Video Game Tester'],
  ],
];

Deno.test(
  'designation test set: 90% of the right titles, at most 5% of the wrong ones',
  () => {
    let yes = 0;
    let yesHit = 0;
    let no = 0;
    let noHit = 0;
    const missed: string[] = [];
    const wrong: string[] = [];
    for (const [role, good, bad] of SET) {
      for (const t of good) {
        yes++;
        if (bestRoleFit([role], t)) yesHit++;
        else missed.push(`${role} <- ${t}`);
      }
      for (const t of bad) {
        no++;
        if (bestRoleFit([role], t)) {
          noHit++;
          wrong.push(`${role} <- ${t}`);
        }
      }
    }
    const recall = yesHit / yes;
    const falseRate = noHit / no;
    console.log(
      `designations ${SET.length}; recall ${(recall * 100).toFixed(1)}% (${yesHit}/${yes}); false matches ${(
        falseRate * 100
      ).toFixed(1)}% (${noHit}/${no})`,
    );
    if (missed.length) console.log('missed:\n  ' + missed.join('\n  '));
    if (wrong.length) console.log('wrongly matched:\n  ' + wrong.join('\n  '));
    assert(recall >= 0.9, `recall ${recall}`);
    assert(falseRate <= 0.05, `false matches ${falseRate}`);
  },
);

Deno.test('a role keeps its job word and loses only its level', () => {
  assertEquals(coreWords('Senior Engineering Manager'), [
    'engineering',
    'manager',
  ]);
  assertEquals(coreWords('Sr. SQA Engineer'), ['qa', 'engineer']);
  assertEquals(coreWords('Head of Engineering'), ['engineering', 'head']);
  assertEquals(coreWords('Software Engineer, Frontend'), [
    'frontend',
    'software',
    'engineer',
  ]);
  assertEquals(coreWords('Lead Frontend Developer'), ['frontend', 'engineer']);
  assertEquals(coreWords('Tech Lead'), ['tech', 'lead']);
  assertEquals(parseRole('Senior Developer')?.words, ['engineer']);
  assertEquals(parseRole('Frontend-leaning Full-stack')?.words, [
    'frontend',
    'fullstack',
    'engineer',
  ]);
  assertEquals(parseRole('Senior')?.words, undefined);
});

Deno.test('grades: the same words, another name, a close job', () => {
  const g = (role: string, title: string, support = '') =>
    bestRoleFit([role], title, support)?.grade ?? null;
  assertEquals(g('QA Engineer', 'Senior QA Engineer'), 'exact');
  assertEquals(g('SQA Engineer', 'Quality Assurance Engineer'), 'exact');
  assertEquals(g('QA Engineer', 'SDET'), 'variant');
  assertEquals(g('QA Engineer', 'QA Lead'), 'partial');
  assertEquals(g('Angular Developer', 'Software Engineer'), null);
  assertEquals(
    g('Angular Developer', 'Software Engineer', 'We build in Angular and RxJS'),
    'described',
  );
  // an earlier target role wins a tie; a better grade wins over order
  assertEquals(
    bestRoleFit(['Product Manager', 'Product Owner'], 'Product Owner')?.index,
    1,
  );
});

Deno.test(
  'search terms: a family by its short name, anything else by its words',
  () => {
    assertEquals(searchTerm('SQA Engineer'), 'qa');
    assertEquals(searchTerm('Senior Frontend Engineer'), 'frontend');
    assertEquals(searchTerm('Senior Angular Developer'), 'angular');
    assertEquals(searchTerm('Product Manager'), 'product manager');
    assertEquals(searchTerm('Senior Developer'), 'software engineer');
    assertEquals(searchTerm('Supply Chain Analyst'), 'supply chain analyst');
    assertEquals(
      buildQueries([
        {
          target_roles: ['SQA Engineer', 'Head of Engineering'],
          stacks: ['Selenium'],
        },
      ]),
      ['head of engineering', 'qa', 'selenium'],
    );
  },
);

// The reported case: an SQA engineer's profile against ordinary QA postings.
const sqa: MatchProfile = {
  target_roles: ['SQA Engineer'],
  stacks: ['Selenium', 'Postman', 'Jira'],
  languages: ['english'],
  employment_types: ['full_time', 'contract'],
  remote_rules: {},
  exclusions: {},
  home_country: 'BD',
  allowed_countries: [],
  remote_only: true,
  min_seniority: 'mid',
};
const posting = (o: Partial<MatchPosting>): MatchPosting => ({
  title: 'QA Engineer',
  company: 'Acme',
  description: 'Manual and automated testing with Selenium and Postman.',
  tags: [],
  location: 'Remote',
  remote_policy: 'worldwide',
  hiring_countries: [],
  hiring_regions: [],
  source_country: null,
  employment_type: 'full_time',
  seniority: '',
  posted_at: null,
  expires_at: null,
  ...o,
});

Deno.test(
  'an SQA engineer is matched to QA postings and they are filed',
  () => {
    for (const title of [
      'QA Engineer',
      'Quality Assurance Engineer',
      'Test Automation Engineer',
      'SDET',
      'Software Tester',
    ]) {
      const p = posting({ title });
      assertEquals(matchPosting(sqa, p).kind, 'match', title);
      const s = heuristicScore(sqa, p, DEFAULT_WEIGHTS);
      assert(s.score >= 30, `${title} scored ${s.score}`);
      assert(s.breakdown.title_match > 0);
      assertEquals(s.breakdown.backend_heavy, undefined);
    }
    assertEquals(
      matchPosting(sqa, posting({ title: 'Quality Assurance Nurse' })).kind,
      'irrelevant',
    );
  },
);

Deno.test('the seniority floor decides what "junior or mid" excludes', () => {
  const mid = posting({ title: 'Mid-Level QA Engineer' });
  assertEquals(matchPosting(sqa, mid).kind, 'match');
  assertEquals(matchPosting({ ...sqa, min_seniority: 'senior' }, mid), {
    kind: 'excluded',
    reason: 'Junior or mid-level role',
  });
  assertEquals(matchPosting(sqa, posting({ title: 'Junior QA Engineer' })), {
    kind: 'excluded',
    reason: 'Junior role',
  });
});

Deno.test('company careers keep any title some user is looking for', () => {
  assert(!wanted('Registered Nurse', ['angular']));
  assert(wanted('Registered Nurse', ['angular'], ['Nurse']));
  assert(wanted('Senior Product Manager', ['angular'], ['Product Manager']));
  assert(!wanted('Head of People', ['angular'], ['Product Manager']));
});

Deno.test(
  'Hacker News keeps a post whose header names a role some user wants',
  async () => {
    const { parseHnComment } = await import('./sources/feeds.ts');
    const c = {
      id: 1,
      text: 'Carewell | Registered Nurse | Remote (US) | Full-time<p>Telehealth team.',
      created_at: '2026-11-10T00:00:00Z',
    };
    assertEquals(parseHnComment(c), null);
    assertEquals(parseHnComment(c, ['Nurse'])?.title, 'Registered Nurse');
  },
);

Deno.test(
  'other titles: from the family when it is known, cleaned when a model answers',
  async () => {
    const { familyTitles, cleanTitles, variantsPrompt } =
      await import('./role.ts');
    const qa = familyTitles('SQA Engineer');
    assert(qa.known && qa.source === 'family');
    assert(
      qa.titles.includes('Test Automation Engineer') &&
        qa.titles.includes('Software Tester'),
    );
    assert(!qa.titles.some((t) => /^(s)?qa engineer$/i.test(t)));
    assertEquals(familyTitles('Supply Chain Analyst').known, false);
    assert(familyTitles('Senior').warning.includes('no job word'));
    assert(familyTitles('Manager').warning.includes('very broad'));
    assertEquals(
      cleanTitles('Supply Chain Analyst', [
        'Logistics Analyst',
        'Senior Supply Chain Analyst',
        'Analyst',
        'logistics analyst',
        42,
        'Procurement Analyst',
        '<script>',
      ]),
      ['Logistics Analyst', 'Procurement Analyst'],
    );
    assert(
      variantsPrompt('Medical Coder', ['ICD-10']).includes(
        '"Medical Coder" (skills: ICD-10)',
      ),
    );
  },
);
