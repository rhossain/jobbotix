import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ResumeSections, VariantChange } from '@jobbotix/shared-types';
import { ResumesRepo, SettingsRepo } from '../../core/data/repos';
import { Plan } from '../../core/plan';
import { ModelPicker } from '../../shared/model-picker';
import { Icon } from '../../ui';

/** The text a change points at, or null when the resume has no such field. */
export function textAt(sections: ResumeSections, path: string): string | null {
  let at: unknown = sections;
  for (const key of path.split('.')) {
    if (at === null || typeof at !== 'object') return null;
    at = (at as Record<string, unknown>)[key];
  }
  return typeof at === 'string' ? at : null;
}

/** "Experience · Northwind · bullet 2": where a change is, in the user's words. */
export function reviewLabel(sections: ResumeSections, path: string): string {
  const p = path.split('.');
  if (p[0] === 'summary') return 'Summary';
  if (p[0] === 'contact') return 'Headline';
  if (p[0] === 'experience') {
    const e = sections.experience[Number(p[1])];
    const where = e?.company || e?.title || `role ${Number(p[1]) + 1}`;
    return `Experience · ${where} · bullet ${Number(p[3]) + 1}`;
  }
  if (p[0] === 'projects') {
    const name = sections.projects[Number(p[1])]?.name;
    return `Project · ${name || Number(p[1]) + 1}`;
  }
  return path;
}

/**
 * The accepted changes that still fit: the resume says today what the
 * review read. One whose text was edited since is left out, never applied
 * over the user's newer wording.
 */
export function stillFitting(
  sections: ResumeSections,
  changes: VariantChange[],
): VariantChange[] {
  return changes.filter(
    (c) => c.decision === 'accepted' && textAt(sections, c.path) === c.before,
  );
}

/**
 * Reviews the resume in the editor with a model. The model proposes
 * rewrites and removals with a reason each; the user accepts or rejects
 * them, and the accepted ones go into the editor. Nothing is saved here.
 */
@Component({
  selector: 'jb-resume-review',
  imports: [Icon, ModelPicker, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="jb-card flex flex-col gap-4 p-5 md:p-6">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <h2 class="jb-section-title">Review with AI</h2>
          <p class="mt-1 text-sm text-ink-muted">
            A model reads the resume as it is in the editor and proposes
            rewrites: bullets that state a duty, filler, a long summary,
            grammar. It never adds facts. You accept or reject each one, and
            nothing is saved until you press Save version. The model is sent the
            wording, not your name or contact details.
          </p>
        </div>
        <button
          type="button"
          class="jb-btn jb-btn-ghost jb-btn-icon"
          aria-label="Close review"
          (click)="closed.emit()"
        >
          <jb-icon name="x" />
        </button>
      </div>

      @if (hasKey()) {
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="jb-btn-primary"
            [disabled]="busy()"
            [attr.aria-busy]="busy() ? 'true' : null"
            (click)="review()"
          >
            <jb-icon
              [name]="busy() ? 'loader-circle' : 'sparkles'"
              [size]="16"
              [class.animate-spin]="busy()"
            />
            {{
              busy()
                ? 'Reviewing…'
                : changes()
                  ? 'Review again'
                  : 'Review my resume'
            }}
          </button>
          <jb-model-picker [(value)]="model" [quiet]="true" job="tailor" />
        </div>
      } @else {
        <p class="text-sm text-ink-muted">
          A review needs a model.
          <a routerLink="/settings" class="text-brand-ink underline"
            >Connect an AI provider</a
          >
          first; Gemini and Groq have free tiers.
        </p>
      }

      @if (busy()) {
        <p class="text-sm text-ink-muted" role="status">
          Reading your resume. This can take up to a minute.
        </p>
      }
      @if (error()) {
        <p class="text-sm text-bad" role="alert">{{ error() }}</p>
      }

      @if (changes(); as list) {
        <div
          class="flex flex-col gap-3 border-t border-line pt-3"
          aria-live="polite"
        >
          @if (list.length === 0) {
            <p class="text-sm">
              No changes proposed: the model found nothing it would reword.
            </p>
          } @else {
            <div class="flex flex-wrap items-center justify-between gap-2">
              <p class="text-sm">
                <b>{{ list.length }}</b>
                {{ list.length === 1 ? 'suggestion' : 'suggestions' }}
                @if (reviewedBy()) {
                  <span class="text-ink-muted"> · {{ reviewedBy() }}</span>
                }
              </p>
              <div class="flex gap-2">
                <button
                  type="button"
                  class="jb-btn jb-btn-ghost text-sm"
                  (click)="decideAll('accepted')"
                >
                  Accept all
                </button>
                <button
                  type="button"
                  class="jb-btn jb-btn-ghost text-sm"
                  (click)="decideAll('rejected')"
                >
                  Reject all
                </button>
              </div>
            </div>
            @for (c of list; track c.id) {
              <article
                class="rounded-card border border-line p-4 text-sm transition-opacity"
                [class.opacity-55]="c.decision === 'rejected'"
              >
                <div
                  class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2"
                >
                  <span class="min-w-0 text-xs font-medium text-ink-muted"
                    >{{ label(c.path) }} ·
                    {{ c.kind === 'remove' ? 'removal' : 'rewrite' }}</span
                  >
                  <span
                    class="flex gap-1"
                    role="group"
                    [attr.aria-label]="'Decision for ' + label(c.path)"
                  >
                    <button
                      type="button"
                      class="jb-chip"
                      [attr.aria-pressed]="c.decision === 'accepted'"
                      (click)="decide(c, 'accepted')"
                    >
                      <jb-icon name="check" [size]="14" /> Accept
                    </button>
                    <button
                      type="button"
                      class="jb-chip"
                      [attr.aria-pressed]="c.decision === 'rejected'"
                      (click)="decide(c, 'rejected')"
                    >
                      <jb-icon name="x" [size]="14" /> Reject
                    </button>
                  </span>
                </div>
                <del
                  class="mt-3 block rounded-control bg-bad-tint px-3 py-2 break-words text-ink no-underline"
                >
                  <span class="sr-only">Before: </span
                  ><span class="line-through decoration-bad/60">{{
                    c.before
                  }}</span>
                </del>
                @if (c.kind !== 'remove') {
                  <ins
                    class="mt-1.5 block rounded-control bg-good-tint px-3 py-2 break-words text-ink no-underline"
                  >
                    <span class="sr-only">After: </span>{{ c.after }}
                  </ins>
                }
                @if (c.reason) {
                  <p class="mt-2.5 flex gap-1.5 text-xs text-ink-muted">
                    <jb-icon name="lightbulb" [size]="14" class="mt-px" />
                    {{ c.reason }}
                  </p>
                }
              </article>
            }
            <div class="flex flex-wrap items-center gap-2">
              <button
                type="button"
                class="jb-btn-primary"
                [disabled]="acceptedCount() === 0"
                (click)="apply()"
              >
                {{ applyLabel() }}
              </button>
              <span class="text-xs text-ink-muted"
                >They go into the editor; nothing is saved until you press Save
                version.</span
              >
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class ResumeReviewPanel {
  private readonly resumes = inject(ResumesRepo);
  private readonly settings = inject(SettingsRepo);
  private readonly plan = inject(Plan);

  /** The resume as it stands in the editor. */
  readonly sections = input.required<ResumeSections>();
  /** The accepted changes that still fit, and how many no longer did. */
  readonly applied = output<{ changes: VariantChange[]; stale: number }>();
  readonly closed = output<void>();

  /** A review is on offer: a key of the user's own, or credits. */
  readonly hasKey = computed(
    () =>
      this.settings.connections().length > 0 ||
      (this.plan.route().enabled && !this.plan.route().ownOnly),
  );
  readonly model = signal('');
  readonly busy = signal(false);
  readonly error = signal('');
  /** Null until a review has answered. */
  readonly changes = signal<VariantChange[] | null>(null);
  readonly reviewedBy = signal('');
  /** The resume the review read: labels are taken from it. */
  private reviewed: ResumeSections | null = null;

  readonly acceptedCount = computed(
    () =>
      (this.changes() ?? []).filter((c) => c.decision === 'accepted').length,
  );
  readonly applyLabel = computed(() => {
    const n = this.acceptedCount();
    return n === 0
      ? 'Accept a change to apply it'
      : `Apply ${n} accepted ${n === 1 ? 'change' : 'changes'}`;
  });

  constructor() {
    void this.settings.load();
  }

  label(path: string): string {
    return reviewLabel(this.reviewed ?? this.sections(), path);
  }

  async review() {
    if (this.busy() || !this.hasKey()) return;
    const sections = this.sections();
    this.busy.set(true);
    this.error.set('');
    try {
      const res = await this.resumes.reviewWithAi(
        sections,
        this.model() || undefined,
      );
      this.reviewed = sections;
      this.reviewedBy.set(res.model ?? '');
      this.changes.set(res.changes);
    } catch (e) {
      this.error.set(
        (e as Error).message || 'Could not review the resume; try again.',
      );
    } finally {
      this.busy.set(false);
    }
  }

  decide(change: VariantChange, decision: VariantChange['decision']) {
    // Pressing the same decision again takes it back.
    const next = change.decision === decision ? 'pending' : decision;
    this.changes.update(
      (list) =>
        list?.map((c) => (c.id === change.id ? { ...c, decision: next } : c)) ??
        null,
    );
  }

  decideAll(decision: VariantChange['decision']) {
    this.changes.update(
      (list) => list?.map((c) => ({ ...c, decision })) ?? null,
    );
  }

  apply() {
    const accepted = (this.changes() ?? []).filter(
      (c) => c.decision === 'accepted',
    );
    if (!accepted.length) return;
    const fitting = stillFitting(this.sections(), accepted);
    this.applied.emit({
      changes: fitting,
      stale: accepted.length - fitting.length,
    });
  }
}
