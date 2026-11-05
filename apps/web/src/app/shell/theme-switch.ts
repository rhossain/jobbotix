import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Theme, type ThemePreference } from '../core/theme';
import { Icon, type IconName } from '../ui';

/** System / Light / Dark as three icon toggles. */
@Component({
  selector: 'jb-theme-switch',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex' },
  template: `
    <div
      class="inline-flex gap-0.5 rounded-full bg-sunken p-[3px]"
      role="radiogroup"
      aria-label="Theme"
    >
      @for (o of options; track o.id) {
        <button
          type="button"
          role="radio"
          class="grid size-8 place-items-center rounded-full text-ink-muted transition-colors hover:text-ink aria-checked:bg-surface aria-checked:text-ink aria-checked:shadow-raised pointer-coarse:size-10"
          [attr.aria-checked]="theme.preference() === o.id"
          [attr.aria-label]="o.label"
          [title]="o.label"
          (click)="theme.set(o.id)"
        >
          <jb-icon [name]="o.icon" [size]="16" />
        </button>
      }
    </div>
  `,
})
export class ThemeSwitch {
  protected readonly theme = inject(Theme);
  protected readonly options: {
    id: ThemePreference;
    label: string;
    icon: IconName;
  }[] = [
    { id: 'system', label: 'Match system', icon: 'monitor' },
    { id: 'light', label: 'Light', icon: 'sun' },
    { id: 'dark', label: 'Dark', icon: 'moon' },
  ];
}
