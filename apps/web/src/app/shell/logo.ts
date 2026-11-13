import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The Jobbotix mark (a lowercase j whose dot is a spark) with or without the
 * wordmark. The mark keeps its own colours in both themes, like the app icon.
 */
@Component({
  selector: 'jb-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex items-center gap-2.5' },
  template: `
    <svg
      viewBox="0 0 120 120"
      [attr.width]="size()"
      [attr.height]="size()"
      aria-hidden="true"
      class="shrink-0"
    >
      <rect width="120" height="120" rx="28" fill="#0b5f5a" />
      <path
        d="M75 51V81A18 18 0 0 1 39 81"
        fill="none"
        stroke="#fff"
        stroke-width="15"
        stroke-linecap="round"
      />
      <path
        d="M75 11Q77.6 22.4 89 25 77.6 27.6 75 39 72.4 27.6 61 25 72.4 22.4 75 11Z"
        fill="#d9a94a"
      />
    </svg>
    @if (wordmark()) {
      <span
        class="text-[1.0625rem] font-semibold lowercase tracking-tight text-ink"
        [class]="wordmark() === 'auto' ? 'max-[360px]:hidden' : ''"
        >Jobbotix</span
      >
    }
  `,
})
export class Logo {
  readonly size = input(28);
  /** 'auto' drops the wordmark on screens under 360px, where space runs out. */
  readonly wordmark = input<boolean | 'auto'>(true);
}
