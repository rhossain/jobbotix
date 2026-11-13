import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import {
  normalisePrep,
  type PrepSheet,
  type RoleRow,
} from '@jobbotix/shared-types';
import { PrepRepo } from '../../core/data/repos';
import { Plan } from '../../core/plan';
import { RelativeDayPipe } from '../../shared/format';
import { ModelPicker } from '../../shared/model-picker';
import { Toast } from '../../shared/toast';
import { UpgradeNote } from '../../shared/upgrade-note';
import { Button, EmptyState, FieldControl, Icon } from '../../ui';

/** The Prep tab: company notes, likely questions with linked stories, your notes. */
@Component({
  selector: 'jb-prep-panel',
  imports: [
    Button,
    EmptyState,
    FieldControl,
    Icon,
    ModelPicker,
    RelativeDayPipe,
    UpgradeNote,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'jb-prep block' },
  template: `
    <div class="flex flex-col gap-5">
      @if (sheet().generatedAt) {
        <section
          class="jb-card flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between md:p-6 print:hidden"
        >
          <div class="min-w-0">
            <p class="font-semibold text-ink">
              {{ practised() }} of {{ sheet().questions.length }} questions
              practised
            </p>
            <div
              class="mt-2.5 h-2 max-w-sm overflow-hidden rounded-full bg-sunken"
              aria-hidden="true"
            >
              <span
                class="block h-full rounded-full bg-brand transition-[width] duration-300"
                [style.width.%]="
                  sheet().questions.length
                    ? (practised() / sheet().questions.length) * 100
                    : 0
                "
              ></span>
            </div>
            <p class="mt-2 text-xs text-ink-muted">
              Built {{ sheet().generatedAt | relativeDay }}
              {{
                sheet().method === 'ai'
                  ? 'by ' + (sheet().model || 'the model') + ' on your key'
                  : 'from your resume and the posting (no model call)'
              }}
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            @if (allowed()) {
              <jb-model-picker [(value)]="model" job="prep" />
              <button
                type="button"
                jbButton
                [busy]="busy()"
                [disabled]="busy()"
                (click)="generate()"
              >
                <jb-icon name="rotate-cw" /> Rebuild
              </button>
            }
            <button
              type="button"
              jbButton="ghost"
              iconOnly
              aria-label="Print the prep sheet"
              title="Print"
              (click)="print()"
            >
              <jb-icon name="printer" />
            </button>
          </div>
        </section>
        @if (!allowed()) {
          <!-- A sheet built earlier stays readable and editable; only a new
               one needs Pro. -->
          <jb-upgrade-note feature="interview_prep" class="print:hidden" />
        }

        <section class="jb-card p-5 md:p-6">
          <h3 class="flex items-center gap-2 font-semibold text-ink">
            <jb-icon name="briefcase" class="text-brand" /> About
            {{ role().company }}
          </h3>
          <ul class="mt-3 flex flex-col gap-2 text-sm">
            @for (n of sheet().companyNotes; track $index) {
              <li class="flex gap-2.5">
                <span
                  class="mt-2 size-1.5 shrink-0 rounded-full bg-brand"
                ></span
                >{{ n }}
              </li>
            }
          </ul>
        </section>

        <section>
          <h3 class="flex items-center gap-2 font-semibold text-ink">
            Likely questions
            <span class="jb-count">{{ sheet().questions.length }}</span>
          </h3>
          <ol class="mt-3 flex flex-col gap-2.5">
            @for (q of sheet().questions; track q.question; let i = $index) {
              <li
                class="jb-card transition-colors"
                [class.bg-sunken]="q.practised"
              >
                <label class="flex cursor-pointer items-start gap-3.5 p-4">
                  <input
                    type="checkbox"
                    class="mt-0.5 size-5 shrink-0"
                    [checked]="q.practised"
                    (change)="togglePractised(i)"
                    [attr.aria-label]="'Practised: ' + q.question"
                  />
                  <span class="min-w-0 text-sm">
                    <span
                      class="block font-semibold text-ink"
                      [class.text-ink-muted]="q.practised"
                      >{{ q.question }}</span
                    >
                    <span class="mt-1 block text-ink-muted">{{ q.why }}</span>
                    @if (
                      q.story !== undefined && sheet().stories[q.story];
                      as st
                    ) {
                      <span
                        class="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-brand-ink"
                      >
                        <jb-icon name="bookmark" [size]="13" /> Story:
                        {{ st.title }}
                      </span>
                    }
                  </span>
                </label>
              </li>
            }
          </ol>
        </section>

        <section>
          <h3 class="font-semibold text-ink">Your stories</h3>
          <div class="mt-3 grid gap-3 md:grid-cols-2">
            @for (st of sheet().stories; track $index) {
              <article class="jb-card p-4 text-sm md:p-5">
                <h4 class="font-semibold text-ink">{{ st.title }}</h4>
                <p class="mt-0.5 text-xs text-ink-faint">{{ st.source }}</p>
                <dl class="jb-star mt-3">
                  <dt>S</dt>
                  <dd>
                    <span class="sr-only">Situation: </span>{{ st.situation }}
                  </dd>
                  <dt>A</dt>
                  <dd><span class="sr-only">Action: </span>{{ st.action }}</dd>
                  <dt>R</dt>
                  <dd><span class="sr-only">Result: </span>{{ st.result }}</dd>
                </dl>
              </article>
            }
          </div>
        </section>

        <section class="jb-card p-5 md:p-6">
          <h3 class="flex items-center gap-2 font-semibold text-ink">
            <jb-icon name="message-square" class="text-brand" /> Ask them
          </h3>
          <ul class="mt-3 flex flex-col gap-2 text-sm">
            @for (q of sheet().questionsToAsk; track $index) {
              <li class="flex gap-2.5">
                <span
                  class="mt-2 size-1.5 shrink-0 rounded-full bg-brand"
                ></span
                >{{ q }}
              </li>
            }
          </ul>
        </section>
      } @else {
        <jb-empty-state title="No prep sheet yet" icon="lightbulb">
          Build one from your resume and the posting: what to know about the
          company, what they will ask, and which of your stories answer it.
          <div actions class="flex flex-wrap items-center gap-3">
            @if (allowed()) {
              <button
                type="button"
                jbButton="primary"
                [busy]="busy()"
                [disabled]="busy()"
                (click)="generate()"
              >
                <jb-icon name="sparkles" /> Build prep sheet
              </button>
              <jb-model-picker [(value)]="model" job="prep" />
            } @else {
              <jb-upgrade-note feature="interview_prep" />
            }
          </div>
        </jb-empty-state>
      }

      <section class="jb-card p-5 md:p-6">
        <div class="flex items-center justify-between gap-2">
          <h3 class="font-semibold text-ink">
            <label for="prep-notes">Your notes</label>
          </h3>
          <span class="text-xs text-ink-faint" role="status">{{
            noteState()
          }}</span>
        </div>
        <textarea
          jbInput
          [autogrow]="true"
          id="prep-notes"
          rows="4"
          class="mt-3 text-sm"
          placeholder="Interviewer names, what they said, what to bring up next time"
          [value]="sheet().userNotes"
          (input)="notes($any($event.target).value)"
        ></textarea>
      </section>
    </div>
  `,
  styles: `
    .jb-star {
      display: grid;
      grid-template-columns: 1.75rem 1fr;
      gap: 0.6rem 0.75rem;
      margin: 0;
    }
    .jb-star dt {
      display: grid;
      place-items: center;
      width: 1.75rem;
      height: 1.75rem;
      border-radius: 50%;
      background: var(--brand-tint);
      color: var(--brand-ink);
      font-size: 0.75rem;
      font-weight: 700;
    }
    .jb-star dd {
      margin: 0;
      padding-top: 0.2rem;
      color: var(--ink);
    }
  `,
})
export class PrepPanel {
  private readonly repo = inject(PrepRepo);
  private readonly toast = inject(Toast);
  private readonly plan = inject(Plan);
  /** False when the account's plan does not cover interview prep. */
  readonly allowed = computed(() => this.plan.can('interview_prep'));
  readonly role = input.required<RoleRow>();
  readonly sheet = signal<PrepSheet>(normalisePrep(null));
  readonly model = signal('');
  readonly busy = signal(false);
  readonly noteState = signal('');
  readonly practised = computed(
    () => this.sheet().questions.filter((q) => q.practised).length,
  );
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    effect(() => {
      const r = this.role();
      untracked(() => this.sheet.set(normalisePrep(r.prep)));
    });
  }

  async generate() {
    this.busy.set(true);
    try {
      this.sheet.set(
        await this.repo.generate(this.role().id, this.model() || undefined),
      );
      this.toast.show('Prep sheet ready');
    } catch (e) {
      if (await this.plan.handled(e)) return;
      this.toast.show((e as Error).message || 'Could not build the sheet');
    } finally {
      this.busy.set(false);
    }
  }

  togglePractised(i: number) {
    this.sheet.update((s) => ({
      ...s,
      questions: s.questions.map((q, j) =>
        j === i ? { ...q, practised: !q.practised } : q,
      ),
    }));
    this.persist();
  }

  notes(text: string) {
    this.sheet.update((s) => ({ ...s, userNotes: text }));
    this.noteState.set('Saving…');
    this.persist();
  }

  private persist() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(async () => {
      try {
        await this.repo.save(this.role().id, this.sheet());
        this.noteState.set(this.noteState() ? 'Saved' : '');
      } catch {
        this.toast.show('Could not save');
      }
    }, 500);
  }

  /** Prints only the prep sheet, not the whole role page. */
  print() {
    const body = document.body;
    const done = () => {
      body.classList.remove('jb-print-prep');
      window.removeEventListener('afterprint', done);
    };
    body.classList.add('jb-print-prep');
    window.addEventListener('afterprint', done);
    window.print();
  }
}
