import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
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
