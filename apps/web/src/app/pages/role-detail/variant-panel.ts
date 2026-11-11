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
  applyVariant,
  normaliseResume,
  type KeywordReport,
  type ResumeSections,
  type ResumeVariantRow,
  type RoleRow,
  type VariantChange,
  type VariantDiff,
} from '@jobbotix/shared-types';
import { ResumesRepo, VariantsRepo } from '../../core/data/repos';
import { ModelPicker } from '../../shared/model-picker';
import { ResumePreview } from '../../shared/resume-preview';
import { droppedNote } from '../../shared/pdf-text';
import { downloadResumePdf, resumeFilename } from '../../shared/resume-pdf';
import { Toast } from '../../shared/toast';
import { BarRow, Button, EmptyState, Icon, ScaledPage } from '../../ui';

/** The Resume tab on a role: tailored changes to accept or reject, keyword coverage, PDF. */
@Component({
  selector: 'jb-variant-panel',
  imports: [
    BarRow,
    Button,
    EmptyState,
    Icon,
    ModelPicker,
    ResumePreview,
    RouterLink,
    ScaledPage,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!resumes.master()) {
      <jb-empty-state title="No master resume yet" icon="file-text">
        Tailored variants start from your master resume.
        <div actions>
          <a jbButton="primary" routerLink="/resume"
            ><jb-icon name="pencil" /> Write your master resume</a
          >
        </div>
      </jb-empty-state>
    } @else if (!variant()) {
      <jb-empty-state
        title="No tailored resume for this role yet"
        icon="sparkles"
      >
        Jobbotix proposes changes to your master resume for this posting, and
        you accept or reject each one.
        <div actions class="flex flex-wrap items-center gap-3">
          <button
            type="button"
            jbButton="primary"
            [busy]="busy()"
            [disabled]="busy()"
            (click)="generate()"
          >
            <jb-icon name="sparkles" /> Generate tailored resume
          </button>
          <jb-model-picker [(value)]="model" job="tailor" />
        </div>
      </jb-empty-state>
    } @else {
      <div class="flex flex-col gap-5">
        <!-- Summary and actions -->
        <section class="jb-card flex flex-col gap-4 p-5 md:p-6">
          <div
            class="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between"
          >
            <div class="min-w-0 flex-1">
              <p
                class="flex flex-wrap items-center gap-2 font-semibold text-ink"
              >
                {{ accepted() }} of {{ changes().length }} changes accepted
                @if (variant()?.status === 'approved') {
                  <span class="jb-tag jb-tag-ai"
                    ><jb-icon name="check" [size]="14" /> Approved</span
                  >
                }
              </p>
              <div
                class="mt-2.5 flex h-2 overflow-hidden rounded-full bg-sunken"
                role="img"
                [attr.aria-label]="
                  accepted() +
                  ' accepted, ' +
                  pending() +
                  ' to review, ' +
                  rejected() +
                  ' rejected'
                "
              >
                <span
                  class="bg-good transition-[width] duration-300"
                  [style.width.%]="share(accepted())"
                ></span>
                <span
                  class="bg-signal transition-[width] duration-300"
                  [style.width.%]="share(pending())"
                ></span>
                <span
                  class="bg-ink-faint transition-[width] duration-300"
                  [style.width.%]="share(rejected())"
                ></span>
              </div>
              <p
                class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted"
              >
                <span class="inline-flex items-center gap-1.5"
                  ><span class="size-2 rounded-full bg-good"></span
                  >{{ accepted() }} accepted</span
                >
                <span class="inline-flex items-center gap-1.5"
                  ><span class="size-2 rounded-full bg-signal"></span
                  >{{ pending() }} to review</span
                >
                <span class="inline-flex items-center gap-1.5"
                  ><span class="size-2 rounded-full bg-ink-faint"></span
                  >{{ rejected() }} rejected</span
                >
                @if (lastMethod(); as lm) {
                  <span>
                    {{
                      lm.method === 'ai'
                        ? 'Written by ' +
                          (lm.model || 'the model') +
                          ' on your key'
                        : 'Local suggestions (no model call)'
                    }}
                  </span>
                }
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <button
                type="button"
                jbButton="primary"
                [disabled]="busy() || variant()?.status === 'approved'"
                (click)="approve()"
              >
                <jb-icon name="check" /> Approve
              </button>
              <button
                type="button"
                jbButton
                [busy]="exporting()"
                [disabled]="exporting()"
                title="Text PDF of the result, readable by ATS parsers"
                (click)="downloadPdf()"
              >
                <jb-icon name="download" /> PDF
              </button>
              <button
                type="button"
                jbButton
                [disabled]="busy() || pending() === 0"
                (click)="acceptAll()"
              >
                Accept all
              </button>
              <button
                type="button"
                jbButton="ghost"
                iconOnly
                aria-label="Print"
                title="Print"
                (click)="printPdf()"
              >
                <jb-icon name="printer" />
              </button>
            </div>
          </div>
          <div
            class="flex flex-wrap items-center gap-2 border-t border-line pt-4"
          >
            <jb-model-picker [(value)]="model" job="tailor" />
            <button
              type="button"
              jbButton="ghost"
              size="sm"
              [busy]="busy()"
              [disabled]="busy()"
              (click)="generate()"
            >
              <jb-icon name="rotate-cw" /> Regenerate
            </button>
          </div>
        </section>

        @if (report(); as rep) {
          <section class="jb-card p-5 md:p-6">
            <h3 class="font-semibold text-ink">Keyword check</h3>
            <jb-bar-row
              class="mt-3"
              label="Posting keywords present"
              [value]="rep.coverage"
              [max]="100"
              [display]="rep.coverage + '% of ' + rep.keywords.length"
              [tone]="
                rep.coverage >= 70
                  ? 'good'
                  : rep.coverage >= 45
                    ? 'signal'
                    : 'warn'
              "
            />
            <div class="mt-4 flex flex-wrap gap-1.5">
              @for (k of rep.matched; track k) {
                <span class="jb-tag jb-tag-ai"
                  ><jb-icon name="check" [size]="13" /> {{ k }}</span
                >
              }
              @for (k of rep.missing; track k) {
                <span class="jb-tag line-through decoration-ink-faint">{{
                  k
                }}</span>
              }
            </div>
            @if (rep.missing.length) {
              <p class="mt-3 text-xs text-ink-muted">
                Struck-through terms are in the posting but not in this resume.
                Add the ones that are true for you; never the others.
              </p>
            }
          </section>
        }

        <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section class="flex flex-col gap-3">
            <h3 class="flex items-center gap-2 font-semibold text-ink">
              Proposed changes
              <span class="jb-count">{{ changes().length }}</span>
            </h3>
            @if (changes().length === 0) {
              <p class="text-sm text-ink-muted">
                Nothing to change: the master already fits this posting.
              </p>
            }
            @for (c of changes(); track c.id) {
              <article
                class="jb-card p-4 text-sm transition-opacity"
                [class.opacity-55]="c.decision === 'rejected'"
              >
                <div class="flex items-center justify-between gap-3">
                  <span class="text-xs font-medium text-ink-muted"
                    >{{ label(c.path) }} · {{ kindLabel(c.kind) }}</span
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
                @if (c.kind !== 'add' && c.before) {
                  <del
                    class="mt-3 block rounded-control bg-bad-tint px-3 py-2 text-ink no-underline"
                  >
                    <span class="sr-only">Before: </span
                    ><span class="line-through decoration-bad/60">{{
                      c.before
                    }}</span>
                  </del>
                }
                @if (c.kind !== 'remove' && c.after) {
                  <ins
                    class="mt-1.5 block rounded-control bg-good-tint px-3 py-2 text-ink no-underline"
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
          </section>
          <section class="min-w-0">
            <h3 class="font-semibold text-ink">Result</h3>
            <div
              class="mt-3 rounded-card bg-sunken p-3 md:p-4 lg:sticky lg:top-8"
            >
              <jb-scaled-page>
                <jb-resume-preview [r]="applied()" />
              </jb-scaled-page>
            </div>
          </section>
        </div>
      </div>

      <div class="hidden print:block">
        <jb-resume-preview [r]="applied()" [print]="true" />
      </div>
    }
  `,
})
export class VariantPanel {
  protected readonly resumes = inject(ResumesRepo);
  private readonly variants = inject(VariantsRepo);
  readonly model = signal('');
  readonly lastMethod = signal<{
    method: 'ai' | 'local';
    model?: string;
  } | null>(null);
  private readonly toast = inject(Toast);

  readonly role = input.required<RoleRow>();
  readonly variant = signal<ResumeVariantRow | null>(null);
  readonly busy = signal(false);
  readonly exporting = signal(false);

  readonly master = computed<ResumeSections>(() =>
    normaliseResume(this.resumes.master()?.sections),
  );
  readonly diff = computed<VariantDiff>(
    () =>
      (this.variant()?.diff as unknown as VariantDiff | null) ?? {
        baseResumeId: '',
        changes: [],
      },
  );
  readonly changes = computed(() => this.diff().changes);
  readonly applied = computed(() => applyVariant(this.master(), this.diff()));
  readonly report = computed(
    () =>
      (this.variant()?.keyword_report as unknown as KeywordReport | null) ??
      null,
  );
  readonly accepted = computed(
    () => this.changes().filter((c) => c.decision === 'accepted').length,
  );
  readonly rejected = computed(
    () => this.changes().filter((c) => c.decision === 'rejected').length,
  );
  readonly pending = computed(
    () => this.changes().filter((c) => c.decision === 'pending').length,
  );

  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    void this.resumes.load();
    effect(() => {
      const id = this.role().id;
      untracked(
        () =>
          void this.variants.variantFor(id).then((v) => this.variant.set(v)),
      );
    });
  }

  share(n: number) {
    const total = this.changes().length;
    return total ? (n / total) * 100 : 0;
  }

  kindLabel(kind: string) {
    return kind === 'add'
      ? 'addition'
      : kind === 'remove'
        ? 'removal'
        : 'rewrite';
  }

  label(path: string): string {
    const p = path.split('.');
    if (p[0] === 'summary') return 'Summary';
    if (p[0] === 'contact') return 'Headline';
    if (p[0] === 'experience')
      return `Experience ${Number(p[1]) + 1}${p[2] === 'bullets' && p[3] !== undefined ? ` · bullet ${Number(p[3]) + 1}` : ' · bullets'}`;
    if (p[0] === 'skills')
      return `Skills · ${this.master().skills[Number(p[1])]?.name ?? 'group'}`;
    if (p[0] === 'projects') return `Project ${Number(p[1]) + 1}`;
    if (p[0] === 'aiToolkit') return 'AI toolkit';
    return path;
  }

  async generate() {
    this.busy.set(true);
    try {
      const v = await this.variants.generate(
        this.role().id,
        this.model() || undefined,
      );
      this.variant.set(v);
      this.lastMethod.set({ method: v.method ?? 'local', model: v.model });
      this.toast.show('Changes proposed. Review each one.');
    } catch (e) {
      this.toast.show((e as Error).message || 'Could not generate');
    } finally {
      this.busy.set(false);
    }
  }

  decide(change: VariantChange, decision: VariantChange['decision']) {
    const v = this.variant();
    if (!v) return;
    const next: VariantDiff = {
      ...this.diff(),
      changes: this.changes().map((c) =>
        c.id === change.id
          ? { ...c, decision: c.decision === decision ? 'pending' : decision }
          : c,
      ),
    };
    this.variant.set({
      ...v,
      diff: next as unknown as ResumeVariantRow['diff'],
    });
    this.persist();
  }

  acceptAll() {
    const v = this.variant();
    if (!v) return;
    const next: VariantDiff = {
      ...this.diff(),
      changes: this.changes().map((c) =>
        c.decision === 'pending' ? { ...c, decision: 'accepted' } : c,
      ),
    };
    this.variant.set({
      ...v,
      diff: next as unknown as ResumeVariantRow['diff'],
    });
    this.persist();
  }

  private persist() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(async () => {
      const v = this.variant();
      if (!v) return;
      try {
        this.variant.set(
          await this.variants.saveDiff(v.id, this.diff(), this.applied()),
        );
      } catch {
        this.toast.show('Could not save your decisions');
      }
    }, 400);
  }

  async approve() {
    const v = this.variant();
    if (!v) return;
    this.busy.set(true);
    try {
      await this.variants.saveDiff(v.id, this.diff(), this.applied());
      this.variant.set(await this.variants.approve(v.id));
      this.toast.show('Variant approved');
    } catch (e) {
      this.toast.show((e as Error).message || 'Could not approve');
    } finally {
      this.busy.set(false);
    }
  }

  async downloadPdf() {
    this.exporting.set(true);
    try {
      const dropped = await downloadResumePdf(
        this.applied(),
        resumeFilename(this.applied(), this.role().company),
      );
      if (dropped.length)
        this.toast.show(droppedNote(dropped), { tone: 'info', ms: 14_000 });
    } catch (e) {
      this.toast.show((e as Error).message || 'Could not build the PDF');
    } finally {
      this.exporting.set(false);
    }
  }

  printPdf() {
    window.print();
  }
}
