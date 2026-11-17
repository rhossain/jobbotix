import { ChangeDetectionStrategy, Component, model } from '@angular/core';
import { Icon } from '../../ui';

/**
 * The eye at the right end of a password box: shows what was typed, or hides
 * it again. Sits inside a `relative` wrapper around the input, which leaves
 * room for it with `pr-11`.
 */
@Component({
  selector: 'jb-eye-toggle',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'absolute inset-y-0 right-0 flex items-center pr-1' },
  template: `
    <button
      type="button"
      class="grid size-9 cursor-pointer place-items-center rounded-control border-0 bg-transparent text-ink-muted hover:text-ink"
      [attr.aria-label]="shown() ? 'Hide password' : 'Show password'"
      [attr.title]="shown() ? 'Hide password' : 'Show password'"
      [attr.aria-pressed]="shown()"
      (click)="shown.set(!shown())"
    >
      <jb-icon [name]="shown() ? 'eye-off' : 'eye'" [size]="18" />
    </button>
  `,
})
export class EyeToggle {
  readonly shown = model(false);
}
