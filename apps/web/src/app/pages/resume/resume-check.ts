import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import type { ResumeSections } from '@jobbotix/shared-types';
import { checkResume, type CheckResult } from '../../shared/resume-check';
import { BarRow, Icon } from '../../ui';

type Band = 'good' | 'warn' | 'bad';

/** 85 and up reads as ready; under 65 as needing work. */
export function checkBand(score: number): Band {
  return score >= 85 ? 'good' : score >= 65 ? 'warn' : 'bad';
}

/**
 * The resume check, live as the resume is edited: a score, what to fix
 * first, and for each finding the exact lines with a way to the field.
 * The rules are in shared/resume-check.ts.
 */
@Component({
  selector: 'jb-resume-check',
  imports: [BarRow, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="jb-card flex flex-col gap-4 p-4 md:p-5"
      aria-labelledby="rck-h"
    >
      <div class="flex flex-wrap items-center gap-x-5 gap-y-3">
        <p
          class="flex items-baseline gap-1"
          [attr.aria-label]="'Resume check: ' + check().score + ' out of 100'"
        >
          <span
            class="text-4xl leading-none font-semibold tracking-tight tabular-nums"
            [class.text-good]="band() === 'good'"
            [class.text-warn]="band() === 'warn'"
            [class.text-bad]="band() === 'bad'"
            >{{ check().score }}</span
          >
          <span class="text-sm text-ink-muted">/ 100</span>
        </p>
        <div class="min-w-0 flex-1 basis-52">
          <h2 id="rck-h" class="jb-section-title">Resume check</h2>
          <p class="text-sm text-ink-muted" role="status">
            @if (check().failed.length) {
              {{ check().failed.length }}
              {{ check().failed.length === 1 ? 'thing' : 'things' }} to fix ·
              {{ check().passed }} of {{ check().total }} checks passed
            } @else {
              All {{ check().total }} checks passed.
            }
          </p>
        </div>
        @if (check().failed.length) {
          <button
            type="button"
            class="jb-btn text-sm"
            [attr.aria-expanded]="open()"
            aria-controls="rck-details"
            (click)="open.set(!open())"
          >
            {{ open() ? 'Hide details' : 'Show what to fix' }}
            <jb-icon [name]="open() ? 'chevron-up' : 'chevron-down'" />
          </button>
        }
      </div>

      <div class="grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
        @for (a of check().areas; track a.area) {
          <jb-bar-row
            [label]="a.name"
            [value]="a.score"
            [tone]="bandOf(a.score)"
            [display]="a.score + '%'"
          />
        }
      </div>

      @if (open() && check().failed.length) {
        <div
          id="rck-details"
          class="flex flex-col gap-3 border-t border-line pt-4"
        >
          @for (f of check().failed; track f.id) {
            <article class="rounded-card border border-line p-4 text-sm">
              <div
                class="flex flex-wrap items-start justify-between gap-x-3 gap-y-1"
              >
                <h3
                  class="flex min-w-0 items-start gap-1.5 font-medium text-ink"
                >
                  <jb-icon
                    name="circle-x"
                    [size]="17"
                    class="mt-0.5 shrink-0 text-bad"
                  />
                  <span>Not yet: {{ lower(f.title) }}</span>
                </h3>
                <span class="text-xs whitespace-nowrap text-ink-muted"
                  >{{ lost(f) }} of {{ f.max }} points lost</span
                >
              </div>
              <p class="mt-1.5 text-ink-muted">{{ f.advice }}</p>
              @if (shown(f).length) {
                <ul class="mt-2 flex flex-col gap-1.5">
                  @for (item of shown(f); track $index) {
                    <li class="flex flex-wrap items-start gap-x-2 gap-y-1">
                      <span
                        class="min-w-0 flex-1 basis-56 rounded-control bg-sunken px-2.5 py-1.5 break-words"
                        >{{ item.text }}</span
                      >
                      @if (item.field) {
                        <button
                          type="button"
                          class="jb-btn jb-btn-ghost text-sm"
                          (click)="go.emit(item.field)"
                        >
                          <jb-icon name="pencil" [size]="15" /> Fix
                        </button>
                      }
                    </li>
                  }
                </ul>
              }
              @if (f.wording) {
                <button
                  type="button"
                  class="jb-btn mt-3 text-sm"
                  (click)="review.emit()"
                >
                  <jb-icon name="sparkles" [size]="16" /> Let the AI review
                  propose rewrites
                </button>
              }
            </article>
          }
          <p class="text-xs text-ink-muted">
            This checks how the resume is written and whether a parser can read
            it. It cannot judge whether your experience fits a job, and no score
            promises an interview. Scores on other checking sites differ because
            each has its own rules, and some mark you down for not using their
            template.
          </p>
        </div>
      }
    </section>
  `,
})
export class ResumeCheckPanel {
  readonly sections = input.required<ResumeSections>();
  /** The id of the field a finding is fixed in. */
  readonly go = output<string>();
  /** Open the AI review. */
  readonly review = output<void>();

  readonly open = signal(false);
  readonly check = computed(() => checkResume(this.sections()));
  protected readonly band = computed(() => checkBand(this.check().score));

  protected bandOf(score: number): Band {
    return checkBand(score);
  }
  protected lower(title: string): string {
    return title.charAt(0).toLowerCase() + title.slice(1);
  }
  protected lost(f: CheckResult): number {
    return Math.round((f.max - f.points) * 10) / 10;
  }
  /** Findings with nothing to show (a bare "missing") list no lines. */
  protected shown(f: CheckResult) {
    return f.items.filter((i) => i.text.trim());
  }
}
