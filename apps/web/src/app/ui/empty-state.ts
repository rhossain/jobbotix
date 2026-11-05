import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Icon } from './icon';
import type { IconName } from './icons.generated';

/**
 * What an empty screen says: what will appear here and how to get the first
 * one. Body text is projected; actions go in an [actions] element.
 */
@Component({
  selector: 'jb-empty-state',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div
      class="flex flex-col items-start gap-3 rounded-card border border-dashed border-line-strong bg-surface/60 px-5 py-6 md:flex-row md:gap-5 md:px-6"
      [class.md:items-center]="compact()"
    >
      <span
        class="grid size-11 shrink-0 place-items-center rounded-full bg-brand-tint text-brand-ink"
      >
        <jb-icon [name]="icon()" [size]="22" />
      </span>
      <div class="min-w-0 flex-1">
        <p class="font-semibold text-ink">{{ title() }}</p>
        <div class="mt-1 max-w-[60ch] text-sm text-ink-muted">
          <ng-content />
        </div>
        <div class="mt-4 flex flex-wrap gap-2 empty:hidden">
          <ng-content select="[actions]" />
        </div>
      </div>
    </div>
  `,
})
export class EmptyState {
  readonly title = input.required<string>();
  readonly icon = input<IconName>('inbox');
  readonly compact = input(false);
}
