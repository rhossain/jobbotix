import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ResumeTemplateChoice } from '../core/resume-template';
import type { ResumeTemplate } from './resume-templates';

/**
 * Picks the resume template. The preview next to it is the sample: it
 * redraws in the template the moment one is picked.
 */
@Component({
  selector: 'jb-template-picker',
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
            [attr.aria-pressed]="t.id === choice.template().id"
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
            }
          </button>
        }
      </div>
      <p class="text-xs text-ink-muted">
        {{ choice.template().blurb }} Every template is one column of real text,
        so applicant tracking systems read them all the same.
      </p>
    </div>
  `,
})
export class TemplatePicker {
  protected readonly choice = inject(ResumeTemplateChoice);

  pick(t: ResumeTemplate) {
    if (t.id !== this.choice.template().id) void this.choice.choose(t.id);
  }
}
