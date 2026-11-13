import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  excludedCounts,
  excludedGroupId,
  excludedReasonLine,
  type ExcludedGroupId,
} from '@jobbotix/shared-types';
import { type PassedOver, SearchProfileRepo } from '../../core/data/repos';
import { RelativeDayPipe } from '../../shared/format';
import {
  BackLink,
  Button,
  EmptyState,
  Icon,
  PageHeader,
  Skeleton,
} from '../../ui';

interface Row extends PassedOver {
  group: ExcludedGroupId;
  line: string;
}

/** How many postings a group shows before "Show all". */
const FIRST = 8;

/**
 * Postings the search looked at and did not add, with the reason for each:
 * the answer to "why didn't I get this job in my list?".
 */
@Component({
  selector: 'jb-passed-over',
  imports: [
    BackLink,
    Button,
    EmptyState,
    Icon,
    PageHeader,
    RelativeDayPipe,
    RouterLink,
    Skeleton,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <jb-back-link link="/today" label="Today" />
    <jb-page-header
      title="Passed over"
      lead="Postings the search looked at in the last 60 days and did not add, with the reason for each. Jobs of another kind are not kept."
    />

    <div class="mt-6 flex flex-col gap-6 md:mt-8">
      @if (error()) {
        <p class="text-sm text-bad" role="alert">{{ error() }}</p>
      } @else if (rows() === null) {
        <jb-skeleton shape="row" [count]="6" />
      } @else if (!rows()!.length) {
        <jb-empty-state title="Nothing passed over yet" icon="inbox">
          When the search rules a posting out, for its country, pay, level or a
          low score, it is listed here with the reason.
          <div actions>
            <a jbButton routerLink="/search"
              ><jb-icon name="sliders-horizontal" /> Search profile</a
            >
          </div>
        </jb-empty-state>
      } @else {
        <div
          class="flex flex-wrap gap-2"
          role="group"
          aria-label="Show one reason"
        >
          <button
            type="button"
            class="jb-chip"
            [attr.aria-pressed]="only() === null"
            (click)="only.set(null)"
          >
            All <span class="text-ink-muted">{{ rows()!.length }}</span>
          </button>
          @for (g of counts(); track g.id) {
            <button
              type="button"
              class="jb-chip"
              [attr.aria-pressed]="only() === g.id"
              (click)="only.set(only() === g.id ? null : g.id)"
            >
              {{ g.label }} <span class="text-ink-muted">{{ g.count }}</span>
            </button>
          }
        </div>

        @for (g of shown(); track g.id) {
          <section
            class="jb-card p-4 md:p-5"
            [attr.aria-labelledby]="g.id + '-h'"
          >
            <h2
              [id]="g.id + '-h'"
              class="flex flex-wrap items-center gap-2 font-semibold text-ink"
            >
              {{ g.label }}
              <span class="jb-count">{{ g.count }}</span>
            </h2>
            <p class="mt-1 text-sm text-ink-muted">{{ g.help }}</p>
            <ul class="mt-3 flex flex-col divide-y divide-line">
              @for (r of g.rows; track r.id) {
                <li
                  class="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                >
                  <div class="min-w-0">
                    <p class="break-words font-medium text-ink">
                      {{ r.title || 'Untitled posting' }}
                    </p>
                    <p class="break-words text-sm text-ink-muted">
                      {{ r.company || 'Unknown company' }} ·
                      {{ r.found_at | relativeDay }}
                    </p>
                    <p class="mt-0.5 break-words text-sm text-ink">
                      {{ r.line }}
                    </p>
                  </div>
                  @if (r.url) {
                    <div class="flex shrink-0 flex-wrap gap-2">
                      <a
                        jbButton="ghost"
                        size="sm"
                        [href]="r.url"
                        target="_blank"
                        rel="noopener noreferrer"
                        [attr.aria-label]="
                          'Open the posting: ' + r.title + ' at ' + r.company
                        "
                        >Open <jb-icon name="arrow-up-right" [size]="14"
                      /></a>
                      <a
                        jbButton
                        size="sm"
                        routerLink="/roles/new"
                        [queryParams]="{ url: r.url }"
                        [attr.aria-label]="
                          'Add to my roles: ' + r.title + ' at ' + r.company
                        "
                        ><jb-icon name="plus" [size]="14" /> Add anyway</a
                      >
                    </div>
                  }
                </li>
              }
            </ul>
            @if (g.more) {
              <button
                type="button"
                jbButton="ghost"
                size="sm"
                class="mt-2"
                (click)="expand(g.id)"
              >
                Show all {{ g.count }}
              </button>
            }
          </section>
        }

        <p class="text-sm text-ink-muted">
          Too much ruled out? Countries, pay, level and contract types are set
          in your
          <a class="text-brand-ink underline" routerLink="/search"
            >search profile</a
          >.
        </p>
      }
    </div>
  `,
})
export class PassedOverPage {
  private readonly repo = inject(SearchProfileRepo);

  readonly rows = signal<Row[] | null>(null);
  readonly error = signal('');
  readonly only = signal<ExcludedGroupId | null>(null);
  private readonly open = signal<ReadonlySet<ExcludedGroupId>>(new Set());

  readonly counts = computed(() => excludedCounts(this.rows() ?? []));

  /** The groups on screen, each with the postings it shows. */
  readonly shown = computed(() => {
    const rows = this.rows() ?? [];
    const only = this.only();
    const open = this.open();
    return this.counts()
      .filter((g) => only === null || g.id === only)
      .map((g) => {
        const mine = rows.filter((r) => r.group === g.id);
        const all = only === g.id || open.has(g.id) || mine.length <= FIRST;
        return { ...g, rows: all ? mine : mine.slice(0, FIRST), more: !all };
      });
  });

  constructor() {
    void this.load();
  }

  expand(id: ExcludedGroupId) {
    this.open.update((s) => new Set(s).add(id));
  }

  private async load() {
    try {
      const data = await this.repo.passedOver();
      this.rows.set(
        data.map((r) => ({
          ...r,
          group: excludedGroupId(r.reason),
          line: excludedReasonLine(r.reason),
        })),
      );
    } catch (e) {
      this.error.set(
        e instanceof Error ? e.message : 'Could not load the list',
      );
    }
  }
}
