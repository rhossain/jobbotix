import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { SwUpdate, type VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs';
import { Toast } from '../shared/toast';

const MESSAGE = 'A new version of Jobbotix is ready';

/**
 * Tells the person when a newer build has been downloaded and offers to load
 * it. One notice at a time: a second release while the first notice is still
 * showing replaces it. Reload switches this tab to the new build before the
 * page is loaded again, so the notice does not come back for the same release.
 */
@Injectable({ providedIn: 'root' })
export class AppUpdate {
  private readonly sw = inject(SwUpdate, { optional: true });
  private readonly toast = inject(Toast);
  private readonly doc = inject(DOCUMENT);
  private noticeId: number | null = null;
  private lastHash = '';

  start(): void {
    const sw = this.sw;
    if (!sw?.isEnabled) return;
    sw.versionUpdates
      .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
      .subscribe((e) => this.announce(e.latestVersion.hash));
  }

  private announce(hash: string): void {
    // The same release can be reported more than once (several tabs, a retry).
    if (hash === this.lastHash) return;
    this.lastHash = hash;
    if (this.noticeId !== null) this.toast.dismiss(this.noticeId);
    this.noticeId = this.toast.show(MESSAGE, {
      ms: 60 * 60 * 1000,
      action: { label: 'Reload', run: () => this.reload() },
    });
  }

  private async reload(): Promise<void> {
    try {
      await this.sw?.activateUpdate();
    } catch {
      // Loading the page again still picks the new build up.
    }
    this.doc.defaultView?.location.reload();
  }
}
