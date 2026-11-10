import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { upgradeMessage, type Feature } from '@jobbotix/shared-types';
import { Icon } from '../ui';

/**
 * Stands where a gated action would be: says which plan has the feature and
 * links to the Plan card. `<jb-upgrade-note feature="company_research" />`
 */
@Component({
  selector: 'jb-upgrade-note',
  imports: [Icon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div
      class="flex flex-col gap-3 rounded-control bg-brand-tint p-3.5 text-left text-sm text-brand-ink sm:flex-row sm:items-center sm:justify-between"
      role="note"
    >
      <span class="flex min-w-0 items-start gap-2">
        <jb-icon name="sparkles" [size]="17" class="mt-0.5 shrink-0" />
        <span class="min-w-0">{{ message() }}</span>
      </span>
      <a
        routerLink="/settings"
        fragment="plan"
        class="jb-btn jb-btn-sm shrink-0 self-start sm:self-auto"
        >See your plan</a
      >
    </div>
  `,
})
export class UpgradeNote {
  readonly feature = input.required<Feature>();
  readonly message = computed(() => upgradeMessage(this.feature()));
}
