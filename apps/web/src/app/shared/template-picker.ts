import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { ResumeTemplateChoice } from '../core/resume-template';
import { Icon } from '../ui';
import { templateOf, type ResumeTemplate } from './resume-templates';
import type { TemplateSuggestion } from './template-suggest';

/**
 * Picks the resume template. The preview next to it is the sample: it
 * redraws in the template the moment one is picked.
 *
 * On the resume page it sets the account's template. On a tailored resume it
 * is given that copy's template (`forCopy`) and a suggestion for the job,
 * and reports the pick instead of changing the account.
 */
@Component({
  selector: 'jb-template-picker',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-2">
      <div
        class="flex flex-wrap items-center gap-1.5"
        role="group"
        aria-label="Resume template"
      >
        <span class="mr-1 text-sm font-medium text-ink">Template</span>
        @for (t of choice.all; track t.id) {
          <button
            type="button"
            class="jb-chip"
            [attr.aria-pressed]="t.id === current().id"
            [title]="t.blurb"
            (click)="pick(t)"
          >
            <span
              class="size-2.5 shrink-0 rounded-full"
              aria-hidden="true"
              [style.background]="t.accent"
            ></span>
            {{ t.name }}
            @if (choice.locked(t)) {
              <span class="jb-tag ml-0.5">Pro</span>
            } @else if (suggestion()?.id === t.id) {
              <span class="jb-tag ml-0.5">Suggested</span>
            }
          </button>
        }
      </div>

      @if (suggestion(); as s) {
        <div class="flex flex-col gap-1.5 text-sm" aria-live="polite">
          <p class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span class="flex min-w-0 items-start gap-1.5">
              <jb-icon
                name="lightbulb"
                [size]="16"
                class="mt-0.5 shrink-0 text-ink-muted"
              />
              <span>
                @if (s.id === current().id) {
                  <b>{{ suggested().name }}</b> suits this job.
                } @else {
                  Suggested for this job: <b>{{ suggested().name }}</b
                  >.
                }
                {{ s.reason }}
              </span>
            </span>
            @if (s.id !== current().id) {
              <button
                type="button"
                class="jb-btn text-sm"
                (click)="pick(suggested())"
              >
                Use {{ suggested().name }}
              </button>
            }
          </p>
          @if (photoWarning(); as w) {
            <p class="text-bad" role="alert">{{ w }}</p>
          } @else if (s.note) {
            <p class="text-xs text-ink-muted">{{ s.note }}</p>
          }
        </div>
      } @else {
        <p class="text-xs text-ink-muted">
          {{ current().blurb }} Every template keeps the text in one column of
          real text, so applicant tracking systems read them all the same.
        </p>
      }
    </div>
  `,
})
export class TemplatePicker {
  protected readonly choice = inject(ResumeTemplateChoice);

  /**
   * The template of one tailored resume. Set, the picker shows it and
   * reports picks through `picked`; unset, it shows and sets the account's.
   */
  readonly forCopy = input<string | null>(null);
  /** What suits the job this copy is for. */
  readonly suggestion = input<TemplateSuggestion | null>(null);
  readonly picked = output<string>();

  protected readonly current = computed(() =>
    this.forCopy() ? templateOf(this.forCopy()) : this.choice.template(),
  );
  protected readonly suggested = computed(() =>
    templateOf(this.suggestion()?.id),
  );
  /** The copy carries a photo to a country that asks for none. */
  protected readonly photoWarning = computed(() => {
    const s = this.suggestion();
    if (!s || !this.current().photo) return '';
    if (s.photo === 'discouraged')
      return `This copy uses the Photo template, and employers in ${s.market} ask for resumes without a photo. Pick another template before you send it.`;
    if (!s.market)
      return 'This copy uses the Photo template, and this job could be anywhere: a photo counts against you in some countries. Pick another template to be safe.';
    return '';
  });

  async pick(t: ResumeTemplate) {
    if (t.id === this.current().id) return;
    if (this.forCopy() === null) {
      await this.choice.choose(t.id);
      return;
    }
    if (this.choice.locked(t)) {
      await this.choice.offer();
      return;
    }
    this.picked.emit(t.id);
  }
}
