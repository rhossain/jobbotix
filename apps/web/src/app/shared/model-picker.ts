import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  model,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { SettingsRepo } from '../core/data/repos';

/**
 * The per-generation model override shown next to every Generate button.
 * Empty value = the default model from Settings. Without a key on file it
 * explains that generation runs locally and links to Settings.
 */
@Component({
  selector: 'jb-model-picker',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (hasKey()) {
      <select
        class="jb-input jb-input-inline min-h-9 py-1 text-sm"
        aria-label="Model for this generation"
        [value]="value()"
        (change)="value.set($any($event.target).value)"
      >
        <option value="">Default model</option>
        @for (m of settings.models(); track m.id) {
          <option [value]="m.id" [selected]="m.id === value()">
            {{ m.label }}
          </option>
        }
      </select>
    } @else if (!quiet()) {
      <span class="text-xs text-ink-muted"
        >No AI key, so drafts are written locally.
        <a routerLink="/settings" class="text-brand-ink underline">Add a key</a>
        for model-written text.</span
      >
    }
  `,
})
export class ModelPicker {
  protected readonly settings = inject(SettingsRepo);
  readonly value = model('');
  /** Say nothing when there is no key (a second picker on the same page). */
  readonly quiet = input(false);
  readonly hasKey = computed(
    () => !!this.settings.profile()?.anthropic_key_ref,
  );

  constructor() {
    void this.settings.load();
  }
}
