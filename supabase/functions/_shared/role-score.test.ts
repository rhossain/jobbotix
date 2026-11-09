import { deepStrictEqual as assertEquals } from 'node:assert';
import type { MatchProfile } from './match.ts';
import { applyVerdict, guessRemote, rolePosting } from './role-score.ts';
import { DEFAULT_WEIGHTS, heuristicScore } from './score.ts';

const profile: MatchProfile = {
  target_roles: ['Senior Angular Engineer', 'Senior Frontend Engineer'],
  stacks: ['Angular', 'TypeScript', 'React'],
  languages: ['english'],
  employment_types: ['full_time', 'contract'],
  remote_rules: {},
  exclusions: {},
  home_country: 'BD',
  allowed_countries: [],
  remote_only: true,
};

Deno.test('guessRemote reads worldwide hiring, not worldwide customers', () => {
  assertEquals(guessRemote('Remote, worldwide', '').remote_policy, 'worldwide');
  assertEquals(
    guessRemote('Remote', 'We hire from anywhere in the world.').remote_policy,
    'worldwide',
  );
  assertEquals(
    guessRemote('Remote', 'Our product is used by teams worldwide.')
      .remote_policy,
    'unknown',
  );
});

Deno.test('guessRemote turns a qualifier into countries or regions', () => {
  const us = guessRemote('Remote (US only)', '');
  assertEquals(us.remote_policy, 'region_locked');
  assertEquals(us.hiring_countries, ['US']);
  assertEquals(guessRemote('Hybrid, Berlin', '').remote_policy, 'hybrid');
  assertEquals(guessRemote('London', '').remote_policy, 'onsite');
  assertEquals(guessRemote('', '').remote_policy, 'unknown');
  assertEquals(
    guessRemote('', 'This is a fully remote position.').remote_policy,
    'unknown',
  );
});

Deno.test('a known remote policy is used as given', () => {
  const p = rolePosting({
    company: 'Acme',
    title: 'Senior Angular Engineer',
    location: 'Remote (US only)',
    type: 'full_time',
    posting_text: '',
    stack: [],
    remote: {
      remote_policy: 'worldwide',
      hiring_countries: [],
      hiring_regions: [],
    },
  });
  assertEquals(p.remote_policy, 'worldwide');
});

const text =
  'We are hiring a Senior Angular Engineer with 6+ years of experience. Angular, TypeScript, RxJS. You will use Cursor and Claude Code daily.';

Deno.test('a worldwide Angular role keeps its score and reasons', () => {
  const post = rolePosting({
    company: 'Quill',
    title: 'Senior Angular Engineer',
    location: 'Remote, worldwide',
    type: 'full_time',
    posting_text: text,
    stack: ['Angular'],
  });
  const scored = heuristicScore(profile, post, DEFAULT_WEIGHTS);
  const out = applyVerdict(profile, post, scored);
  assertEquals(out, scored);
  assertEquals(out.score >= 70, true);
});

Deno.test(
  'a role limited elsewhere loses the remote bonus and says why',
  () => {
    const post = rolePosting({
      company: 'Northwind',
      title: 'Senior Angular Engineer',
      location: 'Remote (US only)',
      type: 'full_time',
      posting_text: text,
      stack: ['Angular'],
    });
    const scored = heuristicScore(profile, post, DEFAULT_WEIGHTS);
    const out = applyVerdict(profile, post, scored);
    assertEquals(out.gaps[0].startsWith('Limited to'), true);
    assertEquals(out.score < scored.score, true);
    assertEquals(
      out.reasons.some((r) => /^remote/i.test(r)),
      false,
    );
  },
);

Deno.test('a role outside the target roles is flagged, not dropped', () => {
  const post = rolePosting({
    company: 'Data Co',
    title: 'Data Engineer',
    location: 'Remote, worldwide',
    type: 'full_time',
    posting_text: 'Python, Spark and Airflow. Remote, hiring worldwide.',
    stack: [],
  });
  const scored = heuristicScore(profile, post, DEFAULT_WEIGHTS);
  const out = applyVerdict(profile, post, scored);
  assertEquals(out.gaps[0], 'Not one of your target roles or stacks');
  assertEquals(out.score, scored.score);
});

Deno.test(
  'long model reasons are shortened at a word, not mid-word',
  async () => {
    const { clip } = await import('./score.ts');
    const long =
      'Requires primarily European business hours overlap, which is a timezone restriction and the remote worldwide framing is partly undermined by it';
    const out = clip(long, 100);
    assertEquals(out.length <= 100, true);
    assertEquals(out.endsWith('…'), true);
    assertEquals(/\s\S+…$/.test(out) && !/undermi…$/.test(out), true);
    assertEquals(clip('short', 100), 'short');
  },
);
