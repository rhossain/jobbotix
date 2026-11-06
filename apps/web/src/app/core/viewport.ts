import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal, type Signal } from '@angular/core';

/**
 * Screen-size breakpoints as signals, matching the CSS ones (md 768px,
 * xl 1280px). Used to render only what the current screen shows, instead of
 * rendering both layouts and hiding one with CSS.
 */
@Injectable({ providedIn: 'root' })
export class Viewport {
  /** Under 768px: phone layout (top bar, tab bar, cards). */
  readonly phone: Signal<boolean>;
  /** 1280px and up: room for the full sidebar. */
  readonly wide: Signal<boolean>;

  constructor() {
    const win = inject(DOCUMENT).defaultView;
    this.phone = this.watch(win, '(max-width: 767.98px)', false);
    this.wide = this.watch(win, '(min-width: 1280px)', true);
  }

  private watch(win: Window | null, query: string, fallback: boolean) {
    const mq = win?.matchMedia?.(query);
    const s = signal(mq ? mq.matches : fallback);
    // Lives as long as the app; no cleanup needed for a root service.
    mq?.addEventListener('change', (e) => s.set(e.matches));
    return s.asReadonly();
  }
}
