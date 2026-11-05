import {
  ChangeDetectionStrategy,
  Component,
  afterNextRender,
  computed,
  input,
  signal,
} from '@angular/core';

export type RingSize = 'xs' | 'sm' | 'md' | 'lg';

const PX: Record<RingSize, number> = { xs: 32, sm: 44, md: 56, lg: 96 };
const STROKE: Record<RingSize, number> = { xs: 3, sm: 3.5, md: 4, lg: 6 };

/** Score bands shared with the rest of the app (80+ high, 60+ mid). */
export function ringBand(score: number): 'high' | 'mid' | 'low' {
  return score >= 80 ? 'high' : score >= 60 ? 'mid' : 'low';
}

/**
 * The match score as an arc gauge with the number inside. The arc draws in
 * once when the ring first appears (skipped under reduced motion); its colour
 * carries the band: brand for strong matches, brass for fair, grey for weak.
 */
@Component({
  selector: 'jb-match-ring',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'jb-match-ring',
    role: 'img',
    '[attr.aria-label]': '"Match score " + clamped() + " out of 100"',
    '[attr.data-band]': 'band()',
    '[attr.data-size]': 'size()',
    '[style.width.px]': 'px()',
    '[style.height.px]': 'px()',
    '[style.view-transition-name]': 'transitionName()',
  },
  template: `
    <svg [attr.viewBox]="'0 0 ' + px() + ' ' + px()" aria-hidden="true">
      <circle
        class="track"
        [attr.cx]="px() / 2"
        [attr.cy]="px() / 2"
        [attr.r]="radius()"
        [attr.stroke-width]="stroke()"
      />
      <circle
        class="arc"
        [attr.cx]="px() / 2"
        [attr.cy]="px() / 2"
        [attr.r]="radius()"
        [attr.stroke-width]="stroke()"
        [attr.stroke-dasharray]="circumference()"
        [style.stroke-dashoffset]="drawn() ? offset() : circumference()"
        [attr.transform]="'rotate(-90 ' + px() / 2 + ' ' + px() / 2 + ')'"
      />
    </svg>
    <span class="value" aria-hidden="true">
      {{ clamped() }}
      @if (size() === 'lg') {
        <small>match</small>
      }
    </span>
  `,
  styles: `
    :host {
      position: relative;
      display: inline-grid;
      flex: none;
      place-items: center;
      --ring: var(--ink-faint);
    }
    :host([data-band='high']) {
      --ring: var(--brand);
    }
    :host([data-band='mid']) {
      --ring: var(--signal);
    }
    svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      overflow: visible;
    }
    .track {
      fill: none;
      stroke: var(--line);
    }
    .arc {
      fill: none;
      stroke: var(--ring);
      stroke-linecap: round;
      transition: stroke-dashoffset calc(var(--dur-slow) * 2.2)
        var(--motion-ease);
    }
    .value {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      color: var(--ink);
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.03em;
      line-height: 1;
    }
    :host([data-band='high']) .value {
      color: var(--brand-ink);
    }
    :host([data-band='mid']) .value {
      color: var(--signal-ink);
    }
    :host([data-size='xs']) .value {
      font-size: 0.8125rem;
    }
    :host([data-size='sm']) .value {
      font-size: 0.9375rem;
    }
    :host([data-size='md']) .value {
      font-size: 1.25rem;
    }
    :host([data-size='lg']) .value {
      font-size: 2.125rem;
    }
    small {
      margin-top: 0.3rem;
      color: var(--ink-muted);
      font-size: 0.6875rem;
      font-weight: 500;
      letter-spacing: 0;
    }
  `,
})
export class MatchRing {
  readonly score = input.required<number>();
  readonly size = input<RingSize>('md');
  /** Optional view-transition-name so the ring morphs between pages. */
  readonly transitionName = input<string | null>(null);

  protected readonly drawn = signal(false);
  protected readonly clamped = computed(() =>
    Math.max(0, Math.min(100, Math.round(this.score() ?? 0))),
  );
  protected readonly band = computed(() => ringBand(this.clamped()));
  protected readonly px = computed(() => PX[this.size()]);
  protected readonly stroke = computed(() => STROKE[this.size()]);
  protected readonly radius = computed(() => (this.px() - this.stroke()) / 2);
  protected readonly circumference = computed(
    () => 2 * Math.PI * this.radius(),
  );
  protected readonly offset = computed(
    () => this.circumference() * (1 - this.clamped() / 100),
  );

  constructor() {
    // One frame at zero, then the transition draws the arc in.
    afterNextRender(() => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => this.drawn.set(true));
      } else {
        this.drawn.set(true);
      }
    });
  }
}
