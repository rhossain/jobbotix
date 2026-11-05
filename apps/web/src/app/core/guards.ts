import { inject } from '@angular/core';
import { CanActivateFn, CanDeactivateFn, Router } from '@angular/router';
import { Confirm } from '../ui/confirm';
import { Auth } from './auth';

/** Signed-in users only; everyone else goes to /login with a return path. */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(Auth);
  const router = inject(Router);
  await auth.ready;
  if (auth.isSignedIn()) return true;
  return router.createUrlTree(['/login'], { queryParams: { next: state.url } });
};

/** Pages that make no sense once signed in (login, sign-up). */
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(Auth);
  const router = inject(Router);
  await auth.ready;
  return auth.isSignedIn() ? router.createUrlTree(['/']) : true;
};

export const adminGuard: CanActivateFn = async () => {
  const auth = inject(Auth);
  const router = inject(Router);
  await auth.ready;
  return auth.isAdmin() ? true : router.createUrlTree(['/']);
};

/** The public front page; signed-in people go straight to Today. */
export const landingGuard: CanActivateFn = async () => {
  const auth = inject(Auth);
  const router = inject(Router);
  await auth.ready;
  return auth.isSignedIn() ? router.createUrlTree(['/today']) : true;
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
