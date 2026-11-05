import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';

/** A4 width in CSS pixels (210 mm at 96 dpi). */
const PAGE_PX = 793.7;

/**
 * Shows a fixed-width A4 page (the resume preview) scaled down to fit the
 * space it is given, so phones see the whole page instead of a cropped one.
 * Never scales up. Printing is unaffected: print styles target the page.
 */
@Component({
  selector: 'jb-scaled-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block',
    '[style.height.px]': 'height()',
  },
  template: `
    <div
      #page
      class="origin-top-left"
      [style.width.px]="pageWidth"
      [style.transform]="'scale(' + scale() + ')'"
    >
      <ng-content />
    </div>
  `,
  styles: `
    :host {
      overflow: hidden;
    }
    @media print {
      :host {
        height: auto !important;
        overflow: visible;
      }
      div {
        width: auto !important;
        transform: none !important;
      }
    }
  `,
})
export class ScaledPage {
  protected readonly pageWidth = PAGE_PX;
  protected readonly scale = signal(1);
  protected readonly height = signal<number | null>(null);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly page = viewChild.required<ElementRef<HTMLElement>>('page');

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      if (typeof ResizeObserver !== 'function') return;
      const measure = () => {
        const s = Math.min(1, this.host.nativeElement.clientWidth / PAGE_PX);
        this.scale.set(s);
        this.height.set(this.page().nativeElement.offsetHeight * s);
      };
      const ro = new ResizeObserver(measure);
      ro.observe(this.host.nativeElement);
      ro.observe(this.page().nativeElement);
      measure();
      destroyRef.onDestroy(() => ro.disconnect());
    });
  }
}
