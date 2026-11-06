import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Viewport } from '../core/viewport';
import { Button, Icon } from '../ui';
import { Tour } from './tour';

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Where the card sits: next to the highlight, or docked to an edge on phones. */
type Dock = 'float' | 'center' | 'top' | 'bottom';

const PAD = 8; // space between the element and the highlight's edge
const GAP = 14; // space between the highlight and the card
const EDGE = 16; // closest the card gets to the window edge

/**
 * Draws the intro tour: the page dims except for the highlighted element, and
 * a card explains it. A modal <dialog> keeps focus in the card and the page
 * inert underneath; Esc or Close ends the tour, ←/→ step through it.
 */
@Component({
  selector: 'jb-tour',
  imports: [Button, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- The modal dialog holds focus (on the card's title or buttons), so its
         ←/→ keys reach this handler; it is not itself a control. -->
    <!-- eslint-disable-next-line @angular-eslint/template/interactive-supports-focus -->
    <dialog
      #dialog
      class="tour"
      aria-labelledby="jb-tour-title"
      aria-describedby="jb-tour-body"
      (cancel)="$event.preventDefault(); tour.end()"
      (keydown)="onKey($event)"
    >
      <div
        class="spot"
        [class.is-empty]="!spot()"
        [style.top.px]="spot()?.top ?? vh() / 2"
        [style.left.px]="spot()?.left ?? vw() / 2"
        [style.width.px]="spot()?.width ?? 0"
        [style.height.px]="spot()?.height ?? 0"
        aria-hidden="true"
      ></div>

      <div
        #card
        class="card"
        [attr.data-dock]="dock()"
        [style.top.px]="dock() === 'float' ? pos().top : null"
        [style.left.px]="dock() === 'float' ? pos().left : null"
      >
        <div class="flex items-center justify-between gap-3">
          <span class="text-xs font-medium tracking-wide text-brand-ink">
            @if (tour.isFirst()) {
              Quick tour
            } @else {
              Step {{ tour.index() }} of {{ tour.steps.length - 1 }}
            }
          </span>
          <button
            type="button"
            jbButton="ghost"
            size="sm"
            iconOnly
            aria-label="Close tour"
            (click)="tour.end()"
          >
            <jb-icon name="x" />
          </button>
        </div>

        <h2
          #title
          id="jb-tour-title"
          tabindex="-1"
          class="mt-1 text-lg font-semibold tracking-tight text-ink outline-none"
        >
          {{ tour.step().title }}
        </h2>
        <p
          id="jb-tour-body"
          class="mt-2 text-sm leading-relaxed text-ink-muted"
          [class.is-waiting]="!tour.ready()"
        >
          {{ tour.body() }}
        </p>

        <div class="mt-5 flex items-center justify-between gap-3">
          <ol class="dots" aria-hidden="true">
            @for (s of tour.steps; track $index) {
              <li [class.is-on]="$index === tour.index()"></li>
            }
          </ol>
          <div class="flex shrink-0 gap-2">
            @if (tour.isFirst()) {
              <button type="button" jbButton="ghost" (click)="tour.end()">
                Skip
              </button>
            } @else {
              <button type="button" jbButton (click)="tour.back()">Back</button>
            }
            <button type="button" jbButton="primary" (click)="tour.next()">
              @if (tour.isFirst()) {
                Show me around
              } @else if (tour.isLast()) {
                Done
              } @else {
                Next <jb-icon name="chevron-right" />
              }
            </button>
          </div>
        </div>
      </div>
    </dialog>
  `,
  styles: `
    .tour {
      position: fixed;
      inset: 0;
      width: 100%;
      height: 100%;
      max-width: none;
      max-height: none;
      margin: 0;
      padding: 0;
      border: 0;
      background: transparent;
      overflow: hidden;
      color: var(--ink);
    }
    .tour::backdrop {
      background: transparent;
    }

    /* The dimmed page is the highlight's shadow, so one box does both. */
    .spot {
      position: fixed;
      border-radius: var(--r-card);
      box-shadow:
        0 0 0 2px var(--brand),
        0 0 0 200vmax var(--surface-overlay);
      pointer-events: none;
      transition:
        top var(--dur-base) var(--motion-ease),
        left var(--dur-base) var(--motion-ease),
        width var(--dur-base) var(--motion-ease),
        height var(--dur-base) var(--motion-ease);
    }
    .spot.is-empty {
      box-shadow: 0 0 0 200vmax var(--surface-overlay);
    }

    .card {
      position: fixed;
      width: min(24rem, calc(100vw - 2rem));
      padding: 1rem 1.25rem 1.25rem;
      background: var(--surface-raised);
      border: 1px solid var(--line);
      border-radius: var(--r-card);
      box-shadow: var(--elev-overlay);
      transition:
        top var(--dur-slow) var(--motion-ease),
        left var(--dur-slow) var(--motion-ease),
        opacity var(--dur-base) var(--motion-ease),
        translate var(--dur-base) var(--motion-ease);
    }
    @starting-style {
      .card {
        opacity: 0;
        translate: 0 8px;
      }
    }
    .card[data-dock='center'] {
      top: 50%;
      left: 50%;
      translate: -50% -50%;
    }
    @starting-style {
      .card[data-dock='center'] {
        translate: -50% calc(-50% + 8px);
      }
    }
    .card[data-dock='top'],
    .card[data-dock='bottom'] {
      left: 0.75rem;
      right: 0.75rem;
      width: auto;
    }
    .card[data-dock='top'] {
      top: calc(0.75rem + env(safe-area-inset-top));
    }
    .card[data-dock='bottom'] {
      bottom: calc(0.75rem + env(safe-area-inset-bottom));
    }

    .is-waiting {
      opacity: 0.6;
    }

    .dots {
      display: flex;
      gap: 0.3rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .dots li {
      width: 0.375rem;
      height: 0.375rem;
      border-radius: 999px;
      background: var(--line-strong, var(--line));
      transition:
        width var(--dur-base) var(--motion-ease),
        background-color var(--dur-base) var(--motion-ease);
    }
    .dots li.is-on {
      width: 1.1rem;
      background: var(--brand);
    }
  `,
})
export class TourOverlay {
  protected readonly tour = inject(Tour);
  private readonly viewport = inject(Viewport);
  private readonly doc = inject(DOCUMENT);

  private readonly dialog =
    viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly card = viewChild.required<ElementRef<HTMLElement>>('card');
  private readonly title = viewChild.required<ElementRef<HTMLElement>>('title');

  protected readonly spot = signal<Box | null>(null);
  protected readonly dock = signal<Dock>('center');
  protected readonly pos = signal({ top: 0, left: 0 });
  protected readonly vw = signal(0);
  protected readonly vh = signal(0);

  private returnFocus: HTMLElement | null = null;
  private frame = 0;

  constructor() {
    // Open and close the dialog with the tour, and follow the page while open.
    effect((onCleanup) => {
      const active = this.tour.active();
      const d = this.dialog().nativeElement;
      untracked(() => {
        if (active && !d.open) {
          this.returnFocus = this.doc.activeElement as HTMLElement | null;
          d.showModal?.();
          this.follow();
        } else if (!active && d.open) {
          d.close();
          this.returnFocus?.focus?.({ preventScroll: true });
        }
      });
      onCleanup(() => cancelAnimationFrame(this.frame));
    });

    // Each new step: put focus on its title so screen readers read it.
    afterRenderEffect(() => {
      this.tour.index();
      if (this.tour.active())
        this.title().nativeElement.focus({ preventScroll: true });
    });
  }

  protected onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      this.tour.next();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      this.tour.back();
    }
  }

  /** Re-measures every frame while open: the page may scroll, load or resize. */
  private follow() {
    const tick = () => {
      if (!this.tour.active()) return;
      this.layout();
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private layout() {
    const win = this.doc.defaultView;
    if (!win) return;
    const vw = win.innerWidth;
    const vh = win.innerHeight;
    if (vw !== this.vw()) this.vw.set(vw);
    if (vh !== this.vh()) this.vh.set(vh);

    const el = this.tour.ready() ? this.tour.target() : null;
    let spot = el
      ? highlight(el.getBoundingClientRect(), vw, vh, this.viewport.phone())
      : null;
    const card = this.card().nativeElement;
    const w = card.offsetWidth;
    const h = card.offsetHeight;

    if (this.viewport.phone()) {
      // Docked to whichever edge leaves the highlight clear; if neither does,
      // dock at the bottom and highlight only what stays visible above it.
      const room = h + 24;
      let dock: Dock = 'bottom';
      if (spot && vh - (spot.top + spot.height) < room) {
        if (spot.top >= room) dock = 'top';
        else spot = trim(spot, vh - room);
      }
      this.setSpot(spot);
      this.setDock(dock);
      return;
    }
    if (!spot) {
      this.setSpot(null);
      return this.setDock('center');
    }

    const clampX = (x: number) => Math.min(Math.max(x, EDGE), vw - w - EDGE);
    const clampY = (y: number) => Math.min(Math.max(y, EDGE), vh - h - EDGE);
    const right = spot.left + spot.width;
    const fitsBelow = (s: Box) => s.top + s.height + GAP + h <= vh - EDGE;

    let next: { top: number; left: number };
    if (!fitsBelow(spot) && spot.top - GAP - h < EDGE) {
      // No room above or below: try the sides, else shorten the highlight.
      if (right + GAP + w <= vw - EDGE)
        next = { top: clampY(spot.top), left: right + GAP };
      else if (spot.left - GAP - w >= EDGE)
        next = { top: clampY(spot.top), left: spot.left - GAP - w };
      else {
        spot = trim(spot, vh - EDGE - h - GAP);
        next = { top: spot.top + spot.height + GAP, left: clampX(spot.left) };
      }
    } else if (fitsBelow(spot))
      next = { top: spot.top + spot.height + GAP, left: clampX(spot.left) };
    else next = { top: spot.top - GAP - h, left: clampX(spot.left) };

    this.setSpot(spot);
    this.setDock('float');
    const cur = this.pos();
    if (
      Math.abs(cur.top - next.top) > 0.5 ||
      Math.abs(cur.left - next.left) > 0.5
    )
      this.pos.set(next);
  }

  private setSpot(s: Box | null) {
    if (!sameBox(s, this.spot())) this.spot.set(s);
  }

  private setDock(d: Dock) {
    if (this.dock() !== d) this.dock.set(d);
  }
}

/**
 * The highlighted box: the element plus padding, kept on screen. Tall areas
 * (a whole form or board) highlight only their top, which the scroll put in view.
 */
export function highlight(
  r: Box,
  vw: number,
  vh: number,
  phone: boolean,
): Box | null {
  const maxH = Math.max(160, vh * (phone ? 0.36 : 0.42));
  const top = r.top - PAD;
  const left = r.left - PAD;
  const x1 = Math.max(6, left);
  const y1 = Math.max(6, top);
  const x2 = Math.min(vw - 6, left + r.width + PAD * 2);
  const y2 = Math.min(vh - 6, top + Math.min(r.height + PAD * 2, maxH));
  if (x2 - x1 < 8 || y2 - y1 < 8) return null;
  return { top: y1, left: x1, width: x2 - x1, height: y2 - y1 };
}

/** Cuts the highlight off at `bottom`, keeping at least a sliver of it. */
function trim(s: Box, bottom: number): Box {
  return { ...s, height: Math.max(40, Math.min(s.height, bottom - s.top)) };
}

function sameBox(a: Box | null, b: Box | null) {
  if (!a || !b) return a === b;
  return (
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}
