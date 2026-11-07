import { deepStrictEqual as assertEquals, ok as assert } from 'node:assert';
import { matchPosting, type MatchPosting, type MatchProfile } from './match.ts';
import {
  DEFAULT_WEIGHTS,
  heuristicScore,
  parseScoreReply,
  resolveWeights,
  scorePrompt,
} from './score.ts';

const now = new Date('2026-11-06T12:00:00Z');

// Sazzad-shaped profile: senior Angular first, any senior frontend second.
const profile: MatchProfile = {
  target_roles: ['Senior Angular Developer', 'Senior Frontend Engineer'],
  stacks: ['Angular', 'TypeScript', 'HTML5/CSS3', 'SCSS'],
  languages: ['english'],
  employment_types: ['full_time', 'contract'],
  remote_rules: { worldwide: true, timezone_overlap_ok: true },
  exclusions: {},
  home_country: 'BD',
  allowed_countries: [],
  remote_only: true,
};

const base: MatchPosting = {
  title: 'Senior Angular Developer',
  company: 'Acme',
  description:
    'We build dashboards in Angular and TypeScript. 6+ years of experience. We use Cursor and Claude Code daily.',
  tags: ['Frontend Developer', 'Angular'],
  location: 'Remote, worldwide',
  remote_policy: 'worldwide',
  hiring_countries: [],
  hiring_regions: [],
  source_country: null,
  employment_type: 'full_time',
  seniority: 'Senior',
  posted_at: '2026-11-05T00:00:00Z',
  expires_at: null,
};
const post = (o: Partial<MatchPosting>): MatchPosting => ({ ...base, ...o });
const m = (o: Partial<MatchPosting>, p: Partial<MatchProfile> = {}) =>
  matchPosting({ ...profile, ...p }, post(o), now);

Deno.test(
  'relevance: target role words or a stack in the title or tags',
  () => {
    assertEquals(m({}).kind, 'match');
    assertEquals(
      m({ title: 'Sr. Front-End Engineer (React)', tags: [] }).kind,
      'match',
    );
    assertEquals(m({ title: 'UI Engineer', tags: ['Angular'] }).kind, 'match');
    assertEquals(
      m({ title: 'Senior Java Engineer', tags: ['Backend'] }).kind,
      'irrelevant',
    );
    // a stack named only in the description is not enough
    assertEquals(
      m({
        title: 'Product Designer',
        tags: [],
        description: 'Works with our Angular team',
      }).kind,
      'irrelevant',
    );
  },
);

Deno.test('age and expiry drop postings silently', () => {
  assertEquals(m({ posted_at: '2026-08-01T00:00:00Z' }).kind, 'irrelevant');
  assertEquals(
    m(
      { posted_at: '2026-10-20T00:00:00Z' },
      { exclusions: { older_than_days: 14 } },
    ).kind,
    'irrelevant',
  );
  assertEquals(m({ expires_at: '2026-11-01T00:00:00Z' }).kind, 'irrelevant');
});

Deno.test('level and contract type follow the profile switches', () => {
  assertEquals(m({ title: 'Junior Angular Developer' }), {
    kind: 'excluded',
    reason: 'Junior or mid-level role',
  });
  assertEquals(
    m(
      { title: 'Junior Angular Developer' },
      { exclusions: { junior_or_mid: false } },
    ).kind,
    'match',
  );
  assertEquals(
    m({ employment_type: 'contract' }, { employment_types: ['full_time'] }),
    {
      kind: 'excluded',
      reason: 'Contract role; profile wants full-time',
    },
  );
});

Deno.test(
  'region-locked roles pass only when they include where the user can work',
  () => {
    assertEquals(
      m({ remote_policy: 'region_locked', hiring_countries: ['DE', 'PL'] }),
      {
        kind: 'excluded',
        reason: 'Limited to Germany, Poland',
      },
    );
    assertEquals(
      m({ remote_policy: 'region_locked', hiring_countries: ['BD', 'IN'] })
        .kind,
      'match',
    );
    assertEquals(
      m({ remote_policy: 'region_locked', hiring_regions: ['apac'] }).kind,
      'match',
    );
    assertEquals(
      m({ remote_policy: 'region_locked', hiring_regions: ['emea'] }),
      {
        kind: 'excluded',
        reason: 'Limited to EMEA',
      },
    );
    assertEquals(
      m(
        { remote_policy: 'region_locked', hiring_regions: ['emea'] },
        { allowed_countries: ['AE'] },
      ).kind,
      'match',
    );
    const noCountry = m(
      { remote_policy: 'region_locked', hiring_countries: ['US'] },
      { home_country: null },
    );
    assertEquals(noCountry, { kind: 'needs_country' });
  },
);

Deno.test(
  'hybrid and on-site roles are out unless the profile allows them locally',
  () => {
    assertEquals(m({ remote_policy: 'hybrid', hiring_countries: ['BD'] }), {
      kind: 'excluded',
      reason: 'Hybrid role',
    });
    assertEquals(
      m(
        { remote_policy: 'onsite', hiring_countries: ['BD'] },
        { remote_only: false, exclusions: { hybrid_or_onsite: false } },
      ).kind,
      'match',
    );
  },
);

Deno.test(
  'language and work-authorisation requirements are read from the text',
  () => {
    assertEquals(m({ description: 'You speak fluent German and English.' }), {
      kind: 'excluded',
      reason: 'Requires German',
    });
    assertEquals(
      m({ description: 'German (C1) is required.' }).kind,
      'excluded',
    );
    assertEquals(
      m({ description: 'Fluent German' }, { languages: ['english', 'german'] })
        .kind,
      'match',
    );
    assertEquals(
      m({ description: 'Nice to have: some German.' }).kind,
      'match',
    );
    assertEquals(
      m({
        remote_policy: 'unknown',
        description: 'You must be authorized to work in the United States.',
      }),
      { kind: 'excluded', reason: 'Requires local work authorisation' },
    );
    assertEquals(
      m(
        {
          remote_policy: 'unknown',
          description: 'You must be authorized to work in the United States.',
        },
        { allowed_countries: ['US'] },
      ).kind,
      'match',
    );
    // boilerplate on a worldwide role does not exclude it
    assertEquals(
      m({ description: 'Angular. No visa sponsorship.' }).kind,
      'match',
    );
  },
);

Deno.test('heuristic score applies the weights the profile sets', () => {
  const s = heuristicScore(profile, base, DEFAULT_WEIGHTS);
  assertEquals(s.breakdown, {
    framework_primary: 30,
    remote_worldwide: 25,
    ai_assisted: 20,
    senior: 10,
  });
  assertEquals(s.score, 85);
  assertEquals(s.aiMatch, true);
  assert(s.stack.includes('Angular') && s.stack.includes('TypeScript'));

  const react = heuristicScore(
    profile,
    post({
      title: 'Senior Frontend Engineer',
      tags: ['React'],
      description: 'React and Next.js.',
      remote_policy: 'unknown',
      location: 'Berlin',
    }),
    DEFAULT_WEIGHTS,
  );
  assertEquals(react.breakdown, {
    framework_other: 15,
    remote_unclear: -10,
    senior: 10,
  });
  assertEquals(react.score, 15);
  assert(react.gaps.some((g) => g.startsWith('Angular not mentioned')));

  const backend = heuristicScore(
    profile,
    post({
      title: 'Senior Backend Engineer (Angular)',
      description:
        'Java, Spring, Kafka, Kubernetes, microservices. A 2-month contract.',
    }),
    resolveWeights({ backend_heavy: -20 }),
  );
  assertEquals(backend.breakdown.backend_heavy, -20);
  assertEquals(backend.breakdown.short_project, -15);
});

Deno.test('model scoring prompt and reply parsing', () => {
  const prompt = scorePrompt(profile, DEFAULT_WEIGHTS, base, 85);
  assert(prompt.includes('Angular as the main framework +30'));
  assert(prompt.includes('A keyword pass scored it 85.'));
  assertEquals(
    parseScoreReply(
      'Sure: {"score": 91.6, "aiMatch": true, "reasons": ["a","b"], "gaps": ["c"]}',
    ),
    { score: 92, aiMatch: true, reasons: ['a', 'b'], gaps: ['c'] },
  );
  assertEquals(parseScoreReply('{"score": "high"}'), null);
  assertEquals(parseScoreReply('no json'), null);
});

Deno.test('secondary stacks count in the title, not in the tags', () => {
  // Remote OK / WWR tag lots of non-frontend jobs "typescript"
  assertEquals(
    m({
      title: 'Software Engineer Interviewer',
      tags: ['TypeScript', 'Python'],
    }).kind,
    'irrelevant',
  );
  assertEquals(
    m({ title: 'Senior TypeScript Engineer', tags: [] }).kind,
    'match',
  );
  assertEquals(
    m(
      { title: 'Software Engineer', tags: ['React'] },
      { stacks: ['Angular', 'React'] },
    ).kind,
    'match',
  );
});
