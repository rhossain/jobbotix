import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

/**
 * Placeholder shapes while data loads, so the layout does not jump when it
 * arrives. Announced once as "Loading" to screen readers.
 */
@Component({
  selector: 'jb-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'status', 'aria-live': 'polite', class: 'block' },
  template: `
    <span class="sr-only">Loading…</span>
    <div [class]="shape() === 'row' ? 'flex flex-col' : 'flex flex-col gap-3'">
      @for (i of items(); track i) {
        @switch (shape()) {
          @case ('card') {
            <div class="jb-card flex gap-4 p-4 md:p-5" aria-hidden="true">
              <span class="bone size-11 shrink-0 rounded-full"></span>
              <div class="flex flex-1 flex-col gap-2.5 pt-1">
                <span class="bone h-4 w-3/5"></span>
                <span class="bone h-3 w-2/5"></span>
                <div class="mt-1 flex gap-2">
                  <span class="bone h-5 w-20 rounded-full"></span>
                  <span class="bone h-5 w-16 rounded-full"></span>
                  <span class="bone h-5 w-24 rounded-full"></span>
                </div>
              </div>
            </div>
          }
          @case ('row') {
            <div
              class="flex items-center gap-4 border-b border-line py-3.5"
              aria-hidden="true"
            >
              <span class="bone size-8 shrink-0 rounded-full"></span>
              <span class="bone h-3.5 flex-1"></span>
              <span class="bone hidden h-3.5 w-24 md:block"></span>
              <span class="bone h-7 w-24 rounded-full"></span>
            </div>
          }
          @case ('tile') {
            <div class="jb-card flex flex-col gap-3 p-5" aria-hidden="true">
              <span class="bone h-3 w-1/3"></span>
              <span class="bone h-8 w-1/2"></span>
            </div>
          }
          @default {
            <span class="bone h-3.5" [style.width.%]="lineWidth(i)"></span>
          }
        }
      }
    </div>
  `,
  styles: `
    .bone {
      display: block;
      border-radius: var(--r-control);
      background: linear-gradient(
        90deg,
        var(--surface-sunken) 0%,
        color-mix(in srgb, var(--surface-sunken) 55%, var(--surface)) 50%,
        var(--surface-sunken) 100%
      );
      background-size: 200% 100%;
      animation: shimmer 1.4s linear infinite;
    }
    .rounded-full {
      border-radius: 999px;
    }
    @keyframes shimmer {
      from {
        background-position: 100% 0;
      }
      to {
        background-position: -100% 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .bone {
        animation: none;
      }
    }
  `,
})
export class Skeleton {
  readonly shape = input<'line' | 'card' | 'row' | 'tile'>('line');
  readonly count = input(3);
  protected readonly items = computed(() =>
    Array.from({ length: this.count() }, (_, i) => i),
  );
  protected lineWidth(i: number) {
    return [92, 78, 85, 64, 88][i % 5];
  }
}
