import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { Icon } from './icon';

/** Pull distance that triggers a refresh when released. */
const TRIGGER_PX = 72;
const MAX_PX = 112;

/**
 * Pull-to-refresh for a page on touch screens: drag down from the top of the
 * page and let go past the mark to run `action`. Place it once, at the top of
 * the page template. Mouse and keyboard users refresh by reloading as usual.
 */
@Component({
  selector: 'jb-pull-refresh',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'jb-pull-refresh',
    '[style.height.px]': 'height()',
    '[class.settling]': '!pulling()',
  },
  template: `
    @if (height() > 0) {
      <span
        class="badge"
        [class.ready]="ready()"
        [class.spinning]="busy()"
        [style.transform]="'rotate(' + rotation() + 'deg)'"
        aria-hidden="true"
      >
        <jb-icon [name]="busy() ? 'loader-circle' : 'arrow-down'" [size]="18" />
      </span>
    }
    <span class="sr-only" role="status">{{ busy() ? 'Refreshing' : '' }}</span>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      pointer-events: none;
    }
    :host(.settling) {
      transition: height var(--dur-slow) var(--motion-ease);
    }
    .badge {
      display: grid;
      place-items: center;
      width: 2.25rem;
      height: 2.25rem;
      border: 1px solid var(--line);
      border-radius: 50%;
      background: var(--surface-raised);
      color: var(--ink-muted);
      box-shadow: var(--elev-raised);
      transition: color var(--dur-fast) var(--motion-ease);
    }
    .badge.ready,
    .badge.spinning {
      color: var(--brand);
    }
    .badge.spinning jb-icon {
      animation: jb-spin 0.8s linear infinite;
    }
  `,
})
export class PullRefresh {
  /** What a refresh does; the indicator spins until it settles. */
  readonly action = input.required<() => Promise<unknown>>();

  protected readonly pull = signal(0);
  protected readonly pulling = signal(false);
  protected readonly busy = signal(false);
  protected readonly ready = computed(() => this.pull() >= TRIGGER_PX);
  protected readonly height = computed(() =>
    this.busy() ? 56 : Math.round(this.pull() * 0.75),
  );
  protected readonly rotation = computed(() =>
    this.busy() ? 0 : this.ready() ? 180 : (this.pull() / TRIGGER_PX) * 180,
  );

  constructor() {
    const doc = inject(DOCUMENT);
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const win = doc.defaultView;
      if (!win || !('ontouchstart' in win)) return;
      let x0 = 0;
      let y0 = 0;
      let tracking = false;
      let locked = false;

      const start = (e: TouchEvent) => {
        if (this.busy() || win.scrollY > 0 || e.touches.length !== 1) return;
        if (doc.querySelector('dialog[open]')) return;
        x0 = e.touches[0].clientX;
        y0 = e.touches[0].clientY;
        tracking = true;
        locked = false;
      };
      const move = (e: TouchEvent) => {
        if (!tracking) return;
        const dx = e.touches[0].clientX - x0;
        const dy = e.touches[0].clientY - y0;
        if (!locked) {
          // Decide once: a mostly-sideways move is a swipe, not a pull.
          if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
          if (Math.abs(dx) > Math.abs(dy)) {
            tracking = false;
            return;
          }
          locked = true;
        }
        if (dy <= 0 || win.scrollY > 0) {
          if (this.pulling()) this.reset();
          tracking = dy > -4;
          return;
        }
        this.pulling.set(true);
        // Ease off as it stretches, like a rubber band.
        this.pull.set(Math.min(MAX_PX, dy * 0.55));
        if (e.cancelable) e.preventDefault();
      };
      const end = async () => {
        if (!tracking) return;
        tracking = false;
        const go = this.ready();
        this.reset();
        if (!go) return;
        this.busy.set(true);
        try {
          // Keep the spinner up long enough to read as feedback.
          await Promise.all([
            this.action()(),
            new Promise((r) => setTimeout(r, 450)),
          ]);
        } finally {
          this.busy.set(false);
        }
      };

      doc.addEventListener('touchstart', start, { passive: true });
      doc.addEventListener('touchmove', move, { passive: false });
      doc.addEventListener('touchend', end);
      doc.addEventListener('touchcancel', end);
      destroyRef.onDestroy(() => {
        doc.removeEventListener('touchstart', start);
        doc.removeEventListener('touchmove', move);
        doc.removeEventListener('touchend', end);
        doc.removeEventListener('touchcancel', end);
      });
    });
  }

  private reset() {
    this.pulling.set(false);
    this.pull.set(0);
  }
}
