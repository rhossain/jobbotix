import { DOCUMENT } from '@angular/common';
import { Injectable, Injector, effect, inject, untracked } from '@angular/core';
import { ActivatedRouteSnapshot, Router } from '@angular/router';
import { Auth, isLocalPath, type AuthStatus } from './auth';
import { agreeGuard, authGuard, guestGuard, landingGuard } from './guards';

/** Who a page is for. */
export type Audience = 'members' | 'guests' | 'anyone';

/**
 * Who the page at the end of this route tree is for, read from the guards
 * its routes carry. Read from the guards, not from a second list of
 * addresses, so a new page is covered the moment it is given its guard.
 */
export function audience(root: ActivatedRouteSnapshot): Audience {
  let leaf = root;
  while (leaf.firstChild) leaf = leaf.firstChild;
  for (let s: ActivatedRouteSnapshot | null = leaf; s; s = s.parent) {
    const guards: unknown[] = s.routeConfig?.canActivate ?? [];
    if (guards.includes(authGuard) || guards.includes(agreeGuard))
      return 'members';
    if (guards.includes(guestGuard) || guards.includes(landingGuard))
      return 'guests';
  }
  return 'anyone';
}

/**
 * Keeps the page and the session in step after the page has opened.
 *
 * A guard decides once, as a page opens. The session can change afterwards
 * without anyone touching this tab: another tab signs in or out, a stored
 * session is restored late, a token that could not be refreshed at start-up
 * is refreshed a moment later. Without this the page the guard chose stays
 * up: the sign-in form inside the signed-in app, or a private page left
 * showing after signing out elsewhere.
 *
 * So the same decision is made again whenever the session changes:
 *  - signed in on a page for guests (sign in, sign up, the front page):
 *    on to where they were going (?next=), or Today
 *  - signed out on a page for members: to Sign in, with the way back
 *  - a different account than the one this tab loaded data for: a full page
 *    load, so nothing of the first account stays in memory
 */
@Injectable({ providedIn: 'root' })
export class SessionPlacement {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly doc = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  /** The account this tab has been showing since it was loaded. */
  private owner: string | null = null;
  private started = false;

  start() {
    if (this.started) return;
    this.started = true;
    effect(
      () => {
        const status = this.auth.status();
        const userId = this.auth.user()?.id ?? null;
        // Wait out a navigation in flight (its guards decide with the session
        // as it is now) and look again when it ends, however it ends.
        const busy = this.router.currentNavigation() !== null;
        untracked(() => this.place(status, userId, busy));
      },
      { injector: this.injector },
    );
  }

  private place(status: AuthStatus, userId: string | null, busy: boolean) {
    if (status === 'loading') return;
    const root = this.router.routerState.snapshot.root;
    const who = audience(root);

    if (status === 'signed_in' && userId) {
      if (this.owner && this.owner !== userId) {
        this.load(who === 'guests' ? this.onward(root) : '/today');
        return;
      }
      this.owner = userId;
    }

    if (busy || !this.router.navigated) return;

    if (status === 'signed_in' && who === 'guests') {
      void this.router.navigateByUrl(this.onward(root), { replaceUrl: true });
    } else if (status === 'signed_out' && who === 'members') {
      void this.router.navigate(['/login'], {
        queryParams: { next: this.router.url },
        replaceUrl: true,
      });
    }
  }

  /** Where someone who has just become signed in was on their way to. */
  private onward(root: ActivatedRouteSnapshot): string {
    const next = root.queryParamMap.get('next');
    return next && isLocalPath(next) ? next : '/today';
  }

  /** A full page load: everything the pages had loaded is dropped. */
  protected load(url: string) {
    this.doc.defaultView?.location.replace(url);
  }
}
