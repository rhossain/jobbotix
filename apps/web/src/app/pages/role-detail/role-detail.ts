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
import { RouterLink } from '@angular/router';
import {
  ROLE_STATUS_LABELS,
  type RoleEventRow,
  type RoleRow,
  type ScreeningAnswerRow,
} from '@jobbotix/shared-types';
import { LettersRepo, RolesRepo, ScreeningRepo } from '../../core/data/repos';
import { ModelPicker } from '../../shared/model-picker';
import { ShareButton } from '../../shared/share-button';
import { RelativeDayPipe, TypeLabelPipe, scoreBand } from '../../shared/format';
import { StatusSelect } from '../../shared/status-select';
import { Toast } from '../../shared/toast';
import { PrepPanel } from './prep-panel';
import { VariantPanel } from './variant-panel';
import { wordCount } from '@jobbotix/shared-types';

type Tab = 'fit' | 'resume' | 'prep' | 'posting' | 'activity';

@Component({
  selector: 'jb-role-detail',
  imports: [
    RouterLink,
    RelativeDayPipe,
    TypeLabelPipe,
    StatusSelect,
    VariantPanel,
    PrepPanel,
    ModelPicker,
    ShareButton,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (role(); as r) {
      <article
        class="flex flex-col gap-6"
        [class.print:hidden]="tab() === 'resume'"
      >
        <nav class="text-sm">
          <a routerLink="/roles" class="text-neutral-500 hover:underline"
            >← Roles</a
          >
        </nav>

        <header class="flex flex-wrap items-start gap-4">
          <div class="jb-score jb-score-{{ band() }}" aria-label="Match score">
            {{ r.score }}<small>MATCH</small>
          </div>
          <div class="min-w-0 flex-1">
            <h1 class="text-2xl font-semibold tracking-tight">{{ r.title }}</h1>
            <p class="text-neutral-600 dark:text-neutral-300">
              {{ r.company }}
            </p>
            <div class="mt-2 flex flex-wrap gap-1.5">
              @if (r.ai_match) {
                <span class="jb-tag jb-tag-ai">AI-assisted dev</span>
              }
              <span class="jb-tag">{{ r.type | typeLabel }}</span>
              @if (r.location) {
                <span class="jb-tag">{{ r.location }}</span>
              }
              @if (r.salary) {
                <span class="jb-tag">{{ r.salary }}</span>
              }
              @if (r.source) {
                <span class="jb-tag">{{ r.source }}</span>
              }
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <a
              [href]="r.url"
              target="_blank"
              rel="noopener"
              class="jb-btn-primary"
              >Open posting ↗</a
            >
            <jb-share-button kind="role" [roleId]="r.id" />
            <jb-status-select [role]="r" />
          </div>
        </header>

        <div
          role="tablist"
          class="flex gap-1 border-b border-neutral-200 dark:border-neutral-800"
        >
          @for (t of tabs; track t.id) {
            <button
              type="button"
              role="tab"
              class="jb-tab"
              [class.jb-tab-active]="tab() === t.id"
              [attr.aria-selected]="tab() === t.id"
              [id]="'tab-' + t.id"
              (click)="tab.set(t.id)"
            >
              {{ t.label }}
            </button>
          }
        </div>

        @switch (tab()) {
          @case ('fit') {
            <div class="grid gap-6 md:grid-cols-2">
              <section>
                <h2 class="jb-section-title">Why it fits</h2>
                @if (r.reasons.length) {
                  <ul class="mt-2 list-disc space-y-1 pl-5 text-sm">
                    @for (x of r.reasons; track $index) {
                      <li>{{ x }}</li>
                    }
                  </ul>
                } @else {
                  <p class="mt-2 text-sm text-neutral-500">
                    The run gave no reasons for this one.
                  </p>
                }
              </section>
              <section>
                <h2 class="jb-section-title">Watch out</h2>
                @if (r.gaps.length) {
                  <ul class="mt-2 list-disc space-y-1 pl-5 text-sm">
                    @for (x of r.gaps; track $index) {
                      <li>{{ x }}</li>
                    }
                  </ul>
                } @else {
                  <p class="mt-2 text-sm text-neutral-500">Nothing flagged.</p>
                }
              </section>
            </div>

            <section>
              <div class="flex flex-wrap items-center justify-between gap-2">
                <h2 class="jb-section-title">Cover letter</h2>
                <div class="flex gap-2">
                  @if (r.cover_letter) {
                    <button
                      type="button"
                      class="jb-btn"
                      (click)="copy(r.cover_letter, 'Cover letter copied')"
                    >
                      Copy
                    </button>
                  }
                  @if (editingLetter()) {
                    <button
                      type="button"
                      class="jb-btn-primary"
                      (click)="saveLetter()"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      class="jb-btn"
                      (click)="editingLetter.set(false)"
                    >
                      Cancel
                    </button>
                  } @else {
                    <button
                      type="button"
                      class="jb-btn"
                      (click)="startEditLetter(r)"
                    >
                      {{ r.cover_letter ? 'Edit' : 'Write one' }}
                    </button>
                    <button
                      type="button"
                      class="jb-btn"
                      (click)="draftLetter(r, !!r.cover_letter)"
                      [disabled]="drafting()"
                    >
                      {{
                        drafting()
                          ? 'Drafting…'
                          : r.cover_letter
                            ? 'Rewrite'
                            : 'Draft one'
                      }}
                    </button>
                  }
                </div>
              </div>
              <div
                class="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500"
              >
                @if (!editingLetter()) {
                  <jb-model-picker [(value)]="letterModel" />
                }
                @if (r.cover_letter) {
                  <span>{{ letterWords(r.cover_letter) }} words</span>
                }
                @if (letterMethod(); as lm) {
                  <span>{{
                    lm.method === 'ai'
                      ? '· written by ' +
                        (lm.model || 'the model') +
                        ' on your key'
                      : '· local draft from your resume (no model call)'
                  }}</span>
                }
                @if (letters.voiceSamples().length === 0) {
                  <span
                    >· add
                    <a routerLink="/settings" class="underline"
                      >voice samples</a
                    >
                    so drafts sound like you</span
                  >
                }
              </div>
              @if (editingLetter()) {
                <textarea
                  id="letter"
                  class="jb-input mt-2 min-h-64 font-mono text-sm"
                  [value]="letterDraft()"
                  (input)="letterDraft.set($any($event.target).value)"
                ></textarea>
              } @else if (r.cover_letter) {
                <pre class="jb-letter mt-2">{{ r.cover_letter }}</pre>
              } @else {
                <p class="mt-2 text-sm text-neutral-500">
                  No letter yet. Runs draft one for roles scoring 70 or more;
                  you can write one here.
                </p>
              }
            </section>

            <section>
              <div class="flex flex-wrap items-center justify-between gap-2">
                <h2 class="jb-section-title">Application answers</h2>
                <div class="flex flex-wrap items-center gap-2">
                  <jb-model-picker [(value)]="answerModel" />
                  <button
                    type="button"
                    class="jb-btn"
                    (click)="answerEmpty(r)"
                    [disabled]="answering() || emptyAnswers() === 0"
                  >
                    {{
                      answering()
                        ? 'Answering…'
                        : 'Answer the empty ones (' + emptyAnswers() + ')'
                    }}
                  </button>
                </div>
              </div>
              @if (answerMethod(); as am) {
                <p class="mt-1 text-xs text-neutral-500">
                  {{
                    am.method === 'ai'
                      ? 'Answered by ' +
                        (am.model || 'the model') +
                        ' on your key.'
                      : 'Local template answers; anything marked [edit] needs your words.'
                  }}
                </p>
              }
              @if (answers().length === 0) {
                <p class="mt-2 text-sm text-neutral-500">
                  No screening questions yet. Paste the form's questions below
                  as you meet them; runs add the ones they find in postings.
                </p>
              }
              <dl class="mt-2 space-y-3 text-sm">
                @for (a of answers(); track a.id) {
                  <div>
                    <dt
                      class="flex items-start justify-between gap-2 font-semibold"
                    >
                      <span>{{ a.question }}</span>
                      <span class="flex shrink-0 gap-1">
                        @if (a.answer) {
                          <button
                            type="button"
                            class="jb-btn px-2 py-1"
                            (click)="copy(a.answer, 'Answer copied')"
                          >
                            Copy
                          </button>
                          <button
                            type="button"
                            class="jb-btn px-2 py-1"
                            (click)="answerOne(r, a.id)"
                            [disabled]="answering()"
                            title="Write this answer again"
                          >
                            Redo
                          </button>
                        }
                        <button
                          type="button"
                          class="jb-btn px-2 py-1"
                          (click)="removeQuestion(a.id)"
                          aria-label="Remove question"
                        >
                          ×
                        </button>
                      </span>
                    </dt>
                    <dd class="mt-1">
                      <textarea
                        class="jb-input min-h-16 text-sm"
                        [attr.aria-label]="'Answer: ' + a.question"
                        [value]="a.answer"
                        placeholder="Your answer…"
                        (change)="saveAnswer(a.id, $any($event.target).value)"
                      ></textarea>
                    </dd>
                  </div>
                }
              </dl>
              <form
                class="mt-3 flex flex-wrap gap-2"
                (submit)="$event.preventDefault(); addQuestion(r)"
              >
                <input
                  id="new-question"
                  class="jb-input min-w-0 flex-1 basis-64"
                  placeholder="Add a question from the application form…"
                  [value]="newQuestion()"
                  (input)="newQuestion.set($any($event.target).value)"
                />
                <button
                  type="submit"
                  class="jb-btn"
                  [disabled]="!newQuestion().trim()"
                >
                  Add question
                </button>
              </form>
            </section>
          }
          @case ('resume') {
            <jb-variant-panel [role]="r" />
          }
          @case ('prep') {
            <jb-prep-panel [role]="r" />
          }
          @case ('posting') {
            <section class="grid gap-4 text-sm md:grid-cols-2">
              <dl class="space-y-2">
                <div>
                  <dt class="jb-section-title">Link</dt>
                  <dd class="break-all">
                    <a
                      [href]="r.url"
                      target="_blank"
                      rel="noopener"
                      class="underline"
                      >{{ r.url }}</a
                    >
                  </dd>
                </div>
                <div>
                  <dt class="jb-section-title">Source</dt>
                  <dd>{{ r.source || '—' }}</dd>
                </div>
                <div>
                  <dt class="jb-section-title">Remote scope</dt>
                  <dd>{{ r.remote_scope || r.location || '—' }}</dd>
                </div>
                <div>
                  <dt class="jb-section-title">Pay</dt>
                  <dd>{{ r.salary || 'Not stated' }}</dd>
                </div>
                <div>
                  <dt class="jb-section-title">Posted</dt>
                  <dd>
                    {{ r.posted_at ? (r.posted_at | relativeDay) : 'Unknown' }}
                  </dd>
                </div>
                <div>
                  <dt class="jb-section-title">Found</dt>
                  <dd>{{ r.found_at | relativeDay }}</dd>
                </div>
              </dl>
              <div>
                <h2 class="jb-section-title">Stack named in the posting</h2>
                @if (r.stack.length) {
                  <div class="mt-2 flex flex-wrap gap-1.5">
                    @for (s of r.stack; track s) {
                      <span class="jb-tag">{{ s }}</span>
                    }
                  </div>
                } @else {
                  <p class="mt-2 text-neutral-500">None recorded.</p>
                }
                @if (r.posting_text) {
                  <h2 class="jb-section-title mt-6">Posting text (snapshot)</h2>
                  <pre class="jb-letter mt-2 max-h-96 overflow-auto">{{
                    r.posting_text
                  }}</pre>
                }
              </div>
            </section>
          }
          @case ('activity') {
            <section class="text-sm">
              @if (events().length === 0) {
                <p class="text-neutral-500">No activity recorded yet.</p>
              } @else {
                <ol class="space-y-2">
                  @for (e of events(); track e.id) {
                    <li class="flex gap-3">
                      <span
                        class="w-24 shrink-0 font-mono text-xs text-neutral-500"
                        >{{ e.created_at | relativeDay }}</span
                      >
                      <span>{{ describe(e) }}</span>
                    </li>
                  }
                </ol>
              }
            </section>
          }
        }

        <section>
          <h2 class="jb-section-title">Notes</h2>
          <textarea
            id="notes"
            class="jb-input mt-2 min-h-24 text-sm"
            placeholder="Recruiter name, interview dates, what they asked…"
            [value]="r.notes"
            (input)="noteChanged($any($event.target).value)"
          ></textarea>
          <p class="mt-1 text-xs text-neutral-500" role="status">
            {{ noteState() }}
          </p>
        </section>
      </article>
    } @else if (repo.loaded()) {
      <div class="jb-empty">
        <b>Role not found.</b> It may have been removed.
        <a routerLink="/roles" class="underline">Back to Roles</a>
      </div>
    } @else {
      <p class="text-sm text-neutral-500" role="status">Loading…</p>
    }
  `,
  styles: `
    .jb-tab {
      padding: 0.5rem 0.75rem;
      border-bottom: 2px solid transparent;
      font-size: 0.875rem;
      color: inherit;
      background: none;
      cursor: pointer;
    }
    .jb-tab-active {
      border-bottom-color: var(--color-brand-500);
      font-weight: 600;
    }
    .jb-tab:focus-visible {
      outline: 2px solid var(--color-brand-500);
      outline-offset: -2px;
    }
    .jb-letter {
      white-space: pre-wrap;
      font: inherit;
      font-size: 0.9rem;
      max-width: 72ch;
      padding: 0.75rem;
      border: 1px solid rgb(229 229 229);
      border-radius: 0.5rem;
      background: rgb(250 250 250);
    }
    @media (prefers-color-scheme: dark) {
      .jb-letter {
        border-color: rgb(46 55 60);
        background: rgb(23 28 31);
      }
    }
  `,
})
export class RoleDetail {
  protected readonly repo = inject(RolesRepo);
  private readonly toast = inject(Toast);

  /** Bound from the route by withComponentInputBinding. */
  readonly id = input.required<string>();

  readonly tabs: { id: Tab; label: string }[] = [
    { id: 'fit', label: 'Fit' },
    { id: 'resume', label: 'Resume' },
    { id: 'prep', label: 'Prep' },
    { id: 'posting', label: 'Posting' },
    { id: 'activity', label: 'Activity' },
  ];
  readonly tab = signal<Tab>('fit');
  readonly role = computed<RoleRow | undefined>(() =>
    this.repo.roles().find((r) => r.id === this.id()),
  );
  readonly band = computed(() => scoreBand(this.role()?.score ?? 0));
  readonly events = signal<RoleEventRow[]>([]);
  readonly answers = signal<ScreeningAnswerRow[]>([]);
  readonly editingLetter = signal(false);
  readonly letterDraft = signal('');
  readonly letterModel = signal('');
  readonly drafting = signal(false);
  readonly letterMethod = signal<{
    method: 'ai' | 'local';
    model?: string;
  } | null>(null);
  protected readonly letters = inject(LettersRepo);
  private readonly screening = inject(ScreeningRepo);
  readonly newQuestion = signal('');
  readonly answerModel = signal('');
  readonly answering = signal(false);
  readonly answerMethod = signal<{
    method: 'ai' | 'local';
    model?: string;
  } | null>(null);
  readonly emptyAnswers = computed(
    () => this.answers().filter((a) => !a.answer.trim()).length,
  );
  readonly letterWords = wordCount;
  readonly noteState = signal('');

  private noteTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    void this.repo.load();
    effect(() => {
      const id = this.id();
      untracked(() => void this.loadSide(id));
    });
  }

  private async loadSide(id: string) {
    const [events, answers] = await Promise.all([
      this.repo.eventsFor(id),
      this.repo.screeningAnswersFor(id),
    ]);
    this.events.set(events);
    this.answers.set(answers);
  }

  describe(e: RoleEventRow): string {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    switch (e.kind) {
      case 'status_change':
        return `Moved from ${label(p['from'])} to ${label(p['to'])}`;
      case 'ingested':
        return `Found by the daily run${p['source'] ? ` on ${p['source']}` : ''}, scored ${p['score']}`;
      case 'reminder':
        return `Reminder: in To apply for ${p['days']} days`;
      case 'generated':
        return `Generated ${p['what'] ?? 'content'}`;
      case 'note':
        return String(p['text'] ?? 'Note');
      default:
        return e.kind;
    }
  }

  async copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.toast.show(done);
    } catch {
      this.toast.show('Select the text and copy it manually');
    }
  }

  startEditLetter(r: RoleRow) {
    this.letterDraft.set(r.cover_letter);
    this.editingLetter.set(true);
  }

  async draftLetter(r: RoleRow, rewrite: boolean) {
    this.drafting.set(true);
    try {
      const res = await this.letters.generate(r.id, {
        model: this.letterModel() || undefined,
        rewrite,
      });
      this.letterMethod.set({ method: res.method, model: res.model });
      await this.repo.load();
      this.toast.show(rewrite ? 'Letter rewritten' : 'Letter drafted');
    } catch (e) {
      this.toast.show((e as Error).message || 'Could not draft the letter');
    } finally {
      this.drafting.set(false);
    }
  }

  async addQuestion(r: RoleRow) {
    const q = this.newQuestion().trim();
    if (!q) return;
    await this.screening.addQuestion(r.id, q);
    this.newQuestion.set('');
    await this.loadSide(r.id);
  }

  async saveAnswer(id: string, answer: string) {
    await this.screening.updateAnswer(id, answer);
    this.answers.update((as) =>
      as.map((a) => (a.id === id ? { ...a, answer } : a)),
    );
  }

  async removeQuestion(id: string) {
    await this.screening.remove(id);
    this.answers.update((as) => as.filter((a) => a.id !== id));
  }

  answerEmpty(r: RoleRow) {
    return this.runAnswer(r, undefined);
  }

  answerOne(r: RoleRow, id: string) {
    return this.runAnswer(r, [id]);
  }

  private async runAnswer(r: RoleRow, ids: string[] | undefined) {
    this.answering.set(true);
    try {
      const res = await this.screening.answer(r.id, {
        ids,
        model: this.answerModel() || undefined,
      });
      this.answerMethod.set({ method: res.method, model: res.model });
      await this.loadSide(r.id);
      this.toast.show(
        res.answered
          ? `${res.answered} answer${res.answered === 1 ? '' : 's'} written`
          : 'Nothing to answer',
      );
    } catch (e) {
      this.toast.show((e as Error).message || 'Could not write answers');
    } finally {
      this.answering.set(false);
    }
  }

  async saveLetter() {
    const r = this.role();
    if (!r) return;
    await this.repo.setCoverLetter(r.id, this.letterDraft());
    this.editingLetter.set(false);
    this.toast.show('Cover letter saved');
  }

  noteChanged(value: string) {
    const r = this.role();
    if (!r) return;
    this.noteState.set('Saving…');
    clearTimeout(this.noteTimer);
    this.noteTimer = setTimeout(async () => {
      try {
        await this.repo.setNotes(r.id, value);
        this.noteState.set('Saved');
      } catch {
        this.noteState.set('Could not save notes');
      }
    }, 600);
  }
}

function label(v: unknown): string {
  return (
    ROLE_STATUS_LABELS[v as keyof typeof ROLE_STATUS_LABELS] ?? String(v ?? '')
  );
}
