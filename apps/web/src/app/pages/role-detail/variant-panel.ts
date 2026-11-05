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
import { NgTemplateOutlet } from '@angular/common';
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
import { ResumesRepo, SettingsRepo, VariantsRepo } from '../../core/data/repos';
import { ResumePreview } from '../../shared/resume-preview';
import { Toast } from '../../shared/toast';

/** The Resume tab on a role: tailored changes to accept or reject, keyword coverage, PDF. */
@Component({
  selector: 'jb-variant-panel',
  imports: [NgTemplateOutlet, RouterLink, ResumePreview],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!resumes.master()) {
      <div class="jb-empty">
        <b>No master resume yet.</b>
        Tailored variants start from it.
        <a routerLink="/resume" class="underline">Write your master resume</a>
        first.
      </div>
    } @else if (!variant()) {
      <div class="jb-empty">
        <b>No tailored resume for this role yet.</b>
        Generate one: Jobbotix proposes changes to your master resume for this
        posting, and you accept or reject each one.
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="jb-btn-primary"
            (click)="generate()"
            [disabled]="busy()"
          >
            {{ busy() ? 'Working…' : 'Generate tailored resume' }}
          </button>
          <ng-container *ngTemplateOutlet="modelPicker" />
        </div>
      </div>
    } @else {
      <div class="flex flex-col gap-6">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="text-sm">
            <span class="font-semibold">{{ accepted() }}</span> accepted ·
            <span class="font-semibold">{{ pending() }}</span> to review ·
            <span class="font-semibold">{{ rejected() }}</span> rejected
            @if (variant()?.status === 'approved') {
              <span class="jb-tag jb-tag-ai ml-2">approved</span>
            }
            @if (lastMethod(); as lm) {
              <div class="text-xs text-neutral-500">
                {{
                  lm.method === 'ai'
                    ? 'Written by ' + (lm.model || 'the model') + ' on your key'
                    : 'Local suggestions (no model call)'
                }}
              </div>
            }
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <ng-container *ngTemplateOutlet="modelPicker" />
            <button
              type="button"
              class="jb-btn"
              (click)="generate()"
              [disabled]="busy()"
            >
              Regenerate
            </button>
            <button
              type="button"
              class="jb-btn"
              (click)="acceptAll()"
              [disabled]="busy() || pending() === 0"
            >
              Accept all
            </button>
            <button type="button" class="jb-btn" (click)="printPdf()">
              Save as PDF
            </button>
            <button
              type="button"
              class="jb-btn-primary"
              (click)="approve()"
              [disabled]="busy() || variant()?.status === 'approved'"
            >
              Approve
            </button>
          </div>
        </div>

        @if (report(); as rep) {
          <section>
            <h3 class="jb-section-title">
              Keyword check
              <span class="font-normal normal-case tracking-normal"
                >· {{ rep.coverage }}% of {{ rep.keywords.length }} posting
                keywords present</span
              >
            </h3>
            <div class="mt-2 flex flex-wrap gap-1.5">
              @for (k of rep.matched; track k) {
                <span class="jb-tag jb-tag-ai">{{ k }}</span>
              }
              @for (k of rep.missing; track k) {
                <span class="jb-tag line-through decoration-neutral-400">{{
                  k
                }}</span>
              }
            </div>
            @if (rep.missing.length) {
              <p class="mt-1 text-xs text-neutral-500">
                Struck-through terms are in the posting but not in this resume.
                Add the ones that are true for you; never the others.
              </p>
            }
          </section>
        }

        <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section class="flex flex-col gap-3">
            <h3 class="jb-section-title">Proposed changes</h3>
            @if (changes().length === 0) {
              <p class="text-sm text-neutral-500">
                Nothing to change: the master already fits this posting.
              </p>
            }
            @for (c of changes(); track c.id) {
              <article
                class="jb-card p-3 text-sm"
                [class.opacity-60]="c.decision === 'rejected'"
              >
                <div class="flex items-start justify-between gap-2">
                  <span class="font-mono text-xs text-neutral-500"
                    >{{ label(c.path) }} · {{ c.kind }}</span
                  >
                  <span class="flex gap-1">
                    <button
                      type="button"
                      class="jb-btn px-2 py-1"
                      [class.jb-btn-on]="c.decision === 'accepted'"
                      (click)="decide(c, 'accepted')"
                      aria-label="Accept"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      class="jb-btn px-2 py-1"
                      [class.jb-btn-on]="c.decision === 'rejected'"
                      (click)="decide(c, 'rejected')"
                      aria-label="Reject"
                    >
                      Reject
                    </button>
                  </span>
                </div>
                @if (c.kind !== 'add' && c.before) {
                  <p
                    class="mt-2 rounded bg-red-50 px-2 py-1 text-red-900 line-through decoration-red-400 dark:bg-red-950/40 dark:text-red-200"
                  >
                    {{ c.before }}
                  </p>
                }
                @if (c.kind !== 'remove' && c.after) {
                  <p
                    class="mt-1 rounded bg-emerald-50 px-2 py-1 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
                  >
                    {{ c.after }}
                  </p>
                }
                @if (c.reason) {
                  <p class="mt-1 text-xs text-neutral-500">{{ c.reason }}</p>
                }
              </article>
            }
          </section>
          <section>
            <h3 class="jb-section-title">Result</h3>
            <div
              class="mt-2 rounded-lg bg-neutral-200/60 p-3 dark:bg-neutral-900"
            >
              <jb-resume-preview [r]="applied()" />
            </div>
          </section>
        </div>
      </div>

      <div class="hidden print:block">
        <jb-resume-preview [r]="applied()" [print]="true" />
      </div>
    }

    <ng-template #modelPicker>
      @if (hasKey()) {
        <select
          class="jb-input jb-input-inline"
          aria-label="Model for this generation"
          [value]="model()"
          (change)="model.set($any($event.target).value)"
        >
          <option value="">Default model</option>
          @for (m of settings.models(); track m.id) {
            <option [value]="m.id">{{ m.label }}</option>
          }
        </select>
      } @else {
        <span class="text-xs text-neutral-500"
          >No AI key: local suggestions only.
          <a routerLink="/settings" class="underline">Add a key</a> for
          model-written changes.</span
        >
      }
    </ng-template>
  `,
  styles: `
    .jb-btn-on {
      background: var(--color-brand-600);
      color: #fff;
      border-color: var(--color-brand-600);
    }
  `,
})
export class VariantPanel {
  protected readonly resumes = inject(ResumesRepo);
  protected readonly settings = inject(SettingsRepo);
  private readonly variants = inject(VariantsRepo);
  readonly model = signal('');
  readonly lastMethod = signal<{
    method: 'ai' | 'local';
    model?: string;
  } | null>(null);
  readonly hasKey = computed(
    () => !!this.settings.profile()?.anthropic_key_ref,
  );
  private readonly toast = inject(Toast);

  readonly role = input.required<RoleRow>();
  readonly variant = signal<ResumeVariantRow | null>(null);
  readonly busy = signal(false);

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
    void this.settings.load();
    effect(() => {
      const id = this.role().id;
      untracked(
        () =>
          void this.variants.variantFor(id).then((v) => this.variant.set(v)),
      );
    });
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

  printPdf() {
    window.print();
  }
}
