import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  hostOf,
  normaliseCompanyResearch,
  type RoleRow,
} from '@jobbotix/shared-types';
import { RolesRepo } from '../../core/data/repos';
import { Plan } from '../../core/plan';
import { RelativeDayPipe } from '../../shared/format';
import { ModelPicker } from '../../shared/model-picker';
import { Toast } from '../../shared/toast';
import { UpgradeNote } from '../../shared/upgrade-note';
import { Button, EmptyState, Icon } from '../../ui';
import type { IconName } from '../../ui/icons.generated';

interface Section {
  title: string;
  icon: IconName;
  items: string[];
  tone?: 'warn';
}

/** The Company tab: what the employer does, how it hires remotely, what people say. */
@Component({
  selector: 'jb-company-panel',
  imports: [
    Button,
    EmptyState,
    Icon,
    ModelPicker,
    RelativeDayPipe,
    UpgradeNote,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (research().researchedAt) {
      <div class="flex flex-col gap-5">
        <section class="jb-card p-5 md:p-6">
          <h2
            class="flex min-w-0 items-center gap-2 text-lg font-semibold wrap-anywhere text-ink"
          >
            <jb-icon name="building" class="shrink-0 text-brand" />
            {{ role().company }}
          </h2>
          @if (research().summary) {
            <p class="mt-2 max-w-prose text-ink-muted">
              {{ research().summary }}
            </p>
          }

          @if (facts().length) {
            <dl
              class="mt-5 grid grid-cols-1 gap-x-6 gap-y-3 border-t border-line pt-5 text-sm sm:grid-cols-2 lg:grid-cols-3"
            >
              @for (f of facts(); track f.label) {
                <div class="min-w-0">
                  <dt class="text-xs font-medium text-ink-faint">
                    {{ f.label }}
                  </dt>
                  <dd class="mt-0.5 wrap-anywhere text-ink">
                    @if (f.href) {
                      <a
                        [href]="f.href"
                        target="_blank"
                        rel="noopener"
                        class="inline-flex items-center gap-1 font-medium text-brand-ink underline-offset-2 hover:underline"
                        >{{ f.value }}
                        <jb-icon name="arrow-up-right" [size]="14"
                      /></a>
                    } @else {
                      {{ f.value }}
                    }
                  </dd>
                </div>
              }
            </dl>
          }

          <div
            class="mt-5 flex flex-col gap-3 border-t border-line pt-4 md:flex-row md:items-center md:justify-between"
          >
            <p class="min-w-0 text-xs text-ink-muted">
              Researched {{ research().researchedAt | relativeDay }}
              {{ methodLine() }}
            </p>
            @if (allowed()) {
              <div class="flex flex-wrap items-center gap-2 md:justify-end">
                @if (canPickModel()) {
                  <jb-model-picker [(value)]="model" job="research" />
                }
                <button
                  type="button"
                  jbButton
                  class="shrink-0"
                  [busy]="busy()"
                  [disabled]="busy()"
                  (click)="run(true)"
                >
                  <jb-icon name="rotate-cw" /> Refresh
                </button>
              </div>
            }
          </div>
          @if (!allowed()) {
            <jb-upgrade-note class="mt-3" feature="company_research" />
          }
          @if (research().note) {
            <p
              class="mt-3 flex items-start gap-2 rounded-control bg-sunken px-3.5 py-2.5 text-sm text-ink-muted"
            >
              <jb-icon name="info" [size]="17" class="mt-0.5 shrink-0" />
              <span class="min-w-0">{{ research().note }}</span>
            </p>
          }
        </section>

        @if (busy()) {
          <p
            class="flex items-center gap-2.5 text-sm text-ink-muted"
            role="status"
          >
            <jb-icon
              name="loader-circle"
              [size]="18"
              class="animate-spin text-brand"
            />
            {{ busyLine() }}
          </p>
        }

        @if (sections().length) {
          <div class="grid gap-4 md:grid-cols-2">
            @for (s of sections(); track s.title) {
              <section class="jb-card p-5">
                <h3 class="flex items-center gap-2 font-semibold text-ink">
                  <jb-icon
                    [name]="s.icon"
                    [class]="s.tone === 'warn' ? 'text-warn' : 'text-brand'"
                  />
                  {{ s.title }}
                </h3>
                <ul class="mt-3 flex flex-col gap-2.5 text-sm wrap-anywhere">
                  @for (x of s.items; track $index) {
                    <li class="flex gap-2.5">
                      <span
                        class="mt-2 size-1.5 shrink-0 rounded-full"
                        [class.bg-warn]="s.tone === 'warn'"
                        [class.bg-brand]="s.tone !== 'warn'"
                      ></span>
                      <span class="min-w-0">{{ x }}</span>
                    </li>
                  }
                </ul>
              </section>
            }
          </div>
        } @else {
          <p class="text-sm text-ink-muted">
            The posting says little about the company beyond its name.
          </p>
        }

        @if (research().sources.length) {
          <section class="jb-card p-5">
            <h3 class="font-semibold text-ink">Sources</h3>
            <ul class="mt-3 flex flex-col gap-2 text-sm">
              @for (s of research().sources; track s.url) {
                <li class="min-w-0">
                  <a
                    [href]="s.url"
                    target="_blank"
                    rel="noopener"
                    class="block min-w-0 text-brand-ink underline-offset-2 hover:underline"
                  >
                    <span class="block truncate">{{ s.title }}</span>
                    <span class="block truncate text-xs text-ink-faint">{{
                      host(s.url)
                    }}</span>
                  </a>
                </li>
              }
            </ul>
            <p class="mt-3 text-xs text-ink-faint">
              Check anything important at the source before an interview.
            </p>
          </section>
        }
      </div>
    } @else {
      <jb-empty-state title="No company research yet" icon="building">
        Find out who you would be working for: what they build, how big they are
        and how they are funded, where they hire remote people from, and what
        employees say.
        <div actions class="flex flex-col items-center gap-3">
          @if (allowed()) {
            <div class="flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                jbButton="primary"
                [busy]="busy()"
                [disabled]="busy()"
                (click)="run(false)"
              >
                <jb-icon name="sparkles" /> Research the company
              </button>
              @if (canPickModel()) {
                <jb-model-picker [(value)]="model" job="research" />
              }
            </div>
          } @else {
            <jb-upgrade-note feature="company_research" />
          }
          @if (busy()) {
            <p
              class="flex items-center gap-2 text-sm text-ink-muted"
              role="status"
            >
              {{ busyLine() }}
            </p>
          }
        </div>
      </jb-empty-state>
    }
  `,
})
export class CompanyPanel {
  private readonly repo = inject(RolesRepo);
  private readonly toast = inject(Toast);
  private readonly plan = inject(Plan);
  /** False when the account's plan does not cover company research. */
  readonly allowed = computed(() => this.plan.can('company_research'));
  readonly role = input.required<RoleRow>();
  /** False in places that have no key to pick a model for (demo). */
  readonly canPickModel = input(true);
  readonly model = signal('');
  readonly busy = signal(false);

  readonly research = computed(() =>
    normaliseCompanyResearch(this.role().company_research),
  );

  readonly facts = computed(() => {
    const r = this.research();
    const out: { label: string; value: string; href?: string }[] = [];
    if (r.website)
      out.push({ label: 'Website', value: hostOf(r.website), href: r.website });
    if (r.headquarters)
      out.push({ label: 'Headquarters', value: r.headquarters });
    if (r.founded) out.push({ label: 'Founded', value: r.founded });
    if (r.size) out.push({ label: 'Size', value: r.size });
    if (r.funding) out.push({ label: 'Funding', value: r.funding });
    return out;
  });

  readonly sections = computed<Section[]>(() => {
    const r = this.research();
    return (
      [
        { title: 'Hiring remotely', icon: 'globe', items: r.remoteHiring },
        { title: 'Product and customers', icon: 'briefcase', items: r.product },
        { title: 'Engineering', icon: 'target', items: r.engineering },
        { title: 'What people say', icon: 'users', items: r.reputation },
        { title: 'Recent news', icon: 'newspaper', items: r.recentNews },
        {
          title: 'Worth checking',
          icon: 'triangle-exclamation-point',
          items: r.redFlags,
          tone: 'warn',
        },
      ] satisfies Section[]
    ).filter((s) => s.items.length);
  });

  readonly methodLine = computed(() => {
    const r = this.research();
    if (r.method !== 'ai')
      return r.sources.some((x) => x.title !== 'The posting')
        ? 'from the posting and the company site.'
        : 'from the posting.';
    const by = r.model || 'the model';
    return r.webSearch
      ? `by ${by}, searching the web on your key.`
      : `by ${by} on your key, without web search.`;
  });

  readonly busyLine = computed(() =>
    this.research().researchedAt
      ? 'Refreshing. A web search takes up to a minute.'
      : 'Researching. With an Anthropic key this searches the web and takes up to a minute.',
  );

  host(url: string) {
    return hostOf(url);
  }

  async run(refresh: boolean) {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const { reused } = await this.repo.researchCompany(this.role().id, {
        model: this.model() || undefined,
        refresh,
      });
      this.toast.show(
        reused
          ? `Used your recent research on ${this.role().company}`
          : 'Company research ready',
      );
    } catch (e) {
      if (await this.plan.handled(e)) return;
      this.toast.show((e as Error).message || 'Could not research the company');
    } finally {
      this.busy.set(false);
    }
  }
}
