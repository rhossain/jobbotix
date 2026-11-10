import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  model,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { modelOptions } from '@jobbotix/shared-types';
import { SettingsRepo } from '../core/data/repos';

/**
 * The per-generation model override shown next to every Generate button.
 * Empty value = the first AI connection in Settings, on its own model. With
 * several connections the models are grouped by provider; picking one sends
 * that provider first. Without a connection it explains that generation runs
 * locally and links to Settings.
 */
@Component({
  selector: 'jb-model-picker',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (hasKey()) {
      <select
        class="jb-input jb-input-inline min-h-9 max-w-full py-1 text-sm"
        aria-label="Model for this generation"
        [value]="value()"
        (change)="value.set($any($event.target).value)"
      >
        <option value="">Default model</option>
        @if (groups().length === 1) {
          @for (m of groups()[0].models; track m.id) {
            <option [value]="m.id" [selected]="m.id === value()">
              {{ m.label }}
            </option>
          }
        } @else {
          @for (g of groups(); track g.provider) {
            <optgroup [label]="g.name">
              @for (m of g.models; track m.id) {
                <option [value]="m.id" [selected]="m.id === value()">
                  {{ m.label }}
                </option>
              }
            </optgroup>
          }
        }
      </select>
    } @else if (!quiet()) {
      <span class="text-xs text-ink-muted"
        >No AI connection, so drafts are written locally.
        <a routerLink="/settings" class="text-brand-ink underline"
          >Connect a provider</a
        >
        (Gemini and Groq are free) for model-written text.</span
      >
    }
  `,
})
export class ModelPicker {
  protected readonly settings = inject(SettingsRepo);
  readonly value = model('');
  /** Say nothing when there is no connection (a second picker on the same page). */
  readonly quiet = input(false);
  readonly hasKey = computed(() => this.settings.connections().length > 0);
  /** Each connection's models, in the order the connections are tried. */
  readonly groups = computed(() =>
    modelOptions(this.settings.connections(), this.settings.models()),
  );

  constructor() {
    void this.settings.load();
  }
}
