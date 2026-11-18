import { inject } from '@angular/core';
import { CanActivateFn, CanDeactivateFn, Router } from '@angular/router';
import { Confirm } from '../ui/confirm';
import { Auth, isLocalPath } from './auth';

/** Signed-in users only; everyone else goes to /login with a return path. */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(Auth);
  const router = inject(Router);
  await auth.ready;
  if (auth.isSignedIn()) return true;
  return router.createUrlTree(['/login'], { queryParams: { next: state.url } });
};

/**
 * Pages that make no sense once signed in (login, sign-up). Someone who
 * comes back from LinkedIn's sign-in lands on /login already signed in, so
 * the page they were on their way to (?next=) is honoured here.
 */
export const guestGuard: CanActivateFn = async (route) => {
  const auth = inject(Auth);
  const router = inject(Router);
  await auth.ready;
  if (!auth.isSignedIn()) return true;
  const next = route.queryParamMap.get('next');
  return next && isLocalPath(next)
    ? router.parseUrl(next)
    : router.createUrlTree(['/']);
};

export const adminGuard: CanActivateFn = async () => {
  const auth = inject(Auth);
  const router = inject(Router);
  await auth.ready;
  return auth.isAdmin() ? true : router.createUrlTree(['/']);
};

/**
 * The public front page; signed-in people go straight to Today. A sign-in
 * that failed on the way back from LinkedIn can land here with the reason in
 * the address; it is passed to /login, which explains it.
 */
export const landingGuard: CanActivateFn = async (route) => {
  const auth = inject(Auth);
  const router = inject(Router);
  await auth.ready;
  if (auth.isSignedIn()) return router.createUrlTree(['/today']);
  const q = route.queryParamMap;
  if (q.has('error') || q.has('error_description'))
    return router.createUrlTree(['/login'], {
      queryParams: {
        error: q.get('error'),
        error_code: q.get('error_code'),
        error_description: q.get('error_description'),
      },
    });
  return true;
};

/** Asks before leaving a page that has unsaved edits (it exposes dirty()). */
export const unsavedChangesGuard: CanDeactivateFn<{ dirty: () => boolean }> = (
  page,
) =>
  !page.dirty() ||
  inject(Confirm).ask({
    title: 'Leave without saving?',
    body: 'Your changes are not saved yet. Leaving drops them.',
    action: 'Leave without saving',
    cancel: 'Keep editing',
    danger: true,
  });
