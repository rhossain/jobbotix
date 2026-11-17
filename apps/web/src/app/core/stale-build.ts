import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { Toast } from '../shared/toast';

/**
 * A lazily loaded part of the app could not be fetched. Each page is its own
 * file with the build's hash in its name; after a release those names are
 * gone from the server, so a tab opened before the release (or a crawler
 * rendering a copy of it) asks for a file that no longer exists. The wording
 * is each browser's own: Chrome, Firefox, Safari, then older bundlers.
 */
export function isStaleBuildError(error: unknown): boolean {
  const e = (error as { rejection?: unknown })?.rejection ?? error;
  const message =
    e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading chunk [\w-]+ failed/i.test(
    message,
  );
}

/** Marks the last automatic reload, so a build that is really broken is not reloaded in a loop. */
const KEY = 'jb-stale-reload';
/** One automatic reload in this long; a second failure inside it is a real error. */
const WINDOW_MS = 2 * 60_000;
/** How long to wait for the service worker to switch to the new build. */
const SW_WAIT_MS = 5000;

/**
 * Gets a tab that runs a replaced build onto the current one: switches the
 * service worker to the new build, then loads the page the person was going
 * to. Without it they saw a click do nothing and the error landed in Admin.
 */
@Injectable({ providedIn: 'root' })
export class StaleBuild {
  private readonly sw = inject(SwUpdate, { optional: true });
  private readonly doc = inject(DOCUMENT);
  private readonly toast = inject(Toast);
  private recovering = false;
  private toldAt = 0;

  /**
   * Call with a stale-build error (and the page being opened, when known).
   * True when it is being dealt with and is not worth reporting: a reload
   * is on its way, or the device is simply offline. False when a reload was
   * already tried and the file is still missing.
   */
  recover(url?: string): boolean {
    const win = this.doc.defaultView;
    if (!win) return false;
    if (this.recovering) return true;
    if (win.navigator.onLine === false) {
      this.tell(
        "Couldn't load this page: you are offline. Try again when you are connected.",
      );
      return true;
    }
    if (!this.mayReload(win)) {
      this.tell(
        'Could not load this page. Reload the page, or try again in a minute.',
      );
      return false;
    }
    this.recovering = true;
    void this.reload(win, url);
    return true;
  }

  /** One failed click reaches here twice (the router, then the error handler): say it once. */
  private tell(message: string): void {
    if (Date.now() - this.toldAt < 3000) return;
    this.toldAt = Date.now();
    this.toast.show(message, { tone: 'error' });
  }

  /** Notes the reload; false when one was made moments ago or cannot be noted. */
  private mayReload(win: Window): boolean {
    try {
      const last = Number(win.sessionStorage.getItem(KEY)) || 0;
      if (Date.now() - last < WINDOW_MS) return false;
      win.sessionStorage.setItem(KEY, String(Date.now()));
      return true;
    } catch {
      // Nowhere to remember it: reloading could loop.
      return false;
    }
  }

  private async reload(win: Window, url?: string): Promise<void> {
    // Under a service worker, loading the page again serves the same old
    // build unless the worker is moved to the new one first.
    const sw = this.sw;
    if (sw?.isEnabled) {
      try {
        await Promise.race([
          sw
            .checkForUpdate()
            .then((found) => (found ? sw.activateUpdate() : false)),
          new Promise((done) => setTimeout(done, SW_WAIT_MS)),
        ]);
      } catch {
        // Loading the page again is still the best there is.
      }
    }
    if (url) win.location.assign(url);
    else win.location.reload();
  }
}
