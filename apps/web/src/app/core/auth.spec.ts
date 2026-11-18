import { TestBed } from '@angular/core/testing';
import { Auth, accountGone } from './auth';
import { SUPABASE } from './supabase';

/** A Supabase stand-in: one signed-in session, and answers the test sets. */
function fakeSupabase(opts: {
  userError?: { status?: number; code?: string; message?: string } | null;
  profile?: Record<string, unknown> | null;
  token?: string;
  expiresAt?: number;
}) {
  const signOut = vi.fn(async () => ({ error: null }));
  const getUser = vi.fn(async (_jwt?: string) => ({
    error: opts.userError ?? null,
  }));
  const profileReads = { n: 0 };
  const client = {
    auth: {
      getSession: async () => ({
        data: {
          session: {
            access_token: opts.token ?? 'token-1',
            expires_at: opts.expiresAt ?? Math.floor(Date.now() / 1000) + 3600,
            user: { id: 'u1', email: 'a@b.c' },
          },
        },
      }),
      onAuthStateChange: () => ({ data: { subscription: {} } }),
      getUser,
      signOut,
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            profileReads.n++;
            return { data: opts.profile ?? null };
          },
        }),
      }),
    }),
  };
  return { client, signOut, getUser, profileReads };
}

async function authWith(opts: Parameters<typeof fakeSupabase>[0]) {
  const fake = fakeSupabase(opts);
  TestBed.configureTestingModule({
    providers: [{ provide: SUPABASE, useValue: fake.client }],
  });
  const auth = TestBed.inject(Auth);
  await auth.ready;
  return { auth, ...fake };
}

describe('accountGone', () => {
  it('is true when the auth server says the account is not there', () => {
    expect(accountGone({ status: 403, code: 'user_not_found' })).toBe(true);
    expect(accountGone({ status: 403, code: 'session_not_found' })).toBe(true);
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

  it('is false for a token that is merely expired or malformed', () => {
    expect(
      accountGone({
        status: 403,
        code: 'bad_jwt',
        message: 'token is expired',
      }),
    ).toBe(false);
    expect(accountGone({ status: 403 })).toBe(false);
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

  it('says suspended, not deleted, when the server reports a banned account', async () => {
    const { auth } = await authWith({
      userError: { status: 403, code: 'user_banned' },
    });
    expect(await auth.verify()).toBe('suspended');
    expect(auth.isSignedIn()).toBe(false);
  });

  it('reads the profile before asking the auth server, so a suspension is never taken for a deletion', async () => {
    const { auth, getUser } = await authWith({
      userError: { status: 403, code: 'session_not_found' },
      profile: { id: 'u1', suspended_at: '2026-11-17T05:14:00Z' },
    });
    expect(await auth.verify()).toBe('suspended');
    expect(getUser).not.toHaveBeenCalled();
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

  it('asks with the token in hand, so the auth lock is not held meanwhile', async () => {
    const { auth, getUser } = await authWith({ profile: { id: 'u1' } });
    await auth.verify();
    expect(getUser).toHaveBeenCalledWith('token-1');
  });

  it("leaves a token about to expire to the client's own refresh", async () => {
    const { auth, getUser } = await authWith({
      userError: { status: 403, code: 'bad_jwt', message: 'token is expired' },
      expiresAt: Math.floor(Date.now() / 1000) + 20,
    });
    expect(await auth.verify()).toBeNull();
    expect(getUser).not.toHaveBeenCalled();
    expect(auth.isSignedIn()).toBe(true);
  });
});

describe('Auth start-up', () => {
  it('reads the profile once when the same session arrives twice', async () => {
    const fake = fakeSupabase({ profile: { id: 'u1' } });
    let announce: (e: string, s: unknown) => void = () => undefined;
    fake.client.auth.onAuthStateChange = ((cb: typeof announce) => {
      announce = cb;
      return { data: { subscription: {} } };
    }) as never;
    TestBed.configureTestingModule({
      providers: [{ provide: SUPABASE, useValue: fake.client }],
    });
    const auth = TestBed.inject(Auth);
    const { data } = await fake.client.auth.getSession();
    announce('INITIAL_SESSION', data.session);
    await auth.ready;
    expect(auth.isSignedIn()).toBe(true);
    expect(fake.profileReads.n).toBe(1);
  });
});

describe('Auth when the session changes while the profile is being read', () => {
  /** A client whose profile read waits until the test lets it through. */
  function slowClient(getSession: () => Promise<unknown>) {
    let emit: (event: string, session: unknown) => void = () => undefined;
    const waiting: (() => void)[] = [];
    const client = {
      auth: {
        getSession,
        onAuthStateChange: (cb: typeof emit) => {
          emit = cb;
          return { data: { subscription: {} } };
        },
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              new Promise((resolve) =>
                waiting.push(() => resolve({ data: { id: 'u1' } })),
              ),
          }),
        }),
      }),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: SUPABASE, useValue: client }],
    });
    return {
      auth: TestBed.inject(Auth),
      emit: (event: string, session: unknown) => emit(event, session),
      release: () => waiting.splice(0).forEach((go) => go()),
    };
  }
  const session = {
    access_token: 'token-1',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: 'u1', email: 'a@b.c' },
  };
  const tick = () => new Promise((r) => setTimeout(r));

  it('stays signed out when signing out overtakes a sign-in still loading', async () => {
    const { auth, emit, release } = slowClient(async () => ({
      data: { session: null },
    }));
    await auth.ready;
    emit('SIGNED_IN', session);
    await tick();
    emit('SIGNED_OUT', null);
    await tick();
    release();
    await tick();
    expect(auth.status()).toBe('signed_out');
    expect(auth.session()).toBeNull();
    expect(auth.profile()).toBeNull();
  });

  it('counts a failed read of the stored session as signed out, not loading for good', async () => {
    const { auth } = slowClient(() => Promise.reject(new Error('storage')));
    await auth.ready;
    expect(auth.status()).toBe('signed_out');
  });

  it('becomes signed in when the session turns up after a start as signed out', async () => {
    const { auth, emit, release } = slowClient(async () => ({
      data: { session: null },
      error: { message: 'Failed to fetch' },
    }));
    await auth.ready;
    expect(auth.status()).toBe('signed_out');
    emit('TOKEN_REFRESHED', session);
    await tick();
    release();
    await tick();
    expect(auth.status()).toBe('signed_in');
  });
});
