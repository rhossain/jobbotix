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
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  ATS_LABEL,
  ROLE_STATUS_LABELS,
  formatYearly,
  meetsMinimum,
  parseSalary,
  postingHealth,
  yearlyIn,
  type AtsKind,
  type RoleEventRow,
  type RoleRow,
  type PostingSeenOn,
  type ScreeningAnswerRow,
} from '@jobbotix/shared-types';
import {
  LettersRepo,
  RolesRepo,
  ScreeningRepo,
  SearchProfileRepo,
  WatchlistRepo,
} from '../../core/data/repos';
import { ModelPicker } from '../../shared/model-picker';
import { ShareButton } from '../../shared/share-button';
import { RelativeDayPipe, TypeLabelPipe } from '../../shared/format';
import { StatusSelect } from '../../shared/status-select';
import { Toast } from '../../shared/toast';
import { ShellState } from '../../shell/shell-state';
import { Viewport } from '../../core/viewport';
import {
  BackLink,
  Button,
  Confirm,
  CopyButton,
  EmptyState,
  FieldControl,
  Icon,
  MatchRing,
  Skeleton,
  Tabs,
  type TabItem,
} from '../../ui';
import { CompanyPanel } from './company-panel';
import { PrepPanel } from './prep-panel';
import { InterviewsPanel } from './interviews-panel';
import { RolePeople } from './role-people';
import { VariantPanel } from './variant-panel';
import { wordCount } from '@jobbotix/shared-types';

type Tab =
  'fit' | 'company' | 'resume' | 'prep' | 'interviews' | 'posting' | 'activity';

@Component({
  selector: 'jb-role-detail',
  imports: [
    BackLink,
    Button,
    CompanyPanel,
    CopyButton,
    EmptyState,
    FieldControl,
    Icon,
    MatchRing,
    ModelPicker,
    PrepPanel,
    InterviewsPanel,
    RolePeople,
    RelativeDayPipe,
    RouterLink,
    ShareButton,
    Skeleton,
    StatusSelect,
    Tabs,
    TypeLabelPipe,
    VariantPanel,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (role(); as r) {
      <article [class.print:hidden]="tab() === 'resume'">
        <jb-back-link
          class="mb-5 hidden md:inline-block"
          link="/roles"
          label="Roles"
        />

        <!-- Hero -->
        <header
          class="flex flex-col gap-5 md:flex-row md:items-start md:justify-between md:gap-8"
        >
          <div class="flex min-w-0 items-start gap-4 md:gap-6">
            <jb-match-ring
              [score]="r.score"
              [size]="viewport.phone() ? 'md' : 'lg'"
              [transitionName]="'ring-' + r.id"
            />
            <div class="min-w-0">
              <h1
                class="text-[1.625rem] leading-tight font-semibold tracking-tight text-ink md:text-3xl"
              >
                {{ r.title }}
              </h1>
              <p class="mt-1 text-ink-muted md:text-lg">{{ r.company }}</p>
              <div class="mt-3 flex flex-wrap gap-1.5">
                @for (b of health().badges; track b.kind) {
                  <span
                    class="jb-tag"
                    [class.jb-tag-warn]="b.tone === 'warn'"
                    [class.jb-tag-bad]="b.tone === 'bad'"
                    [title]="b.detail"
                    >{{ b.label }}</span
                  >
                }
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
              </div>
            </div>
          </div>
          <div
            class="flex flex-wrap items-center gap-2 md:shrink-0 md:justify-end"
          >
            <a
              jbButton="primary"
              class="flex-1 md:flex-none"
              [href]="r.url"
              target="_blank"
              rel="noopener"
            >
              Open posting <jb-icon name="arrow-up-right" [size]="17" />
            </a>
            <jb-share-button kind="role" [roleId]="r.id" />
            <jb-status-select [role]="r" />
          </div>
        </header>

        <div
          class="mt-8 grid grid-cols-1 gap-8"
          [class.lg:grid-cols-[minmax(0,1fr)_18rem]]="tab() !== 'resume'"
          [class.xl:grid-cols-[minmax(0,1fr)_20rem]]="tab() !== 'resume'"
        >
          <div class="min-w-0">
            <jb-tabs
              prefix="role"
              label="Role sections"
              [tabs]="tabs"
              [value]="tab()"
              (valueChange)="tab.set($any($event))"
            />
            <div
              role="tabpanel"
              class="pt-6"
              tabindex="0"
              [id]="'role-panel-' + tab()"
              [attr.aria-labelledby]="'role-tab-' + tab()"
            >
              @switch (tab()) {
                @case ('fit') {
                  <div class="flex flex-col gap-5">
                    @if (unscored()) {
                      <section
                        class="jb-card flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between"
                      >
                        <div class="min-w-0">
                          <h2 class="font-semibold text-ink">Not scored yet</h2>
                          <p class="mt-1 text-sm text-ink-muted">
                            Score it against your search profile, the same way
                            the morning run scores what it finds.
                          </p>
                        </div>
                        <button
                          type="button"
                          jbButton="primary"
                          class="shrink-0"
                          [busy]="scoring()"
                          [disabled]="scoring()"
                          (click)="rescore(r)"
                        >
                          <jb-icon name="target" /> Score this role
                        </button>
                      </section>
                    }
                    <div class="grid gap-4 md:grid-cols-2">
                      <section class="jb-card p-5">
                        <h2
                          class="flex items-center gap-2 font-semibold text-ink"
                        >
                          <jb-icon name="circle-check" class="text-good" /> Why
                          it fits
                        </h2>
                        @if (r.reasons.length) {
                          <ul
                            class="mt-3 flex flex-col gap-2.5 text-sm wrap-anywhere"
                          >
                            @for (x of r.reasons; track $index) {
                              <li class="flex gap-2.5">
                                <span
                                  class="mt-2 size-1.5 shrink-0 rounded-full bg-good"
                                ></span>
                                <span class="min-w-0">{{ x }}</span>
                              </li>
                            }
                          </ul>
                        } @else {
                          <p class="mt-3 text-sm text-ink-muted">
                            {{
                              unscored()
                                ? 'Score the role to see why it fits.'
                                : 'The run gave no reasons for this one.'
                            }}
                          </p>
                        }
                      </section>
                      <section class="jb-card p-5">
                        <h2
                          class="flex items-center gap-2 font-semibold text-ink"
                        >
                          <jb-icon
                            name="triangle-exclamation-point"
                            class="text-warn"
                          />
                          Watch out
                        </h2>
                        @if (r.gaps.length) {
                          <ul
                            class="mt-3 flex flex-col gap-2.5 text-sm wrap-anywhere"
                          >
                            @for (x of r.gaps; track $index) {
                              <li class="flex gap-2.5">
                                <span
                                  class="mt-2 size-1.5 shrink-0 rounded-full bg-warn"
                                ></span>
                                <span class="min-w-0">{{ x }}</span>
                              </li>
                            }
                          </ul>
                        } @else {
                          <p class="mt-3 text-sm text-ink-muted">
                            {{
                              unscored()
                                ? 'Not scored yet.'
                                : 'Nothing flagged.'
                            }}
                          </p>
                        }
                      </section>
                    </div>
                    @if (!unscored()) {
                      <div
                        class="-mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted"
                      >
                        <span>{{ scoredLine() }}</span>
                        <button
                          type="button"
                          jbButton="ghost"
                          size="sm"
                          [busy]="scoring()"
                          [disabled]="scoring()"
                          (click)="rescore(r)"
                        >
                          <jb-icon name="rotate-cw" [size]="15" /> Re-score
                        </button>
                      </div>
                    }

                    <!-- Cover letter -->
                    <section
                      class="jb-card p-5 md:p-6"
                      aria-labelledby="letter-heading"
                    >
                      <div
                        class="flex flex-wrap items-center justify-between gap-3"
                      >
                        <h2
                          id="letter-heading"
                          class="text-lg font-semibold text-ink"
                        >
                          Cover letter
                        </h2>
                        <div class="flex flex-wrap items-center gap-2">
                          @if (editingLetter()) {
                            <button
                              type="button"
                              jbButton="ghost"
                              (click)="editingLetter.set(false)"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              jbButton="primary"
                              [busy]="savingLetter()"
                              (click)="saveLetter()"
                            >
                              Save letter
                            </button>
                          } @else {
                            @if (r.cover_letter) {
                              <jb-copy-button
                                [text]="r.cover_letter"
                                confirm="Cover letter copied"
                              />
                            }
                            <button
                              type="button"
                              jbButton
                              (click)="startEditLetter(r)"
                            >
                              <jb-icon name="pencil" />
                              {{ r.cover_letter ? 'Edit' : 'Write one' }}
                            </button>
                            <button
                              type="button"
                              jbButton
                              [busy]="drafting()"
                              [disabled]="drafting()"
                              (click)="draftLetter(r, !!r.cover_letter)"
                            >
                              <jb-icon name="sparkles" />
                              {{ r.cover_letter ? 'Rewrite' : 'Draft one' }}
                            </button>
                          }
                        </div>
                      </div>
                      <div
                        class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-ink-muted"
                      >
                        @if (!editingLetter()) {
                          <jb-model-picker
                            [(value)]="letterModel"
                            job="letter"
                          />
                        }
                        @if (r.cover_letter) {
                          <span
                            >{{
                              letterWords(
                                editingLetter() ? letterDraft() : r.cover_letter
                              )
                            }}
                            words</span
                          >
                        }
                        @if (letterMethod(); as lm) {
                          <span>
                            {{
                              lm.method === 'ai'
                                ? 'Written by ' +
                                  (lm.model || 'the model') +
                                  ' on your key'
                                : 'Local draft from your resume (no model call)'
                            }}
                          </span>
                        }
                        @if (letters.voiceSamples().length === 0) {
                          <span>
                            Add
                            <a
                              routerLink="/settings"
                              class="text-brand-ink underline"
                              >voice samples</a
                            >
                            so drafts sound like you
                          </span>
                        }
                      </div>
                      <div class="mt-4">
                        @if (editingLetter()) {
                          <textarea
                            jbInput
                            [autogrow]="true"
                            id="letter"
                            aria-label="Cover letter"
                            class="min-h-64 leading-relaxed"
                            [value]="letterDraft()"
                            (input)="letterDraft.set($any($event.target).value)"
                          ></textarea>
                        } @else if (r.cover_letter) {
                          <pre class="jb-letter">{{ r.cover_letter }}</pre>
                        } @else {
                          <p class="text-sm text-ink-muted">
                            No letter yet. Runs draft one for roles scoring 70
                            or more; draft or write one here.
                          </p>
                        }
                      </div>
                    </section>

                    <!-- Application answers -->
                    <section
                      class="jb-card p-5 md:p-6"
                      aria-labelledby="answers-heading"
                    >
                      <div
                        class="flex flex-wrap items-center justify-between gap-3"
                      >
                        <h2
                          id="answers-heading"
                          class="flex items-center gap-2 text-lg font-semibold text-ink"
                        >
                          Application answers
                          @if (answers().length) {
                            <span class="jb-count">{{ answers().length }}</span>
                          }
                        </h2>
                        <div class="flex flex-wrap items-center gap-2">
                          <jb-model-picker
                            [(value)]="answerModel"
                            [quiet]="true"
                            job="answer"
                          />
                          <button
                            type="button"
                            jbButton
                            [busy]="answering()"
                            [disabled]="answering() || emptyAnswers() === 0"
                            (click)="answerEmpty(r)"
                          >
                            <jb-icon name="sparkles" /> Answer the empty ones
                            @if (emptyAnswers()) {
                              <span class="jb-count">{{ emptyAnswers() }}</span>
                            }
                          </button>
                        </div>
                      </div>
                      @if (answerMethod(); as am) {
                        <p class="mt-2 text-xs text-ink-muted">
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
                        <p class="mt-3 text-sm text-ink-muted">
                          No screening questions yet. Paste the form's questions
                          below as you meet them; runs add the ones they find in
                          postings.
                        </p>
                      }
                      <dl class="mt-4 flex flex-col gap-5">
                        @for (a of answers(); track a.id) {
                          <div class="flex flex-col gap-2">
                            <dt class="flex items-start justify-between gap-3">
                              <span
                                class="pt-1.5 text-sm font-semibold text-ink"
                                >{{ a.question }}</span
                              >
                              <span class="flex shrink-0 gap-1">
                                @if (a.answer) {
                                  <jb-copy-button
                                    [text]="a.answer"
                                    [iconOnly]="true"
                                    variant="ghost"
                                    label="Copy answer"
                                  />
                                  <button
                                    type="button"
                                    jbButton="ghost"
                                    iconOnly
                                    aria-label="Write this answer again"
                                    title="Write this answer again"
                                    [disabled]="answering()"
                                    (click)="answerOne(r, a.id)"
                                  >
                                    <jb-icon name="rotate-cw" />
                                  </button>
                                }
                                <button
                                  type="button"
                                  jbButton="ghost"
                                  iconOnly
                                  aria-label="Remove question"
                                  title="Remove question"
                                  (click)="removeQuestion(a)"
                                >
                                  <jb-icon name="trash" />
                                </button>
                              </span>
                            </dt>
                            <dd class="m-0">
                              <textarea
                                jbInput
                                [autogrow]="true"
                                rows="3"
                                class="text-sm"
                                [attr.aria-label]="'Answer: ' + a.question"
                                [value]="a.answer"
                                placeholder="Your answer"
                                (change)="
                                  saveAnswer(a.id, $any($event.target).value)
                                "
                              ></textarea>
                            </dd>
                          </div>
                        }
                      </dl>
                      <form
                        class="mt-5 flex flex-col gap-2 border-t border-line pt-5 sm:flex-row"
                        (submit)="$event.preventDefault(); addQuestion(r)"
                      >
                        <input
                          jbInput
                          id="new-question"
                          class="min-w-0 flex-1"
                          aria-label="New question"
                          placeholder="Add a question from the application form"
                          [value]="newQuestion()"
                          (input)="newQuestion.set($any($event.target).value)"
                        />
                        <button
                          type="submit"
                          jbButton
                          [disabled]="!newQuestion().trim()"
                        >
                          <jb-icon name="plus" /> Add question
                        </button>
                      </form>
                    </section>
                  </div>
                }
                @case ('resume') {
                  <jb-variant-panel [role]="r" />
                }
                @case ('company') {
                  <jb-company-panel [role]="r" />
                }
                @case ('prep') {
                  <jb-prep-panel [role]="r" />
                }
                @case ('interviews') {
                  <jb-interviews-panel [role]="r" />
                }
                @case ('posting') {
                  <div class="flex flex-col gap-5">
                    <section class="jb-card p-5">
                      <h2 class="font-semibold text-ink">
                        Stack named in the posting
                      </h2>
                      @if (r.stack.length) {
                        <div class="mt-3 flex flex-wrap gap-1.5">
                          @for (st of r.stack; track st) {
                            <span class="jb-tag">{{ st }}</span>
                          }
                        </div>
                      } @else {
                        <p class="mt-2 text-sm text-ink-muted">
                          None recorded.
                        </p>
                      }
                    </section>
                    <section class="jb-card p-5">
                      <h2 class="font-semibold text-ink">Link</h2>
                      <a
                        [href]="r.url"
                        target="_blank"
                        rel="noopener"
                        class="mt-2 block text-sm break-all text-brand-ink underline"
                        >{{ r.url }}</a
                      >
                    </section>
                    @if (r.posting_text) {
                      <section>
                        <h2 class="font-semibold text-ink">
                          Posting text (snapshot)
                        </h2>
                        <pre
                          class="jb-letter mt-3 max-h-[32rem] max-w-none overflow-auto text-sm"
                          >{{ r.posting_text }}</pre>
                      </section>
                    }
                  </div>
                }
                @case ('activity') {
                  @if (events().length === 0) {
                    <p class="text-sm text-ink-muted">
                      No activity recorded yet.
                    </p>
                  } @else {
                    <ol class="jb-timeline">
                      @for (e of events(); track e.id) {
                        <li>
                          <span class="text-sm text-ink">{{
                            describe(e)
                          }}</span>
                          <span class="text-xs text-ink-faint">{{
                            e.created_at | relativeDay
                          }}</span>
                        </li>
                      }
                    </ol>
                  }
                }
              }
            </div>
          </div>

          <!-- Side column -->
          <aside
            class="gap-4"
            [class]="
              tab() === 'resume'
                ? 'grid md:grid-cols-2 md:items-start'
                : 'flex flex-col lg:sticky lg:top-8 lg:self-start'
            "
          >
            <section class="jb-card p-4 md:p-5">
              <div class="flex items-center justify-between gap-2">
                <h2 class="font-semibold text-ink">
                  <label for="notes">Notes</label>
                </h2>
                <span class="text-xs text-ink-faint" role="status">{{
                  noteState()
                }}</span>
              </div>
              <textarea
                jbInput
                [autogrow]="true"
                id="notes"
                rows="4"
                class="mt-3 text-sm"
                placeholder="Recruiter name, interview dates, what they asked"
                [value]="r.notes"
                (input)="noteChanged($any($event.target).value)"
              ></textarea>
            </section>
            <section class="jb-card p-4 md:p-5">
              <h2 class="font-semibold text-ink">At a glance</h2>
              <dl
                class="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm"
              >
                <dt class="text-ink-muted">Pay</dt>
                <dd class="m-0 text-right text-ink">
                  {{ r.salary || 'Not stated' }}
                  @if (pay().yearly) {
                    <span class="block text-xs text-ink-muted">{{
                      pay().yearly
                    }}</span>
                  }
                  @if (pay().belowMinimum) {
                    <span class="block text-xs text-warn"
                      >Below your minimum</span
                    >
                  }
                </dd>
                <dt class="text-ink-muted">Remote</dt>
                <dd class="m-0 text-right text-ink">
                  {{ r.remote_scope || r.location || 'Not stated' }}
                </dd>
                <dt class="text-ink-muted">Posted</dt>
                <dd class="m-0 text-right text-ink">
                  {{ r.posted_at ? (r.posted_at | relativeDay) : 'Unknown' }}
                </dd>
                <dt class="text-ink-muted">Found</dt>
                <dd class="m-0 text-right text-ink">
                  {{ r.found_at | relativeDay }}
                </dd>
                <dt class="text-ink-muted">Found on</dt>
                <dd class="m-0 text-right text-ink">
                  @for (
                    s of seenOn();
                    track s.sourceId + s.url;
                    let last = $last
                  ) {
                    <a
                      class="underline decoration-line underline-offset-2 hover:text-brand-ink"
                      [href]="s.url"
                      target="_blank"
                      rel="noopener"
                      >{{ s.name }}</a
                    >{{ last ? '' : ', ' }}
                  } @empty {
                    {{ r.source || 'Unknown' }}
                  }
                </dd>
                @if (foundBy(); as name) {
                  <dt class="text-ink-muted">Found by</dt>
                  <dd class="m-0 text-right text-ink">{{ name }} profile</dd>
                }
              </dl>
              @if (health().badges.length) {
                <ul
                  class="mt-4 flex flex-col gap-2 border-t border-line pt-3 text-sm"
                  aria-label="Posting warnings"
                >
                  @for (b of health().badges; track b.kind) {
                    <li class="flex gap-2">
                      <jb-icon
                        name="triangle-exclamation-point"
                        [size]="16"
                        class="mt-0.5 shrink-0"
                        [class.text-warn]="b.tone === 'warn'"
                        [class.text-bad]="b.tone === 'bad'"
                      />
                      <span class="text-ink-muted">{{ b.detail }}</span>
                    </li>
                  }
                </ul>
              }
              @if (careers(); as c) {
                <div
                  class="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-sm"
                >
                  <span class="min-w-0 text-ink-muted wrap-anywhere">
                    {{ c.name || r.company }} hires on {{ atsLabel[c.kind] }}
                  </span>
                  <button
                    type="button"
                    jbButton
                    size="sm"
                    [busy]="followBusy()"
                    [disabled]="followBusy()"
                    [attr.aria-pressed]="followingId() ? 'true' : 'false'"
                    (click)="toggleFollow(r)"
                  >
                    {{ followingId() ? 'Following' : 'Follow company' }}
                  </button>
                </div>
              }
            </section>
            <jb-role-people [role]="r" />
          </aside>
        </div>
      </article>
    } @else if (repo.loaded()) {
      <jb-empty-state title="Role not found" icon="briefcase">
        It may have been removed, or the link is from another account.
        <div actions>
          <a jbButton routerLink="/roles"
            ><jb-icon name="chevron-left" /> Back to Roles</a
          >
        </div>
      </jb-empty-state>
    } @else {
      <div class="flex flex-col gap-6">
        <jb-skeleton shape="card" [count]="1" />
        <jb-skeleton shape="line" [count]="5" />
      </div>
    }
  `,
  styles: `
    .jb-timeline {
      position: relative;
      margin: 0;
      padding: 0 0 0 1.5rem;
      list-style: none;
    }
    .jb-timeline::before {
      content: '';
      position: absolute;
      top: 0.4rem;
      bottom: 0.4rem;
      left: 0.3rem;
      width: 2px;
      border-radius: 2px;
      background: var(--line);
    }
    .jb-timeline li {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      padding-bottom: 1.25rem;
    }
    .jb-timeline li::before {
      content: '';
      position: absolute;
      top: 0.3rem;
      left: -1.5rem;
      width: 0.75rem;
      height: 0.75rem;
      border: 2px solid var(--brand);
      border-radius: 50%;
      background: var(--surface-canvas);
    }
    .jb-timeline li:first-child::before {
      background: var(--brand);
    }
  `,
})
export class RoleDetail {
  protected readonly viewport = inject(Viewport);
  protected readonly repo = inject(RolesRepo);
  private readonly toast = inject(Toast);
  private readonly confirm = inject(Confirm);
  readonly savingLetter = signal(false);

  /** Bound from the route by withComponentInputBinding. */
  readonly id = input.required<string>();

  readonly tabs: TabItem<Tab>[] = [
    { id: 'fit', label: 'Fit', icon: 'target' },
    { id: 'company', label: 'Company', icon: 'building' },
    { id: 'resume', label: 'Resume', icon: 'file-text' },
    { id: 'prep', label: 'Prep', icon: 'lightbulb' },
    { id: 'interviews', label: 'Interviews', icon: 'calendar' },
    { id: 'posting', label: 'Posting', icon: 'briefcase' },
    { id: 'activity', label: 'Activity', icon: 'clock' },
  ];
  readonly tab = signal<Tab>('fit');
  readonly scoring = signal(false);
  /** Added by hand before scoring on add existed (or with no search profile then). */
  readonly unscored = computed(() => {
    const r = this.role();
    return !!r && r.score === 0 && !r.reasons.length && !r.gaps.length;
  });
  readonly scoredLine = computed(() => {
    const b = (this.role()?.score_breakdown ?? {}) as Record<string, unknown>;
    const by =
      b['method'] === 'ai'
        ? 'Scored by the model on your key'
        : b['method'] === 'heuristic'
          ? 'Scored by keyword rules'
          : 'Scored by the morning run';
    return b['added_by_hand'] ? `${by}, against your search profile` : by;
  });
  readonly role = computed<RoleRow | undefined>(() =>
    this.repo.roles().find((r) => r.id === this.id()),
  );
  readonly events = signal<RoleEventRow[]>([]);
  readonly answers = signal<ScreeningAnswerRow[]>([]);
  readonly seenOn = signal<PostingSeenOn[]>([]);
  private readonly profileRepo = inject(SearchProfileRepo);
  /**
   * The search profile that filed this role, named only when the account
   * searches with several.
   */
  readonly foundBy = computed(() => {
    const all = this.profileRepo.profiles();
    const id = this.role()?.search_profile_id;
    return all.length > 1 && id
      ? (all.find((p) => p.id === id)?.name ?? '')
      : '';
  });
  /**
   * The pay line as a yearly figure (in the currency of the user's minimum,
   * else its own) when it is hourly, monthly or in another currency, and
   * whether it falls short of the minimum.
   */
  readonly pay = computed(() => {
    const range = parseSalary(this.role()?.salary);
    if (!range) return { yearly: '', belowMinimum: false };
    const ex = (this.profileRepo.profile()?.exclusions ?? {}) as Record<
      string,
      unknown
    >;
    const minimum = Number(ex['min_salary'] ?? 0);
    const minCur = String(ex['min_salary_currency'] || '');
    const target = (minimum > 0 && minCur) || range.currency || 'USD';
    let yearly = '';
    if (range.period !== 'year' || (range.currency || target) !== target) {
      const y = yearlyIn(range, target);
      if (y && (y.min !== null || y.max !== null)) {
        const text =
          y.min !== null && y.max !== null && y.min !== y.max
            ? `${formatYearly(y.min, target)}–${formatYearly(y.max, '')}`
            : formatYearly((y.max ?? y.min) as number, target);
        yearly = `≈ ${text} a year`;
      }
    }
    return {
      yearly,
      belowMinimum: meetsMinimum(range, minimum, minCur || 'USD') === false,
    };
  });
  /** Age, relisting and closure warnings from the shared pool. */
  readonly health = computed(() => {
    const r = this.role();
    return r
      ? postingHealth(r, this.repo.postingFacts()[r.id], new Date())
      : { ageDays: null, badges: [] };
  });
  private readonly watchlist = inject(WatchlistRepo);
  readonly atsLabel = ATS_LABEL;
  /** The careers system behind this role, when Jobbotix can poll it. */
  readonly careers = signal<{
    kind: AtsKind;
    slug: string;
    name: string;
  } | null>(null);
  /** The followed company's id, when the user follows it. */
  readonly followingId = signal<string | null>(null);
  readonly followBusy = signal(false);
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
    if (!this.profileRepo.loaded()) void this.profileRepo.load();
    // ?tab=interviews (from Today and the digest) opens that tab
    const wanted = inject(ActivatedRoute).snapshot.queryParamMap.get('tab');
    if (wanted && this.tabs.some((t) => t.id === wanted))
      this.tab.set(wanted as Tab);
    inject(ShellState).usePageAction({
      label: 'Open posting',
      icon: 'arrow-up-right',
      run: () => undefined,
      href: () => this.role()?.url ?? null,
    });
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

  private readonly loadSeenOn = effect(() => {
    const r = this.role();
    if (!r) return;
    untracked(
      () =>
        void this.repo.seenOn(r).then((list) => {
          if (this.role()?.id === r.id) this.seenOn.set(list);
        }),
    );
  });

  private readonly loadCareers = effect(() => {
    const r = this.role();
    if (!r) return;
    untracked(() => void this.refreshFollow(r));
  });

  private async refreshFollow(r: RoleRow) {
    const [c, follows] = await Promise.all([
      this.watchlist.companyFor(r),
      this.watchlist.followed(),
    ]);
    if (this.role()?.id !== r.id) return;
    this.careers.set(c);
    const hit = c
      ? follows.find(
          (f) => f.company.ats_kind === c.kind && f.company.ats_slug === c.slug,
        )
      : undefined;
    this.followingId.set(hit?.company.id ?? null);
  }

  async toggleFollow(r: RoleRow) {
    const c = this.careers();
    if (!c || this.followBusy()) return;
    this.followBusy.set(true);
    const name = c.name || r.company;
    try {
      const id = this.followingId();
      if (id) {
        await this.watchlist.unfollow(id);
        this.toast.show(`Stopped following ${name}`);
      } else {
        await this.watchlist.follow(c.kind, c.slug, name);
        this.toast.success(
          `Following ${name}. Its new roles are checked every hour.`,
        );
      }
      await this.refreshFollow(r);
    } catch (e) {
      this.toast.error(`Could not update the follow: ${(e as Error).message}`);
    } finally {
      this.followBusy.set(false);
    }
  }

  describe(e: RoleEventRow): string {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    switch (e.kind) {
      case 'status_change':
        return `Moved from ${label(p['from'])} to ${label(p['to'])}`;
      case 'ingested':
        if (p['method'])
          return `Found by Jobbotix${p['source'] ? ` on ${p['source']}` : ''}, scored ${p['score']}${p['method'] === 'ai' ? ' by the model' : ' on keywords'}`;
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

  startEditLetter(r: RoleRow) {
    this.letterDraft.set(r.cover_letter);
    this.editingLetter.set(true);
  }

  async rescore(r: RoleRow) {
    if (this.scoring()) return;
    const before = r.score;
    this.scoring.set(true);
    try {
      const res = await this.repo.rescore(r.id);
      this.toast.show(
        res.score === before
          ? `Score unchanged at ${res.score}`
          : `Scored ${res.score}`,
      );
      if (res.aiError) this.toast.show(`Model step skipped: ${res.aiError}`);
    } catch (e) {
      this.toast.show((e as Error).message || 'Could not score the role');
    } finally {
      this.scoring.set(false);
    }
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
      this.toast.success(rewrite ? 'Letter rewritten' : 'Letter drafted');
    } catch (e) {
      this.toast.show((e as Error).message || 'Could not draft the letter');
    } finally {
      this.drafting.set(false);
    }
  }

  async addQuestion(r: RoleRow) {
    const q = this.newQuestion().trim();
    if (!q) return;
    try {
      await this.screening.addQuestion(r.id, q);
      this.newQuestion.set('');
      await this.loadSide(r.id);
    } catch {
      this.toast.error('Could not add the question');
    }
  }

  async saveAnswer(id: string, answer: string) {
    try {
      await this.screening.updateAnswer(id, answer);
      this.answers.update((as) =>
        as.map((a) => (a.id === id ? { ...a, answer } : a)),
      );
      this.toast.show('Answer saved');
    } catch {
      this.toast.error('Could not save the answer');
    }
  }

  async removeQuestion(a: ScreeningAnswerRow) {
    const ok = await this.confirm.ask({
      title: 'Remove this question?',
      body: a.answer
        ? 'The question and its answer are deleted.'
        : 'The question is deleted.',
      action: 'Remove question',
      danger: true,
    });
    if (!ok) return;
    try {
      await this.screening.remove(a.id);
      this.answers.update((as) => as.filter((x) => x.id !== a.id));
    } catch {
      this.toast.error('Could not remove the question');
    }
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
    this.savingLetter.set(true);
    try {
      await this.repo.setCoverLetter(r.id, this.letterDraft());
      this.editingLetter.set(false);
      this.toast.success('Cover letter saved');
    } catch {
      this.toast.error('Could not save the cover letter');
    } finally {
      this.savingLetter.set(false);
    }
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
