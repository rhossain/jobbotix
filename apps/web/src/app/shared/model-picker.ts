import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  model,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  creditQuote,
  creditsLabel,
  modelOptions,
  type GatedAiJob,
} from '@jobbotix/shared-types';
import { SettingsRepo } from '../core/data/repos';
import { Plan } from '../core/plan';

/**
 * The per-generation model override shown next to every Generate button.
 * Empty value = the default: the account's credits when it is on Pro,
 * otherwise the first AI connection in Settings on its own model. With
 * several connections the models are grouped by provider; picking one sends
 * that provider first (and spends no credits).
 *
 * With `job` set it also says what the generation will cost in credits,
 * when it will cost any. Without a connection and without credits it
 * explains that generation runs locally and links to Settings.
 */
@Component({
  selector: 'jb-model-picker',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex flex-wrap items-center gap-2' },
  template: `
    @if (hasKey()) {
      <select
        class="jb-input jb-input-inline min-h-9 max-w-full py-1 text-sm"
        aria-label="Model for this generation"
        [value]="value()"
        (change)="value.set($any($event.target).value)"
      >
        <option value="">
          {{ onCredits() ? 'Jobbotix AI (credits)' : 'Default model' }}
        </option>
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
    }
    @if (quote(); as q) {
      @if (q.affordable) {
        <span
          class="jb-tag jb-tag-ai"
          title="Charged only when the model answers"
          >{{ label(q.credits) }}</span
        >
      } @else {
        <span class="text-xs text-warn"
          >Needs {{ label(q.credits) }}; {{ q.why }}.
          @if (hasKey()) {
            Your own key is used instead.
          } @else {
            <a routerLink="/settings" class="underline">Connect a key</a>
            or add credits; until then drafts are written locally.
          }
        </span>
      }
    } @else if (!hasKey() && !quiet()) {
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
  private readonly plan = inject(Plan);
  readonly value = model('');
  /** Say nothing when there is no connection (a second picker on the same page). */
  readonly quiet = input(false);
  /** The AI job this picker is for, to quote its cost in credits. */
  readonly job = input<GatedAiJob | undefined>(undefined);
  readonly hasKey = computed(() => this.settings.connections().length > 0);
  /** Each connection's models, in the order the connections are tried. */
  readonly groups = computed(() =>
    modelOptions(this.settings.connections(), this.settings.models()),
  );
  /** What the next generation costs in credits; null when it uses none. */
  readonly quote = computed(() => {
    const job = this.job();
    return job
      ? creditQuote(this.plan.route(), job, {
          ownConnections: this.settings.connections().length,
          picked: !!this.value(),
        })
      : null;
  });
  /** The default option runs on credits (a paying account that can afford it). */
  readonly onCredits = computed(() => {
    const job = this.job();
    if (!job) return false;
    const q = creditQuote(this.plan.route(), job, {
      ownConnections: this.settings.connections().length,
    });
    return !!q?.affordable;
  });

  constructor() {
    void this.settings.load();
  }

  label(n: number) {
    return creditsLabel(n);
  }
}
