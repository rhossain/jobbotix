import type { ResumeSections } from '@jobbotix/shared-types';
import type {
  AiUsageRow,
  Json,
  RoleEventRow,
  RoleRow,
  ScreeningAnswerRow,
  SearchProfileRow,
  SourceCatalogRow,
  CompanyRow,
} from '@jobbotix/shared-types';

/**
 * Fictional roles for demo mode. Companies and postings are invented; the
 * shapes match what the daily search run posts to the ingest API.
 */
export const DEMO_USER_ID = '00000000-0000-4000-8000-00000000demo';

const daysAgo = (n: number, h = 6) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(h, 45, 0, 0);
  return d.toISOString();
};
const dateAgo = (n: number) => daysAgo(n).slice(0, 10);

type Seed = Omit<
  RoleRow,
  | 'user_id'
  | 'created_at'
  | 'updated_at'
  | 'posting_text'
  | 'posting_hash'
  | 'score_breakdown'
  | 'remote_scope'
>;

const seed: Seed[] = [
  {
    id: 'r-northwind',
    company: 'Northwind Analytics',
    title: 'Senior Frontend Engineer (Angular)',
    url: 'https://example.com/northwind/senior-frontend-angular',
    source: 'Remotive',
    location: 'Remote, worldwide',
    type: 'full_time',
    salary: '$95k–130k',
    posted_at: dateAgo(2),
    found_at: daysAgo(0),
    stack: ['Angular 19', 'TypeScript', 'RxJS', 'NgRx', 'SCSS', 'Cypress'],
    score: 88,
    ai_match: true,
    status: 'new',
    reasons: [
      'Angular named as the primary framework, with NgRx and SCSS',
      'Remote worldwide, async-first team',
      'Posting asks for daily use of AI coding assistants',
      '5+ years required; well within range',
    ],
    gaps: [
      'Mentions GraphQL subscriptions; have one example ready',
      'Pay band is location-adjusted',
    ],
    cover_letter:
      'Hi Northwind team,\n\nI am applying for the Senior Frontend Engineer (Angular) role. Angular with NgRx and hand-written SCSS is most of my last decade, and your note about AI coding assistants describes how I already work.\n\n(Demo letter: in a real run this is written for the specific posting.)\n\nMd. Sazzad Hossain\nrshossain.me',
    notes: '',
    status_changed_at: daysAgo(0),
    follow_up_days: 0,
    posting_id: null,
    source_id: null,
    remote_policy: 'unknown',
    hiring_countries: [],
    company_research: {},
    prep: {},
  },
  {
    id: 'r-harbor',
    company: 'Harbor Health',
    title: 'Frontend Engineer, Patient Portal',
    url: 'https://example.com/harbor/frontend-engineer',
    source: 'Arc.dev',
    location: 'Remote, EU overlap 4h',
    type: 'full_time',
    salary: '',
    posted_at: dateAgo(1),
    found_at: daysAgo(0),
    stack: [
      'Angular',
      'Angular Material',
      'TypeScript',
      'Jest',
      'Accessibility (WCAG 2.2)',
    ],
    score: 81,
    ai_match: false,
    status: 'new',
    reasons: [
      'Angular Material and accessibility focus match your theme work',
      'Timezone overlap requirement is compatible with Dhaka',
    ],
    gaps: [
      'Healthcare domain; no prior experience to cite',
      'No AI tooling mention',
    ],
    cover_letter: '',
    notes: '',
    status_changed_at: daysAgo(0),
    follow_up_days: 0,
    posting_id: null,
    source_id: null,
    remote_policy: 'unknown',
    hiring_countries: [],
    company_research: {},
    prep: {},
  },
  {
    id: 'r-lumen',
    company: 'Lumen Commerce',
    title: 'Senior Frontend Developer (React/Next.js)',
    url: 'https://example.com/lumen/senior-frontend',
    source: 'We Work Remotely',
    location: 'Remote, worldwide',
    type: 'full_time',
    salary: '$80k–110k',
    posted_at: dateAgo(3),
    found_at: daysAgo(1),
    stack: [
      'React',
      'Next.js',
      'TypeScript',
      'Tailwind',
      'Cursor',
      'Claude Code',
    ],
    score: 74,
    ai_match: true,
    status: 'shortlist',
    reasons: [
      'E-commerce storefront work maps to your NopCommerce background',
      'Cursor and Claude Code named in the posting',
      'Worldwide remote',
    ],
    gaps: [
      'React rather than Angular; lead with TypeScript and component architecture',
    ],
    cover_letter: '',
    notes:
      'Applied via their form on Monday? No, still pending. Need to tailor the React angle.',
    status_changed_at: daysAgo(5),
    follow_up_days: 0,
    posting_id: null,
    source_id: null,
    remote_policy: 'unknown',
    hiring_countries: [],
    company_research: {},
    prep: {},
  },
  {
    id: 'r-kestrel',
    company: 'Kestrel Systems',
    title: 'Angular Developer (6-month contract)',
    url: 'https://example.com/kestrel/angular-contract',
    source: 'Remote Rocketship',
    location: 'Remote, worldwide',
    type: 'contract',
    salary: '$55/h',
    posted_at: dateAgo(4),
    found_at: daysAgo(2),
    stack: ['Angular 17', 'TypeScript', 'Syncfusion', 'REST'],
    score: 72,
    ai_match: false,
    status: 'applied',
    reasons: [
      'Pure Angular contract with Syncfusion, which you have used',
      'Hourly rate stated up front',
    ],
    gaps: ['Six months, no extension mentioned'],
    cover_letter: '',
    notes: 'Applied 3 days ago. Recruiter: Dana. Follow up next week.',
    status_changed_at: daysAgo(3),
    follow_up_days: 0,
    posting_id: null,
    source_id: null,
    remote_policy: 'unknown',
    hiring_countries: [],
    company_research: {},
    prep: {},
  },
  {
    id: 'r-meridian',
    company: 'Meridian Learning',
    title: 'Lead UI Engineer',
    url: 'https://example.com/meridian/lead-ui',
    source: 'Himalayas',
    location: 'Remote, Asia-Pacific',
    type: 'full_time',
    salary: '',
    posted_at: dateAgo(9),
    found_at: daysAgo(6),
    stack: ['Angular', 'Design systems', 'Storybook', 'SCSS', 'Figma'],
    score: 79,
    ai_match: false,
    status: 'interview',
    reasons: [
      'Design-system ownership is your Styloviz work',
      'APAC remote suits your timezone',
    ],
    gaps: ['Lead role: expect people-management questions'],
    cover_letter: '',
    notes:
      'First interview Thursday 15:00 Dhaka with the Head of Product. Prepare the design-token story.',
    status_changed_at: daysAgo(2),
    follow_up_days: 0,
    posting_id: null,
    source_id: null,
    remote_policy: 'unknown',
    hiring_countries: [],
    company_research: {},
    prep: {},
  },
  {
    id: 'r-brightline',
    company: 'Brightline Logistics',
    title: 'Frontend Engineer (Vue)',
    url: 'https://example.com/brightline/frontend-vue',
    source: 'Remotive',
    location: 'Remote, US only',
    type: 'full_time',
    salary: '$120k',
    posted_at: dateAgo(6),
    found_at: daysAgo(4),
    stack: ['Vue 3', 'Pinia', 'TypeScript'],
    score: 41,
    ai_match: false,
    status: 'skipped',
    reasons: ['Senior frontend role'],
    gaps: ['US-only despite the remote label', 'Vue, not Angular'],
    cover_letter: '',
    notes: '',
    status_changed_at: daysAgo(4),
    follow_up_days: 0,
    posting_id: null,
    source_id: null,
    remote_policy: 'unknown',
    hiring_countries: [],
    company_research: {},
    prep: {},
  },
  {
    id: 'r-saltmarsh',
    company: 'Saltmarsh Studio',
    title: 'WordPress + Angular Theme Developer',
    url: 'https://example.com/saltmarsh/theme-developer',
    source: 'Arc.dev',
    location: 'Remote, worldwide',
    type: 'contract',
    salary: '',
    posted_at: dateAgo(12),
    found_at: daysAgo(10),
    stack: ['WordPress', 'Angular', 'SCSS', 'REST API'],
    score: 68,
    ai_match: false,
    status: 'rejected',
    reasons: [
      'WordPress theming plus Angular is an unusual combination you have',
    ],
    gaps: ['Agency work; rates likely low'],
    cover_letter: '',
    notes: 'Rejected: they went with someone in their timezone.',
    status_changed_at: daysAgo(1),
    follow_up_days: 0,
    posting_id: null,
    source_id: null,
    remote_policy: 'unknown',
    hiring_countries: [],
    company_research: {},
    prep: {},
  },
  {
    id: 'r-quill',
    company: 'Quill & Co',
    title: 'Senior Angular Engineer, AI Products',
    url: 'https://example.com/quill/senior-angular-ai',
    source: 'Company site',
    location: 'Remote, worldwide',
    type: 'full_time',
    salary: '$100k–140k',
    posted_at: dateAgo(1),
    found_at: daysAgo(0),
    stack: ['Angular', 'Signals', 'TypeScript', 'Anthropic API', 'Tailwind'],
    score: 92,
    ai_match: true,
    status: 'new',
    reasons: [
      'Angular with signals, Tailwind and the Anthropic API: your exact recent stack',
      'Builds AI features for end users, your Iveraine concierge work applies',
      'Worldwide remote, transparent pay',
    ],
    gaps: ['Fast-moving startup; expect a take-home exercise'],
    cover_letter:
      'Hello Quill team,\n\nI am applying for the Senior Angular Engineer (AI Products) role.\n\n(Demo letter: in a real run this is written for the specific posting.)\n\nMd. Sazzad Hossain\nrshossain.me',
    notes: '',
    status_changed_at: daysAgo(0),
    follow_up_days: 0,
    posting_id: null,
    source_id: null,
    remote_policy: 'unknown',
    hiring_countries: [],
    company_research: {},
    prep: {},
  },
];

export function sampleRoles(): RoleRow[] {
  return seed.map((s) => ({
    ...s,
    user_id: DEMO_USER_ID,
    remote_scope: s.location,
    posting_text: '',
    posting_hash: '',
    score_breakdown: {},
    created_at: s.found_at,
    updated_at: s.status_changed_at,
  }));
}

export function sampleEvents(): RoleEventRow[] {
  const ev = (
    id: string,
    role_id: string | null,
    kind: RoleEventRow['kind'],
    payload: Json,
    at: string,
  ): RoleEventRow => ({
    id,
    user_id: DEMO_USER_ID,
    role_id,
    kind,
    payload,
    created_at: at,
  });
  return [
    ev(
      'e-run-0',
      null,
      'run',
      { at: daysAgo(0), searched: 47, added: 3, updated: 2, excluded: 21 },
      daysAgo(0),
    ),
    ev(
      'e-run-1',
      null,
      'run',
      { at: daysAgo(1), searched: 52, added: 1, updated: 4, excluded: 24 },
      daysAgo(1),
    ),
    ev(
      'e-1',
      'r-northwind',
      'ingested',
      { score: 88, source: 'Remotive' },
      daysAgo(0),
    ),
    ev(
      'e-2',
      'r-quill',
      'ingested',
      { score: 92, source: 'Company site' },
      daysAgo(0),
    ),
    ev(
      'e-3',
      'r-lumen',
      'status_change',
      { from: 'new', to: 'shortlist' },
      daysAgo(5),
    ),
    ev(
      'e-4',
      'r-lumen',
      'reminder',
      { reason: 'stale_shortlist', days: 5 },
      daysAgo(0, 1),
    ),
    ev(
      'e-5',
      'r-kestrel',
      'status_change',
      { from: 'shortlist', to: 'applied' },
      daysAgo(3),
    ),
    ev(
      'e-6',
      'r-meridian',
      'status_change',
      { from: 'applied', to: 'interview' },
      daysAgo(2),
    ),
    ev(
      'e-7',
      'r-saltmarsh',
      'status_change',
      { from: 'applied', to: 'rejected' },
      daysAgo(1),
    ),
  ];
}

export function sampleScreeningAnswers(): ScreeningAnswerRow[] {
  return [
    {
      id: 'q-1',
      user_id: DEMO_USER_ID,
      role_id: 'r-northwind',
      question: 'How often do you use AI coding assistants?',
      answer:
        'Daily, on essentially every task: Claude Code and Cursor for implementation, Copilot for completion. I review every diff and run the tests before anything merges.',
      position: 0,
      created_at: daysAgo(0),
    },
    {
      id: 'q-2',
      user_id: DEMO_USER_ID,
      role_id: 'r-northwind',
      question: 'Describe a performance problem you solved in Angular.',
      answer:
        'A news portal with thousands of articles: moved list rendering to OnPush with trackBy, cached feeds in IndexedDB behind a Service Worker, and lazy-loaded section routes. Time-to-interactive dropped from 6s to under 2s on 3G.',
      position: 1,
      created_at: daysAgo(0),
    },
  ];
}

export function sampleSearchProfile(): SearchProfileRow {
  return {
    id: 'sp-demo',
    user_id: DEMO_USER_ID,
    name: 'Default',
    target_roles: [
      'Senior Angular Engineer',
      'Senior Frontend Engineer',
      'Lead UI Engineer',
      'Frontend-leaning Full-stack',
    ],
    stacks: [
      'Angular',
      'TypeScript',
      'SCSS',
      'Tailwind',
      'Angular Material',
      'React',
      'Vue',
    ],
    remote_rules: {
      worldwide: true,
      timezone_overlap_ok: true,
      exclude_regions: ['US only', 'LATAM only', 'EU only'],
    },
    exclusions: {
      visa_required: true,
      non_english: true,
      hybrid_or_onsite: true,
      junior_or_mid: true,
      older_than_days: 45,
    },
    languages: ['english'],
    min_seniority: 'senior',
    scoring_weights: {},
    employment_types: ['full_time', 'contract'],
    digest_time: '06:45',
    digest_days: [1, 2, 3, 4, 5, 6, 7],
    digest_min_score: 0,
    digest_enabled: true,
    home_country: null,
    allowed_countries: [],
    remote_only: true,
    last_matched_at: null,
    alert_min_score: null,
    active: true,
    created_at: daysAgo(30),
    updated_at: daysAgo(3),
  };
}

export function sampleResume(): ResumeSections {
  return {
    contact: {
      name: 'Demo User',
      headline: 'Senior Frontend Engineer | AI-Augmented Development',
      email: 'demo@jobbotix.local',
      phone: '',
      location: 'Dhaka, Bangladesh (remote)',
      website: 'https://example.com',
      links: [
        { label: 'GitHub', url: 'https://github.com/example' },
        { label: 'LinkedIn', url: 'https://linkedin.com/in/example' },
      ],
    },
    summary:
      'Senior Frontend Engineer with 15+ years delivering production Angular applications, e-commerce storefronts and CMS themes. Specialises in Angular architecture, scalable SCSS design systems and pixel-accurate UI. Works AI-first: pairs with Claude, Copilot and Cursor daily to move from spec to shipped feature faster, while owning architecture, review and the quality bar.',
    skills: [
      {
        name: 'Frontend',
        items: [
          'Angular',
          'TypeScript',
          'RxJS',
          'Signals',
          'HTML5',
          'CSS3',
          'SCSS',
        ],
      },
      {
        name: 'UI systems',
        items: [
          'Angular Material',
          'Tailwind',
          'Bootstrap',
          'Design tokens',
          'Storybook',
        ],
      },
      {
        name: 'Platforms',
        items: [
          'NopCommerce theming',
          'WordPress theming',
          'REST APIs',
          'Supabase',
        ],
      },
      {
        name: 'Testing & tooling',
        items: ['Vitest', 'Jasmine', 'Cypress', 'Nx', 'Git', 'GitHub Actions'],
      },
    ],
    experience: [
      {
        company: 'Example Software Ltd.',
        title: 'Senior Frontend Engineer',
        location: 'Dhaka (remote)',
        start: '2018-01',
        end: '',
        bullets: [
          'Lead frontend delivery on client Angular products: component architecture, RxJS state, caching and performance for high-traffic portals.',
          'Built a production news portal with Service Worker and IndexedDB caching; time-to-interactive from 6s to under 2s on 3G.',
          'Delivered NopCommerce and WordPress themes from design handoff to production for e-commerce and content clients.',
          'Introduced AI-assisted workflows (Claude, Copilot, Cursor) into daily delivery and mentor the team on them.',
        ],
      },
      {
        company: 'Earlier Agency',
        title: 'Frontend Developer',
        location: 'Dhaka',
        start: '2011-06',
        end: '2017-12',
        bullets: [
          'Shipped responsive marketing sites and admin dashboards for 40+ clients in HTML5, SCSS and AngularJS.',
          'Owned the agency component library and coding standards.',
        ],
      },
    ],
    projects: [
      {
        name: 'Styloviz',
        url: 'https://styloviz.dev',
        description:
          'Angular + Tailwind UI component library with a full token-based brand system.',
        stack: ['Angular', 'Tailwind', 'Design tokens'],
      },
      {
        name: 'Jobbotix',
        url: 'https://jobbotix.com',
        description:
          'Finds, scores and drafts job applications every morning; you press send.',
        stack: ['Angular', 'Supabase', 'Anthropic API'],
      },
    ],
    aiToolkit: [
      'Claude Code',
      'Cursor',
      'GitHub Copilot',
      'Anthropic API',
      'spec-driven agent workflows (AI-DLC)',
      'MCP',
    ],
    education: [
      {
        institution: 'Example University',
        degree: 'B.Sc. in Computer Science',
        year: '2010',
      },
    ],
    certifications: [],
  };
}

/** The sources catalogue as the hosted project has it, with demo health. */
export function sampleSources(): SourceCatalogRow[] {
  const hoursAgo = (h: number) =>
    new Date(Date.now() - h * 3_600_000).toISOString();
  const row = (
    id: string,
    name: string,
    kind: SourceCatalogRow['kind'],
    access: SourceCatalogRow['access'],
    homepage: string,
    enabled: boolean,
    health: { fetched: number; fresh: number; error?: string } | null,
    attribution: string,
    country: string | null = null,
  ): SourceCatalogRow => ({
    id,
    name,
    kind,
    access,
    homepage,
    country,
    enabled,
    max_requests_per_run: 5,
    attribution,
    notes: '',
    last_run_at: health ? hoursAgo(3) : null,
    last_success_at: health && !health.error ? hoursAgo(3) : null,
    last_error: health?.error ?? null,
    last_fetched: health?.fetched ?? 0,
    last_new: health?.fresh ?? 0,
    created_at: hoursAgo(48),
    updated_at: hoursAgo(3),
  });
  return [
    row(
      'himalayas',
      'Himalayas',
      'board',
      'public_api',
      'https://himalayas.app',
      true,
      { fetched: 132, fresh: 18 },
      'Jobs from Himalayas (himalayas.app); apply on the original posting.',
    ),
    row(
      'jobicy',
      'Jobicy',
      'board',
      'public_api',
      'https://jobicy.com',
      true,
      { fetched: 41, fresh: 6 },
      'Jobs from Jobicy (jobicy.com).',
    ),
    row(
      'remoteok',
      'Remote OK',
      'board',
      'public_api',
      'https://remoteok.com',
      true,
      { fetched: 97, fresh: 12 },
      'Jobs from Remote OK (remoteok.com).',
    ),
    row(
      'remotive',
      'Remotive',
      'board',
      'public_api',
      'https://remotive.com',
      true,
      { fetched: 23, fresh: 2 },
      'Jobs from Remotive (remotive.com).',
    ),
    row(
      'weworkremotely',
      'We Work Remotely',
      'board',
      'rss',
      'https://weworkremotely.com',
      true,
      { fetched: 58, fresh: 7 },
      'Jobs from We Work Remotely (weworkremotely.com).',
    ),
    row(
      'workingnomads',
      'Working Nomads',
      'board',
      'public_api',
      'https://www.workingnomads.com',
      true,
      { fetched: 30, fresh: 4 },
      'Jobs from Working Nomads (workingnomads.com).',
    ),
    row(
      'arbeitnow',
      'Arbeitnow',
      'board',
      'public_api',
      'https://www.arbeitnow.com',
      true,
      {
        fetched: 0,
        fresh: 0,
        error: '429 from https://www.arbeitnow.com/api/job-board-api?page=1',
      },
      'Jobs from Arbeitnow (arbeitnow.com).',
    ),
    row(
      'hn',
      'Hacker News',
      'community',
      'public_api',
      'https://news.ycombinator.com',
      true,
      { fetched: 212, fresh: 9 },
      'From the Hacker News "Who is hiring?" thread.',
    ),
    row(
      'adzuna',
      'Adzuna',
      'aggregator',
      'keyed_api',
      'https://www.adzuna.com',
      false,
      null,
      'Jobs by Adzuna (adzuna.com).',
    ),
    row(
      'jooble',
      'Jooble',
      'aggregator',
      'keyed_api',
      'https://jooble.org',
      false,
      null,
      'Jobs from Jooble (jooble.org).',
    ),
    row(
      'reed',
      'Reed',
      'board',
      'keyed_api',
      'https://www.reed.co.uk',
      false,
      null,
      'Jobs from Reed (reed.co.uk).',
      'GB',
    ),
  ];
}

/** Two demo follows, with made-up poll results. */
export function sampleFollows(): {
  company: CompanyRow;
  followedAt: string;
}[] {
  const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  const company = (
    id: string,
    ats_kind: CompanyRow['ats_kind'],
    ats_slug: string,
    name: string,
    open_roles: number,
  ): CompanyRow => ({
    id,
    ats_kind,
    ats_slug,
    name,
    first_seen_at: ago(72),
    last_polled_at: ago(1),
    last_error: null,
    open_roles,
  });
  return [
    {
      company: company('demo-1', 'ashby', 'northwind', 'Northwind Labs', 14),
      followedAt: ago(30),
    },
    {
      company: company('demo-2', 'greenhouse', 'tidepool', 'Tidepool', 37),
      followedAt: ago(52),
    },
  ];
}

/**
 * A month of AI calls for the demo's Usage page: daily scoring on Haiku,
 * letters and prep on Sonnet, the odd company research with web searches.
 * Dates are relative to today so the page always has something to show.
 */
export function sampleUsage(now = Date.now()): AiUsageRow[] {
  const rows: AiUsageRow[] = [];
  const day = 86_400_000;
  let n = 0;
  const add = (
    daysAgo: number,
    job: AiUsageRow['job'],
    model: string,
    tokensIn: number,
    tokensOut: number,
    webSearches = 0,
  ) =>
    rows.push({
      id: `demo-usage-${++n}`,
      user_id: 'demo-user',
      job,
      model,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      cost_usd: 0,
      web_searches: webSearches,
      created_at: new Date(
        now - daysAgo * day - (n % 7) * 3_600_000,
      ).toISOString(),
    });
  for (let d = 0; d < 30; d++) {
    for (let i = 0; i < 3 + (d % 4); i++)
      add(d, 'score', 'claude-haiku-5-5', 2400 + i * 180, 140);
    if (d % 2 === 0) add(d, 'letter', 'claude-sonnet-5-5', 5200, 650);
    if (d % 3 === 0) add(d, 'answer', 'claude-sonnet-5-5', 4300, 900);
    if (d % 4 === 1) add(d, 'extract', 'claude-sonnet-5-5', 6100, 420);
    if (d % 6 === 2) add(d, 'research', 'claude-sonnet-5-5', 31_000, 1900, 4);
    if (d % 9 === 4) add(d, 'prep', 'claude-opus-5-5', 7400, 2600);
    if (d === 12) add(d, 'tailor', 'claude-sonnet-5-5', 9800, 2200);
    if (d >= 20 && d % 5 === 0)
      add(d, 'letter', 'claude-sonnet-4-5', 5100, 700);
  }
  return rows;
}
