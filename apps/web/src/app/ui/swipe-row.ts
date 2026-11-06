import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Icon } from './icon';
import type { IconName } from './icons.generated';
import type { Tone } from './stat';

export interface SwipeAction {
  label: string;
  icon: IconName;
  tone: Tone;
}

/** How far a row must travel before letting go runs the action. */
const COMMIT_PX = 96;
/** Movement before we decide whether the gesture is a swipe or a scroll. */
const LOCK_PX = 10;

/**
 * Touch shortcut for a list row: swipe right for `start`, left for `end`.
 * The row's own buttons stay, so the gesture is never the only way to act
 * (mouse, keyboard and screen readers use the buttons). Only touch input
 * swipes; vertical scrolling is left alone.
 */
@Component({
  selector: 'jb-swipe-row',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'jb-swipe-row' },
  template: `
    @if (dx() !== 0) {
      <div
        class="under"
        aria-hidden="true"
        [attr.data-side]="dx() > 0 ? 'start' : 'end'"
        [style.--tone]="toneVar()"
        [class.armed]="armed()"
      >
        @if (shown(); as a) {
          <span class="action">
            <jb-icon [name]="a.icon" [size]="20" />
            {{ a.label }}
          </span>
        }
      </div>
    }
    <div
      #content
      class="content"
      [style.transform]="dx() ? 'translateX(' + dx() + 'px)' : null"
      [class.settling]="!dragging()"
    >
      <ng-content />
    </div>
  `,
  styles: `
    :host {
      position: relative;
      display: block;
      border-radius: var(--r-card);
      touch-action: pan-y;
    }
    .under {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      padding: 0 1.25rem;
      border-radius: var(--r-card);
      background: color-mix(in srgb, var(--tone) 18%, var(--surface-sunken));
      color: var(--tone);
      font-size: 0.875rem;
      font-weight: 600;
      transition: background-color var(--dur-fast) var(--motion-ease);
    }
    .under[data-side='end'] {
      justify-content: flex-end;
    }
    .under.armed {
      background: var(--tone);
      color: var(--surface);
    }
    .action {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
    }
    .content {
      position: relative;
    }
    .content.settling {
      transition: transform var(--dur-slow) var(--motion-spring);
    }
  `,
})
export class SwipeRow {
  /** Swipe right (from the start edge). */
  readonly start = input<SwipeAction | null>(null);
  /** Swipe left (from the end edge). */
  readonly end = input<SwipeAction | null>(null);
  readonly startAction = output<void>();
  readonly endAction = output<void>();

  protected readonly dx = signal(0);
  protected readonly dragging = signal(false);
  protected readonly shown = computed(() =>
    this.dx() > 0 ? this.start() : this.dx() < 0 ? this.end() : null,
  );
  protected readonly armed = computed(() => Math.abs(this.dx()) >= COMMIT_PX);
  protected readonly toneVar = computed(() => {
    const t = this.shown()?.tone ?? 'brand';
    return t === 'muted' ? 'var(--ink-muted)' : `var(--${t})`;
  });

  private readonly content =
    viewChild.required<ElementRef<HTMLElement>>('content');

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const el = this.content().nativeElement;
      let x0 = 0;
      let y0 = 0;
      let mode: 'idle' | 'deciding' | 'swipe' | 'scroll' = 'idle';
      let swiped = false;

      const down = (e: PointerEvent) => {
        if (e.pointerType !== 'touch' || (!this.start() && !this.end())) return;
        x0 = e.clientX;
        y0 = e.clientY;
        swiped = false;
        mode = 'deciding';
      };
      const move = (e: PointerEvent) => {
        if (mode === 'idle' || mode === 'scroll') return;
        const dx = e.clientX - x0;
        const dy = e.clientY - y0;
        if (mode === 'deciding') {
          if (Math.abs(dx) < LOCK_PX && Math.abs(dy) < LOCK_PX) return;
          if (Math.abs(dy) > Math.abs(dx)) {
            mode = 'scroll';
            return;
          }
          mode = 'swipe';
          swiped = true;
          this.dragging.set(true);
          el.setPointerCapture?.(e.pointerId);
        }
        // Only toward a side that has an action; resist past the commit point.
        let x = dx;
        if ((x > 0 && !this.start()) || (x < 0 && !this.end())) x = 0;
        const over = Math.abs(x) - COMMIT_PX;
        if (over > 0) x = Math.sign(x) * (COMMIT_PX + over * 0.35);
        this.dx.set(x);
      };
      const up = () => {
        if (mode === 'swipe') {
          const x = this.dx();
          if (x >= COMMIT_PX) this.startAction.emit();
          else if (x <= -COMMIT_PX) this.endAction.emit();
        }
        mode = 'idle';
        this.dragging.set(false);
        this.dx.set(0);
      };
      // A swipe should not also count as a tap on the row's link.
      const click = (e: MouseEvent) => {
        if (swiped) {
          swiped = false;
          e.preventDefault();
          e.stopPropagation();
        }
      };

      el.addEventListener('pointerdown', down);
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('click', click, true);
      destroyRef.onDestroy(() => {
        el.removeEventListener('pointerdown', down);
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        el.removeEventListener('click', click, true);
      });
    });
  }
}
