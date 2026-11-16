import { DOCUMENT } from '@angular/common';
import { Injectable, effect, inject, untracked } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { filter } from 'rxjs';
import { Auth } from './auth';
import { injectSupabase } from './supabase';

/** No more than one check in this many milliseconds. */
const GAP = 15_000;
/** While the tab stays open and visible, check this often. */
const EVERY = 60_000;

/**
 * Signs a browser out soon after its account is deleted or suspended
 * elsewhere (by the admin, or by the user on another device). It asks the
 * server on each page change, when the tab comes back into view and once a
 * minute, never more than once in 15 seconds. The server also sends a
 * message on the account's own Realtime channel when an admin deletes or
 * suspends it, and that triggers the check at once.
 *
 * It leaves with a full page load, so nothing the pages had already loaded
 * stays in memory, and tells the sign-in page why.
 */
@Injectable({ providedIn: 'root' })
export class SessionWatch {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly doc = inject(DOCUMENT);
  private readonly supabase = injectSupabase();
  private last = 0;
  private channel: RealtimeChannel | null = null;

  constructor() {
    // Listen on the signed-in account's channel; none in demo mode, which
    // has no session.
    effect(() => {
      const id = this.auth.session()?.user.id ?? null;
      untracked(() => this.listen(id));
    });
  }

  private listen(userId: string | null) {
    if (this.channel) {
      void this.supabase.removeChannel(this.channel);
      this.channel = null;
    }
    if (!userId) return;
    this.channel = this.supabase
      .channel(`account:${userId}`)
      .on('broadcast', { event: 'ended' }, () => this.check(true))
      .subscribe();
  }

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

  /** `now`: the server said this account ended, so skip the usual pacing. */
  private check(now = false) {
    if (!this.auth.isSignedIn()) return;
    const at = Date.now();
    if (!now && (this.doc.hidden || at - this.last < GAP)) return;
    this.last = at;
    void this.auth.verify().then((why) => {
      if (why) this.doc.defaultView?.location.assign(`/login?ended=${why}`);
    });
  }
}
