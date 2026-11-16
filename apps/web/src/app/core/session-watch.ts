import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { Auth } from './auth';

/** No more than one check in this many milliseconds. */
const GAP = 15_000;
/** While the tab stays open and visible, check this often. */
const EVERY = 60_000;

/**
 * Signs a browser out soon after its account is deleted or suspended
 * elsewhere (by the admin, or by the user on another device). It asks the
 * server on each page change, when the tab comes back into view and once a
 * minute, never more than once in 15 seconds.
 *
 * It leaves with a full page load, so nothing the pages had already loaded
 * stays in memory, and tells the sign-in page why.
 */
@Injectable({ providedIn: 'root' })
export class SessionWatch {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly doc = inject(DOCUMENT);
  private last = 0;

  start() {
    const win = this.doc.defaultView;
    if (!win) return;
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => this.check());
    this.doc.addEventListener('visibilitychange', () => this.check());
    win.setInterval(() => this.check(), EVERY);
    void this.auth.ready.then(() => this.check());
  }

  private check() {
    if (this.doc.hidden || !this.auth.isSignedIn()) return;
    const now = Date.now();
    if (now - this.last < GAP) return;
    this.last = now;
    void this.auth.verify().then((why) => {
      if (why) this.doc.defaultView?.location.assign(`/login?ended=${why}`);
    });
  }
}
