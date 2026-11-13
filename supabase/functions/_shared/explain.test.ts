import { deepStrictEqual as assertEquals, ok as assert } from 'node:assert';
import {
  createExplain,
  type ExplainPosting,
  profileWarnings,
  reasonGroup,
} from './explain.ts';
import type { MatchProfile } from './match.ts';
import { DEFAULT_WEIGHTS } from './score.ts';

const profile: MatchProfile = {
  target_roles: ['SQA Engineer'],
  stacks: ['Selenium'],
  languages: ['english'],
  employment_types: ['full_time'],
  remote_rules: {},
  exclusions: {},
  home_country: 'BD',
  allowed_countries: [],
  remote_only: true,
  min_seniority: 'mid',
};
const post = (o: Partial<ExplainPosting>): ExplainPosting => ({
  title: 'QA Engineer',
  company: 'Acme',
  description: 'Selenium and Postman.',
  tags: [],
  location: 'Remote',
  remote_policy: 'worldwide',
  hiring_countries: [],
  hiring_regions: [],
  source_country: null,
  employment_type: 'full_time',
  seniority: '',
  posted_at: '2026-11-10T00:00:00Z',
  expires_at: null,
  sources: ['remoteok'],
  ...o,
});

Deno.test(
  'the funnel counts every posting once, at the step that stopped it',
  () => {
    const e = createExplain(profile, DEFAULT_WEIGHTS, {
      days: 14,
      threshold: 30,
      now: new Date('2026-11-12T00:00:00Z'),
    });
    e.add([
      post({}),
      post({ title: 'SDET', sources: ['himalayas', 'remoteok'] }),
      post({ title: 'Frontend Engineer' }),
      post({ title: 'QA Engineer', posted_at: '2026-08-01T00:00:00Z' }),
      post({ title: 'Junior QA Engineer' }),
      post({
        title: 'QA Engineer',
        remote_policy: 'region_locked',
        hiring_countries: ['DE'],
      }),
      post({
        title: 'QA Engineer',
        remote_policy: 'region_locked',
        hiring_countries: ['US'],
      }),
      post({ title: 'QA Engineer', employment_type: 'contract' }),
      post({
        title: 'QA Lead',
        remote_policy: 'unknown',
        location: 'Berlin',
        description: '',
      }),
    ]);
    const r = e.result();
    assertEquals(r.pool, 9);
    assertEquals(r.not_relevant, 1);
    assertEquals(r.too_old, 1);
    assertEquals(r.excluded, [
      { reason: 'Open to other countries only', count: 2 },
      { reason: 'Junior role', count: 1 },
      { reason: 'Contract type not wanted', count: 1 },
    ]);
    assertEquals(r.would_file, 2);
    assertEquals(r.low_score, 1);
    assertEquals(r.by_grade, {
      exact: 1,
      variant: 1,
      partial: 1,
      described: 0,
      stack: 0,
    });
    assertEquals(
      r.pool,
      r.not_relevant +
        r.too_old +
        r.needs_country +
        4 +
        r.would_file +
        r.low_score,
    );
    assertEquals(r.by_source[0], { source: 'remoteok', pool: 9, matched: 3 });
    assertEquals(r.search_terms, ['qa']);
    assert(r.top[0].score >= r.top[1].score);
    assertEquals(r.low[0].title, 'QA Lead');
  },
);

Deno.test('warnings name what limits a profile', () => {
  const w = profileWarnings({
    ...profile,
    target_roles: ['Senior', 'Manager'],
    stacks: [],
    home_country: null,
  });
  assertEquals(w.length, 4);
  assert(w[0].includes('no job word'));
  assert(w[1].includes('very broad'));
  assertEquals(profileWarnings(profile), []);
  assertEquals(reasonGroup('Requires German'), 'Requires another language');
  assertEquals(
    reasonGroup('Limited to Germany, Poland'),
    'Open to other countries only',
  );
});

Deno.test(
  'ruled-out title matches come with the place and the posting own location line',
  () => {
    const e = createExplain(profile, DEFAULT_WEIGHTS, {
      days: 14,
      threshold: 30,
      now: new Date('2026-11-12T00:00:00Z'),
    });
    e.add([
      post({
        title: 'QA Engineer',
        remote_policy: 'region_locked',
        hiring_countries: ['US'],
        location: 'Remote (US only)',
      }),
      post({
        title: 'SDET',
        remote_policy: 'region_locked',
        hiring_countries: ['US'],
        location: 'USA',
      }),
      post({
        title: 'QA Engineer',
        remote_policy: 'region_locked',
        hiring_countries: ['DE'],
        location: 'Germany',
      }),
    ]);
    const r = e.result();
    assertEquals(r.limited_to, [
      { place: 'United States', count: 2 },
      { place: 'Germany', count: 1 },
    ]);
    assertEquals(r.ruled_out.length, 3);
    assertEquals(r.ruled_out[0], {
      title: 'QA Engineer',
      company: 'Acme',
      reason: 'Limited to United States',
      where: 'Remote (US only) · remote, named places only',
      source: 'remoteok',
    });
  },
);
