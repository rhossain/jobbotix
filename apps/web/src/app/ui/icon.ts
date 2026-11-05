import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { ICONS, type IconElement, type IconName } from './icons.generated';

/**
 * A Lucide icon drawn from generated element data (no innerHTML). Decorative
 * by default; give the surrounding control an accessible name instead.
 * Size follows the font size unless `size` is set.
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
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      [attr.stroke-width]="stroke()"
      stroke-linecap="round"
      stroke-linejoin="round"
      width="100%"
      height="100%"
      focusable="false"
    >
      @for (el of elements(); track $index) {
        @switch (el[0]) {
          @case ('path') {
            <path [attr.d]="el[1]['d']" />
          }
          @case ('circle') {
            <circle
              [attr.cx]="el[1]['cx']"
              [attr.cy]="el[1]['cy']"
              [attr.r]="el[1]['r']"
            />
          }
          @case ('rect') {
            <rect
              [attr.x]="el[1]['x']"
              [attr.y]="el[1]['y']"
              [attr.width]="el[1]['width']"
              [attr.height]="el[1]['height']"
              [attr.rx]="el[1]['rx']"
              [attr.ry]="el[1]['ry']"
            />
          }
          @case ('line') {
            <line
              [attr.x1]="el[1]['x1']"
              [attr.y1]="el[1]['y1']"
              [attr.x2]="el[1]['x2']"
              [attr.y2]="el[1]['y2']"
            />
          }
          @case ('polyline') {
            <polyline [attr.points]="el[1]['points']" />
          }
          @case ('polygon') {
            <polygon [attr.points]="el[1]['points']" />
          }
          @case ('ellipse') {
            <ellipse
              [attr.cx]="el[1]['cx']"
              [attr.cy]="el[1]['cy']"
              [attr.rx]="el[1]['rx']"
              [attr.ry]="el[1]['ry']"
            />
          }
        }
      }
    </svg>
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

  protected readonly elements = computed(
    () => ICONS[this.name()] as readonly IconElement[],
  );
  protected readonly dimension = computed(() => {
    const s = this.size();
    return s ? `${s}px` : null;
  });
}
