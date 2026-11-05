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
import { RelativeDayPipe } from '../../shared/format';
import { ModelPicker } from '../../shared/model-picker';
import { Toast } from '../../shared/toast';

/** The Prep tab: company notes, likely questions with linked stories, your notes. */
@Component({
  selector: 'jb-prep-panel',
  imports: [ModelPicker, RelativeDayPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-sm text-neutral-600 dark:text-neutral-300">
          @if (sheet().generatedAt) {
            Built {{ sheet().generatedAt | relativeDay }}
            {{
              sheet().method === 'ai'
                ? 'by ' + (sheet().model || 'the model') + ' on your key'
                : 'from your resume and the posting (no model call)'
            }}
            · {{ practised() }}/{{ sheet().questions.length }} practised
          } @else {
            No prep sheet yet. Build one from your resume and the posting: what
            to know, what they will ask, which of your stories answer it.
          }
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <jb-model-picker [(value)]="model" />
          <button
            type="button"
            class="jb-btn-primary"
            (click)="generate()"
            [disabled]="busy()"
          >
            {{
              busy()
                ? 'Building…'
                : sheet().generatedAt
                  ? 'Rebuild'
                  : 'Build prep sheet'
            }}
          </button>
          @if (sheet().generatedAt) {
            <button type="button" class="jb-btn" (click)="print()">
              Print
            </button>
          }
        </div>
      </div>

      @if (sheet().generatedAt) {
        <section>
          <h3 class="jb-section-title">About {{ role().company }}</h3>
          <ul class="mt-2 list-disc space-y-1 pl-5 text-sm">
            @for (n of sheet().companyNotes; track $index) {
              <li>{{ n }}</li>
            }
          </ul>
        </section>

        <section>
          <h3 class="jb-section-title">Likely questions</h3>
          <ol class="mt-2 space-y-3 text-sm">
            @for (q of sheet().questions; track q.question; let i = $index) {
              <li class="jb-card p-3" [class.opacity-70]="q.practised">
                <label class="flex items-start gap-2">
                  <input
                    type="checkbox"
                    class="mt-1"
                    [checked]="q.practised"
                    (change)="togglePractised(i)"
                    [attr.aria-label]="'Practised: ' + q.question"
                  />
                  <span>
                    <span class="font-semibold">{{ q.question }}</span>
                    <span
                      class="mt-1 block text-neutral-600 dark:text-neutral-300"
                      >{{ q.why }}</span
                    >
                    @if (
                      q.story !== undefined && sheet().stories[q.story];
                      as st
                    ) {
                      <span
                        class="mt-1 block text-xs text-brand-600 dark:text-brand-50"
                        >Story: {{ st.title }}</span
                      >
                    }
                  </span>
                </label>
              </li>
            }
          </ol>
        </section>

        <section>
          <h3 class="jb-section-title">Your stories</h3>
          <div class="mt-2 grid gap-3 md:grid-cols-2">
            @for (s of sheet().stories; track $index) {
              <article class="jb-card p-3 text-sm">
                <h4 class="font-semibold">{{ s.title }}</h4>
                <p class="mt-1 text-xs text-neutral-500">{{ s.source }}</p>
                <dl class="mt-2 space-y-1">
                  <div>
                    <dt class="inline font-medium">Situation:</dt>
                    <dd class="inline">{{ s.situation }}</dd>
                  </div>
                  <div>
                    <dt class="inline font-medium">Action:</dt>
                    <dd class="inline">{{ s.action }}</dd>
                  </div>
                  <div>
                    <dt class="inline font-medium">Result:</dt>
                    <dd class="inline">{{ s.result }}</dd>
                  </div>
                </dl>
              </article>
            }
          </div>
        </section>

        <section>
          <h3 class="jb-section-title">Ask them</h3>
          <ul class="mt-2 list-disc space-y-1 pl-5 text-sm">
            @for (q of sheet().questionsToAsk; track $index) {
              <li>{{ q }}</li>
            }
          </ul>
        </section>
      }

      <section>
        <h3 class="jb-section-title">Your notes</h3>
        <textarea
          id="prep-notes"
          class="jb-input mt-2 min-h-32 text-sm"
          placeholder="Interviewer names, what they said, what to bring up next time…"
          [value]="sheet().userNotes"
          (input)="notes($any($event.target).value)"
        ></textarea>
        @if (noteState()) {
          <p class="mt-1 text-xs text-neutral-500">{{ noteState() }}</p>
        }
      </section>
    </div>
  `,
})
export class PrepPanel {
  private readonly repo = inject(PrepRepo);
  private readonly toast = inject(Toast);
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

  print() {
    window.print();
  }
}
