import { Directive, booleanAttribute, computed, input } from '@angular/core';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * Styles a native <button> or <a> as a Jobbotix button, keeping its native
 * semantics. `<button jbButton="primary" [busy]="saving()">Save</button>`.
 *
 * Busy shows a spinner in place of the label without changing the width and
 * sets aria-busy; the caller still disables the button if a second click
 * must not go through.
 */
@Directive({
  selector: 'button[jbButton], a[jbButton]',
  host: {
    class: 'jb-btn',
    '[class.jb-btn-primary]': "kind() === 'primary'",
    '[class.jb-btn-ghost]': "kind() === 'ghost'",
    '[class.jb-btn-danger]': "kind() === 'danger'",
    '[class.jb-btn-sm]': "size() === 'sm'",
    '[class.jb-btn-lg]': "size() === 'lg'",
    '[class.jb-btn-icon]': 'iconOnly()',
    '[class.jb-btn-block]': 'block()',
    '[attr.aria-busy]': 'busy() ? "true" : null',
  },
})
export class Button {
  /** Variant, given as the attribute value: jbButton="primary". */
  readonly variant = input<ButtonVariant | ''>('', { alias: 'jbButton' });
  readonly size = input<ButtonSize>('md');
  readonly busy = input(false, { transform: booleanAttribute });
  /** Square button holding only an icon; needs an aria-label. */
  readonly iconOnly = input(false, { transform: booleanAttribute });
  /** Full width (stacked actions on phones). */
  readonly block = input(false, { transform: booleanAttribute });

  protected readonly kind = computed<ButtonVariant>(
    () => this.variant() || 'secondary',
  );
}
