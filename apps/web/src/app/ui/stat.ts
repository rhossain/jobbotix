import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

export type Tone = 'brand' | 'signal' | 'good' | 'warn' | 'bad' | 'muted';

/** One headline number with its label and an optional sub-line. */
@Component({
  selector: 'jb-stat',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'jb-card flex flex-col gap-1.5 p-4 md:p-5' },
  template: `
    <p class="text-sm font-medium text-ink-muted">{{ label() }}</p>
    <p
      class="text-3xl leading-none font-semibold tracking-tight tabular-nums"
      [class.text-ink]="tone() === 'muted'"
      [class.text-brand-ink]="tone() === 'brand'"
      [class.text-signal-ink]="tone() === 'signal'"
      [class.text-good]="tone() === 'good'"
      [class.text-warn]="tone() === 'warn'"
      [class.text-bad]="tone() === 'bad'"
    >
      {{ value() }}
    </p>
    @if (sub()) {
      <p class="text-xs text-ink-muted">{{ sub() }}</p>
    }
    <ng-content />
  `,
})
export class Stat {
  readonly label = input.required<string>();
  readonly value = input.required<string | number>();
  readonly sub = input<string | null>(null);
  readonly tone = input<Tone>('muted');
}

/**
 * A labelled horizontal bar: funnels, distributions, headroom meters.
 * The bar is decorative; the label and value carry the meaning.
 */
@Component({
  selector: 'jb-bar-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'grid grid-cols-[minmax(5.5rem,auto)_1fr_auto] items-center gap-3 text-sm',
  },
  template: `
    <span class="truncate text-ink-muted" [title]="label()">{{ label() }}</span>
    <span
      class="h-2.5 overflow-hidden rounded-full bg-sunken"
      aria-hidden="true"
    >
      <span
        class="block h-full rounded-full transition-[width] duration-500 ease-out"
        [style.width.%]="percent()"
        [style.background]="colour()"
      ></span>
    </span>
    <span class="min-w-[2.5ch] text-right font-medium text-ink tabular-nums">{{
      display() ?? value()
    }}</span>
  `,
})
export class BarRow {
  readonly label = input.required<string>();
  readonly value = input.required<number>();
  readonly max = input(100);
  readonly tone = input<Tone>('brand');
  /** Text shown at the end instead of the raw value (e.g. "42%"). */
  readonly display = input<string | null>(null);

  protected readonly percent = computed(() => {
    const m = this.max();
    return m > 0 ? Math.max(0, Math.min(100, (this.value() / m) * 100)) : 0;
  });
  protected readonly colour = computed(
    () =>
      ({
        brand: 'var(--brand)',
        signal: 'var(--signal)',
        good: 'var(--good)',
        warn: 'var(--warn)',
        bad: 'var(--bad)',
        muted: 'var(--ink-faint)',
      })[this.tone()],
  );
}
