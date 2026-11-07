import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** The Jobbotix mark (the app icon's J) with or without the wordmark. */
@Component({
  selector: 'jb-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex items-center gap-2.5' },
  template: `
    <svg
      viewBox="0 0 512 512"
      [attr.width]="size()"
      [attr.height]="size()"
      aria-hidden="true"
      class="shrink-0"
    >
      <rect width="512" height="512" rx="128" fill="var(--brand)" />
      <path
        d="M296 128h64v200c0 70-46 112-116 112-58 0-98-30-112-80l58-18c8 26 26 42 54 42 32 0 52-20 52-56z"
        fill="var(--ink-on-brand)"
      />
    </svg>
    @if (wordmark()) {
      <span
        class="text-[1.0625rem] font-semibold tracking-tight text-ink"
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
