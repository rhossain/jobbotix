import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  effect,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { Button } from './button';
import { Icon } from './icon';

/**
 * A modal panel: a bottom sheet on phones (drag the handle down to close),
 * a panel from the right on wider screens. Built on <dialog>, so focus stays
 * inside and Esc closes it. Footer actions go in a [footer] element.
 * `<jb-sheet [(open)]="filtersOpen" title="Filters">…</jb-sheet>`
 */
@Component({
  selector: 'jb-sheet',
  imports: [Button, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Backdrop clicks close the dialog; Esc (native) is the keyboard route. -->
    <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
    <dialog
      #dialog
      class="jb-sheet"
      [attr.aria-label]="title()"
      (close)="open.set(false)"
      (click)="onBackdrop($event)"
    >
      <div
        class="jb-sheet-panel"
        [style.transform]="drag() ? 'translateY(' + drag() + 'px)' : null"
        [style.transition]="dragging ? 'none' : null"
      >
        <div #head class="jb-sheet-head">
          <span class="jb-sheet-handle" aria-hidden="true"></span>
          <h2 class="text-lg font-semibold text-ink">{{ title() }}</h2>
          <button
            type="button"
            jbButton="ghost"
            iconOnly
            aria-label="Close"
            (click)="open.set(false)"
          >
            <jb-icon name="x" />
          </button>
        </div>
        <div class="jb-sheet-body">
          @if (open()) {
            <ng-content />
          }
        </div>
        <div class="jb-sheet-foot empty:hidden">
          <ng-content select="[footer]" />
        </div>
      </div>
    </dialog>
  `,
})
export class Sheet {
  readonly open = model(false);
  readonly title = input.required<string>();

  private readonly dialog =
    viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly head = viewChild.required<ElementRef<HTMLElement>>('head');
  protected readonly drag = signal(0);
  protected dragging = false;
  private startY = 0;

  constructor() {
    effect(() => {
      const d = this.dialog().nativeElement;
      if (this.open() && !d.open) d.showModal?.();
      if (!this.open() && d.open) d.close();
    });
    // Drag-to-dismiss is a touch shortcut on the sheet's header; the Close
    // button and Esc stay the accessible routes.
    afterNextRender(() => {
      const el = this.head().nativeElement;
      el.addEventListener('pointerdown', (e) => this.dragStart(e));
      el.addEventListener('pointermove', (e) => this.dragMove(e));
      el.addEventListener('pointerup', () => this.dragEnd());
      el.addEventListener('pointercancel', () => this.dragEnd());
    });
  }

  protected onBackdrop(e: MouseEvent) {
    if (e.target === this.dialog().nativeElement) this.open.set(false);
  }

  private dragStart(e: PointerEvent) {
    if (
      e.pointerType === 'mouse' ||
      (e.target as HTMLElement).closest('button')
    )
      return;
    this.dragging = true;
    this.startY = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  private dragMove(e: PointerEvent) {
    if (this.dragging) this.drag.set(Math.max(0, e.clientY - this.startY));
  }

  private dragEnd() {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.drag() > 96) this.open.set(false);
    this.drag.set(0);
  }
}
