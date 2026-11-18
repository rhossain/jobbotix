import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
  UrlTree,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { Auth, isLocalPath } from './auth';
import { agreeGuard, authGuard, guestGuard, landingGuard } from './guards';
import { TERMS_VERSION, rememberAgreed } from './terms';

function run(
  guard: typeof guestGuard,
  signedIn: boolean,
  query: Record<string, string>,
  terms: { needs: boolean; accept?: () => Promise<void> } = { needs: false },
  url = '/jobs',
) {
  // several runs in one test: each starts from a clean module
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: Auth,
        useValue: {
          ready: Promise.resolve(),
          isSignedIn: () => signedIn,
          needsTerms: () => terms.needs,
          acceptTerms: async () => {
            await terms.accept?.();
            terms.needs = false;
          },
        },
      },
    ],
  });
  const route = {
    queryParamMap: convertToParamMap(query),
  } as ActivatedRouteSnapshot;
  return TestBed.runInInjectionContext(
    () =>
      guard(route, { url } as RouterStateSnapshot) as Promise<
        boolean | UrlTree
      >,
  );
}
const url = (result: boolean | UrlTree) =>
  result instanceof UrlTree
    ? TestBed.inject(Router).serializeUrl(result)
    : result;

describe('guestGuard', () => {
  it('lets a signed-out visitor see the page', async () => {
    expect(await run(guestGuard, false, { next: '/jobs' })).toBe(true);
  });

  it('sends someone back from LinkedIn on to where they were going', async () => {
    expect(url(await run(guestGuard, true, { next: '/jobs/new?url=x' }))).toBe(
      '/jobs/new?url=x',
    );
    expect(url(await run(guestGuard, true, {}))).toBe('/');
  });

  it('never follows an address outside the app', async () => {
    for (const next of ['https://evil.example', '//evil.example', '/\\evil'])
      expect(url(await run(guestGuard, true, { next }))).toBe('/');
  });
});

describe('landingGuard', () => {
  it('passes a failed sign-in on to the sign-in page, which explains it', async () => {
    const result = await run(landingGuard, false, {
      error: 'server_error',
      error_description: 'Database error saving new user',
    });
    expect(url(result)).toBe(
      '/login?error=server_error&error_description=Database%20error%20saving%20new%20user',
    );
  });

  it('otherwise shows the front page, or Today when signed in', async () => {
    expect(await run(landingGuard, false, {})).toBe(true);
    expect(url(await run(landingGuard, true, {}))).toBe('/today');
  });
});

describe('isLocalPath', () => {
  it('accepts a path in this app only', () => {
    expect(isLocalPath('/today')).toBe(true);
    expect(isLocalPath('today')).toBe(false);
    expect(isLocalPath('//host/x')).toBe(false);
    expect(isLocalPath('https://host/x')).toBe(false);
  });
});

describe('the Terms', () => {
  afterEach(() => sessionStorage.clear());

  it('asks an account with no record once, then sends it on', async () => {
    expect(
      url(await run(authGuard, true, {}, { needs: true }, '/jobs/1')),
    ).toBe('/agree?next=%2Fjobs%2F1');
    expect(await run(authGuard, true, {}, { needs: false })).toBe(true);
  });

  it('records a box ticked on Sign up in this tab, without asking again', async () => {
    rememberAgreed();
    const accept = vi.fn(async () => undefined);
    expect(await run(authGuard, true, {}, { needs: true, accept })).toBe(true);
    expect(accept).toHaveBeenCalledTimes(1);
    // used once
    expect(sessionStorage.getItem('jb-terms-agreed')).toBeNull();
  });

  it('ignores a box ticked for older Terms', async () => {
    sessionStorage.setItem('jb-terms-agreed', '2000-01-01');
    const accept = vi.fn(async () => undefined);
    expect(
      url(await run(authGuard, true, {}, { needs: true, accept })),
    ).toContain('/agree');
    expect(accept).not.toHaveBeenCalled();
    expect(TERMS_VERSION).not.toBe('2000-01-01');
  });

  it('shows the agree page only while it is needed', async () => {
    expect(await run(agreeGuard, true, {}, { needs: true })).toBe(true);
    expect(url(await run(agreeGuard, true, { next: '/jobs' }))).toBe('/jobs');
    expect(url(await run(agreeGuard, true, { next: '//evil' }))).toBe('/today');
    expect(url(await run(agreeGuard, false, {}))).toBe('/login');
  });
});
