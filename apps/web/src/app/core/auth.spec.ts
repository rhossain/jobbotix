import { TestBed } from '@angular/core/testing';
import { Auth, accountGone } from './auth';
import { SUPABASE } from './supabase';

/** A Supabase stand-in: one signed-in session, and answers the test sets. */
function fakeSupabase(opts: {
  userError?: { status?: number; code?: string; message?: string } | null;
  profile?: Record<string, unknown> | null;
}) {
  const signOut = vi.fn(async () => ({ error: null }));
  const client = {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: 'u1', email: 'a@b.c' } } },
      }),
      onAuthStateChange: () => ({ data: { subscription: {} } }),
      getUser: async () => ({ error: opts.userError ?? null }),
      signOut,
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: opts.profile ?? null }),
        }),
      }),
    }),
  };
  return { client, signOut };
}

async function authWith(opts: Parameters<typeof fakeSupabase>[0]) {
  const fake = fakeSupabase(opts);
  TestBed.configureTestingModule({
    providers: [{ provide: SUPABASE, useValue: fake.client }],
  });
  const auth = TestBed.inject(Auth);
  await auth.ready;
  return { auth, signOut: fake.signOut };
}

describe('accountGone', () => {
  it('is true when the auth server says the account is not there', () => {
    expect(accountGone({ status: 403, code: 'user_not_found' })).toBe(true);
    expect(accountGone({ status: 404 })).toBe(true);
    expect(
      accountGone({ message: 'User from sub claim in JWT does not exist' }),
    ).toBe(true);
  });

  it('is false for being offline or a server hiccup', () => {
    expect(accountGone({ message: 'Failed to fetch' })).toBe(false);
    expect(accountGone({ status: 0, message: 'NetworkError' })).toBe(false);
    expect(accountGone({ status: 500, message: 'unexpected' })).toBe(false);
    expect(accountGone({ status: 429, message: 'rate limit' })).toBe(false);
  });
});

describe('Auth.verify', () => {
  it('leaves a healthy session alone', async () => {
    const { auth, signOut } = await authWith({ profile: { id: 'u1' } });
    expect(await auth.verify()).toBeNull();
    expect(auth.isSignedIn()).toBe(true);
    expect(signOut).not.toHaveBeenCalled();
  });

  it('signs this browser out when the account was deleted', async () => {
    const { auth, signOut } = await authWith({
      userError: { status: 403, code: 'user_not_found' },
    });
    expect(auth.isSignedIn()).toBe(true);
    expect(await auth.verify()).toBe('removed');
    expect(auth.isSignedIn()).toBe(false);
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('signs this browser out when the account was suspended', async () => {
    const { auth } = await authWith({
      profile: { id: 'u1', suspended_at: '2026-11-16T12:00:00Z' },
    });
    expect(await auth.verify()).toBe('suspended');
    expect(auth.isSignedIn()).toBe(false);
  });

  it('keeps the session when the check cannot reach the server', async () => {
    const { auth, signOut } = await authWith({
      userError: { message: 'Failed to fetch' },
      profile: { id: 'u1' },
    });
    expect(await auth.verify()).toBeNull();
    expect(auth.isSignedIn()).toBe(true);
    expect(signOut).not.toHaveBeenCalled();
  });
});
