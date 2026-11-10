import { deepStrictEqual as assertEquals, ok as assert } from 'node:assert';
import { isUuid, listFilters, refusal, type Target } from './admin.ts';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const user: Target = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'Pat@Example.com',
  is_admin: false,
};

Deno.test('listFilters: keeps what it knows and drops the rest', () => {
  assertEquals(listFilters({}), {
    q: '',
    plan: null,
    route: null,
    limit: 50,
    offset: 0,
  });
  assertEquals(
    listFilters({
      q: '  pat ',
      plan: 'pro',
      route: 'credits',
      limit: 5000,
      offset: -3,
    }),
    { q: 'pat', plan: 'pro', route: 'credits', limit: 500, offset: 0 },
  );
  assertEquals(
    listFilters({ plan: 'gold', route: ['own'], limit: '10' }).plan,
    null,
  );
  assertEquals(listFilters({ route: 'drop table' }).route, null);
  assertEquals(listFilters({ q: 'x'.repeat(500) }).q.length, 100);
});

Deno.test('isUuid', () => {
  assert(isUuid(ADMIN));
  assert(!isUuid('1 or 1=1'));
  assert(!isUuid(undefined));
});

Deno.test(
  'refusal: an admin does not suspend or delete themselves or another admin',
  () => {
    const self = { ...user, id: ADMIN, is_admin: true };
    assert(
      refusal('suspend', ADMIN, self, { reason: 'test' }).includes('your own'),
    );
    assert(refusal('delete', ADMIN, self, {}).includes('from Settings'));
    const other = { ...user, is_admin: true };
    assert(
      refusal('suspend', ADMIN, other, { reason: 'abuse' }).includes(
        'is an admin',
      ),
    );
    assert(
      refusal('delete', ADMIN, other, { confirmEmail: other.email }).includes(
        'is an admin',
      ),
    );
    // looking, and sending a login link, are fine
    assertEquals(refusal('get', ADMIN, other, {}), '');
    assertEquals(refusal('login_link', ADMIN, self, {}), '');
  },
);

Deno.test('refusal: a suspension needs a reason', () => {
  assert(refusal('suspend', ADMIN, user, {}).includes('reason'));
  assert(refusal('suspend', ADMIN, user, { reason: ' x ' }).includes('reason'));
  assert(
    refusal('suspend', ADMIN, user, { reason: 'x'.repeat(501) }).includes(
      '500',
    ),
  );
  assertEquals(
    refusal('suspend', ADMIN, user, { reason: 'Scripted sign-ups' }),
    '',
  );
  assertEquals(refusal('unsuspend', ADMIN, user, {}), '');
});

Deno.test('refusal: a deletion needs the email typed, in any case', () => {
  assert(refusal('delete', ADMIN, user, {}).includes('email'));
  assert(
    refusal('delete', ADMIN, user, {
      confirmEmail: 'pat@example.org',
    }).includes('email'),
  );
  assertEquals(
    refusal('delete', ADMIN, user, { confirmEmail: ' pat@example.com ' }),
    '',
  );
});
