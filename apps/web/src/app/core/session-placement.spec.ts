import { Component, computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Auth, type AuthStatus } from './auth';
import { agreeGuard, authGuard, guestGuard, landingGuard } from './guards';
import { SessionPlacement } from './session-placement';

@Component({ template: '' })
class Page {}

/** The real guards on stand-in pages, one of each kind the app has. */
const routes = [
  {
    path: '',
    pathMatch: 'full' as const,
    canActivate: [landingGuard],
    component: Page,
  },
  { path: 'login', canActivate: [guestGuard], component: Page },
  { path: 'signup', canActivate: [guestGuard], component: Page },
  { path: 'today', canActivate: [authGuard], component: Page },
  { path: 'jobs/:id', canActivate: [authGuard], component: Page },
  { path: 'agree', canActivate: [agreeGuard], component: Page },
  { path: 'privacy', component: Page },
  { path: 'reset-password', component: Page },
];

/** Lets effects run and navigations finish. */
async function settle() {
  for (let i = 0; i < 5; i++) {
    TestBed.tick();
    await new Promise((r) => setTimeout(r));
  }
}

async function open(url: string, start: AuthStatus, userId = 'u1') {
  const status = signal<AuthStatus>(start);
  const user = signal(start === 'signed_in' ? { id: userId } : null);
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes),
      {
        provide: Auth,
        useValue: {
          ready: Promise.resolve(),
          status,
          user,
          isSignedIn: computed(() => status() === 'signed_in'),
          needsTerms: () => false,
        },
      },
    ],
  });
  const router = TestBed.inject(Router);
  const placement = TestBed.inject(SessionPlacement);
  const load = vi
    .spyOn(placement as unknown as { load: (url: string) => void }, 'load')
    .mockImplementation(() => undefined);
  placement.start();
  await router.navigateByUrl(url);
  await settle();
  return {
    router,
    load,
    async signIn(id = 'u1') {
      user.set({ id });
      status.set('signed_in');
      await settle();
    },
    async signOut() {
      user.set(null);
      status.set('signed_out');
      await settle();
    },
  };
}

describe('SessionPlacement', () => {
  it('moves on from Sign in when the session arrives without the form being used', async () => {
    // What happened on 18 Nov 2026: a job link opened signed out, then the
    // session turned up, and the sign-in form sat inside the signed-in app.
    const tab = await open('/login?next=%2Fjobs%2F547b1984', 'signed_out');
    expect(tab.router.url).toBe('/login?next=%2Fjobs%2F547b1984');
    await tab.signIn();
    expect(tab.router.url).toBe('/jobs/547b1984');
  });

  it('goes to Today when there was nowhere in particular to go', async () => {
    for (const from of ['/login', '/signup', '/']) {
      TestBed.resetTestingModule();
      const tab = await open(from, 'signed_out');
      await tab.signIn();
      expect(tab.router.url).toBe('/today');
    }
  });

  it('never follows an address outside the app', async () => {
    for (const next of ['https://evil.example', '//evil.example', '/\\evil']) {
      TestBed.resetTestingModule();
      const tab = await open(
        `/login?next=${encodeURIComponent(next)}`,
        'signed_out',
      );
      await tab.signIn();
      expect(tab.router.url).toBe('/today');
    }
  });

  it('sends a private page to Sign in when the session ends elsewhere, with the way back', async () => {
    const tab = await open('/jobs/42', 'signed_in');
    expect(tab.router.url).toBe('/jobs/42');
    await tab.signOut();
    expect(tab.router.url).toBe('/login?next=%2Fjobs%2F42');
    // and back again when the session returns
    await tab.signIn();
    expect(tab.router.url).toBe('/jobs/42');
  });

  it('covers the Terms page, which is for signed-in people too', async () => {
    const tab = await open('/privacy', 'signed_in');
    // reached directly; the guard itself would send an agreed account on
    await tab.router.navigateByUrl('/agree');
    await tab.signOut();
    expect(tab.router.url).toMatch(/^\/login/);
  });

  it('leaves pages for anyone where they are', async () => {
    for (const page of ['/privacy', '/reset-password']) {
      TestBed.resetTestingModule();
      const tab = await open(page, 'signed_out');
      await tab.signIn();
      expect(tab.router.url).toBe(page);
      await tab.signOut();
      expect(tab.router.url).toBe(page);
    }
  });

  it('loads the page afresh when a different account takes over the tab', async () => {
    const tab = await open('/jobs/42', 'signed_in', 'u1');
    await tab.signOut();
    expect(tab.load).not.toHaveBeenCalled();
    await tab.signIn('u2');
    // to the way back that Sign in was holding, with nothing of u1 in memory
    expect(tab.load).toHaveBeenCalledWith('/jobs/42');
  });

  it('loads Today afresh when the account changes under an open page', async () => {
    const tab = await open('/jobs/42', 'signed_in', 'u1');
    await tab.signIn('u2');
    expect(tab.load).toHaveBeenCalledWith('/today');
  });

  it('does not reload when the same account signs in again', async () => {
    const tab = await open('/today', 'signed_in', 'u1');
    await tab.signOut();
    await tab.signIn('u1');
    expect(tab.load).not.toHaveBeenCalled();
    expect(tab.router.url).toBe('/today');
  });

  it('gives way to a navigation already under way', async () => {
    // Signing out with the button: the app itself is on its way somewhere
    // (Sign in, or the front page from the Terms page), and that is where
    // it ends up, not at Sign in with a way back.
    const tab = await open('/today', 'signed_in');
    const leaving = tab.signOut();
    const going = tab.router.navigateByUrl('/privacy');
    await Promise.all([leaving, going]);
    await settle();
    expect(tab.router.url).toBe('/privacy');
  });
});
