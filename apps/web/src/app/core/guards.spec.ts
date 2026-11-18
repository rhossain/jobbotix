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
import { guestGuard, landingGuard } from './guards';

function run(
  guard: typeof guestGuard,
  signedIn: boolean,
  query: Record<string, string>,
) {
  // several runs in one test: each starts from a clean module
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: Auth,
        useValue: { ready: Promise.resolve(), isSignedIn: () => signedIn },
      },
    ],
  });
  const route = {
    queryParamMap: convertToParamMap(query),
  } as ActivatedRouteSnapshot;
  return TestBed.runInInjectionContext(
    () => guard(route, {} as RouterStateSnapshot) as Promise<boolean | UrlTree>,
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
