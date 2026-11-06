import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  input,
  viewChild,
} from '@angular/core';
import { ICONS, type IconName } from './icons.generated';

/**
 * A Lucide icon. Decorative by default; give the surrounding control an
 * accessible name instead. Size follows the font size unless `size` is set.
 *
 * The paths are written straight into the <svg> from the generated, build-time
 * markup in icons.generated.ts (never user content). That keeps each icon to
 * one component and no per-path template views, which matters with dozens of
 * icons on a phone's first screen.
 */
@Component({
  selector: 'jb-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'jb-icon',
    'aria-hidden': 'true',
    '[style.width]': 'dimension()',
    '[style.height]': 'dimension()',
  },
  template: `
    <svg
      #svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      [attr.stroke-width]="stroke()"
      stroke-linecap="round"
      stroke-linejoin="round"
      width="100%"
      height="100%"
      focusable="false"
    ></svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      width: 1.25em;
      height: 1.25em;
      vertical-align: -0.25em;
    }
    svg {
      display: block;
    }
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
  /** Pixel size; omit to scale with the text. */
  readonly size = input<number | null>(null);
  readonly stroke = input(1.75);

  private readonly svg = viewChild.required<ElementRef<SVGSVGElement>>('svg');
  protected readonly dimension = computed(() => {
    const s = this.size();
    return s ? `${s}px` : null;
  });

  constructor() {
    effect(() => {
      // Static markup from the generator (see the class comment).
      this.svg().nativeElement.innerHTML = ICONS[this.name()];
    });
  }
}
