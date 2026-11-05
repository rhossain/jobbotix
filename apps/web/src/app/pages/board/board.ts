import {
  CdkDrag,
  CdkDragDrop,
  CdkDragPlaceholder,
  CdkDropList,
  CdkDropListGroup,
} from '@angular/cdk/drag-drop';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  ROLE_STATUS_LABELS,
  type RoleRow,
  type RoleStatus,
} from '@jobbotix/shared-types';
import { RolesRepo } from '../../core/data/repos';
import { RelativeDayPipe } from '../../shared/format';
import { StatusSelect } from '../../shared/status-select';
import { ShareButton } from '../../shared/share-button';
import { Toast } from '../../shared/toast';
import { EmptyState, MatchRing, PageHeader } from '../../ui';

/** Columns shown on the board, in pipeline order. Skipped is hidden by default. */
const COLUMNS: RoleStatus[] = [
  'new',
  'shortlist',
  'applied',
  'interview',
  'offer',
  'rejected',
];

@Component({
  selector: 'jb-board',
  imports: [
    CdkDropListGroup,
    CdkDropList,
    CdkDrag,
    CdkDragPlaceholder,
    EmptyState,
    MatchRing,
    PageHeader,
    RouterLink,
    NgTemplateOutlet,
    RelativeDayPipe,
    ShareButton,
    StatusSelect,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <jb-page-header title="Board">
      <p lead class="mt-2 max-w-[var(--reading-max)] text-ink-muted">
        <span class="hidden md:inline"
          >Drag a card to change its status, or use the status on the
          card.</span
        >
        <span class="md:hidden"
          >Pick a column, then change a card's status from the card.</span
        >
        Skipped roles stay out of the way under
        <a
          routerLink="/roles"
          [queryParams]="{ status: 'skipped' }"
          class="text-brand-ink underline"
          >Roles</a
        >.
      </p>
      <div actions><jb-share-button kind="board" /></div>
    </jb-page-header>

    @if (repo.loaded() && repo.roles().length === 0) {
      <jb-empty-state
        class="mt-8"
        title="The board fills itself"
        icon="square-kanban"
      >
        Each daily run adds new roles to the first column.
      </jb-empty-state>
    } @else {
      <!-- Phones: one column at a time -->
      <div class="mt-6 md:hidden">
        <div
          class="-mx-[var(--gutter)] flex gap-2 overflow-x-auto px-[var(--gutter)] pb-1"
          role="tablist"
          aria-label="Board columns"
        >
          @for (col of columns; track col) {
            <button
              type="button"
              role="tab"
              class="jb-chip shrink-0"
              [attr.aria-selected]="mobileCol() === col"
              (click)="mobileCol.set(col)"
            >
              <span
                class="size-2 rounded-full"
                [style.background]="tone(col)"
              ></span>
              {{ labels[col] }}
              <span class="text-ink-faint">{{ byStatus()[col].length }}</span>
            </button>
          }
        </div>
        <div
          class="mt-4 flex flex-col gap-2.5"
          role="tabpanel"
          [attr.aria-label]="labels[mobileCol()]"
        >
          @if (!repo.loaded()) {
            @for (i of [1, 2, 3]; track i) {
              <div class="jb-card h-28 animate-pulse bg-sunken"></div>
            }
          }
          @for (r of byStatus()[mobileCol()]; track r.id) {
            <ng-container *ngTemplateOutlet="card; context: { $implicit: r }" />
          } @empty {
            @if (repo.loaded()) {
              <p
                class="rounded-card border border-dashed border-line-strong px-4 py-8 text-center text-sm text-ink-muted"
              >
                Nothing in {{ labels[mobileCol()] }} yet.
              </p>
            }
          }
        </div>
      </div>

      <!-- Tablets and up: all columns, drag and drop -->
      <div class="jb-board mt-8 hidden md:grid" cdkDropListGroup>
        @for (col of columns; track col) {
          <section
            class="jb-col"
            [attr.aria-label]="labels[col]"
            [style.--tone]="tone(col)"
          >
            <h2
              class="flex items-center gap-2 px-1 text-sm font-semibold text-ink"
            >
              <span class="size-2 rounded-full bg-[var(--tone)]"></span>
              {{ labels[col] }}
              <span class="jb-count ml-auto">{{ byStatus()[col].length }}</span>
            </h2>
            <div
              class="jb-col-list"
              cdkDropList
              [id]="col"
              [cdkDropListData]="col"
              (cdkDropListDropped)="drop($event)"
            >
              @if (!repo.loaded()) {
                <div class="jb-card h-24 animate-pulse bg-sunken"></div>
              }
              @for (r of byStatus()[col]; track r.id) {
                <div
                  cdkDrag
                  [cdkDragData]="r"
                  [cdkDragStartDelay]="{ touch: 180, mouse: 0 }"
                  class="jb-drag"
                >
                  <ng-container
                    *ngTemplateOutlet="card; context: { $implicit: r }"
                  />
                  <div class="jb-card-placeholder" *cdkDragPlaceholder></div>
                </div>
              } @empty {
                @if (repo.loaded()) {
                  <p class="px-2 py-6 text-center text-xs text-ink-muted">
                    Drop here
                  </p>
                }
              }
            </div>
          </section>
        }
      </div>
    }

    <ng-template #card let-r>
      <article class="jb-card jb-board-card" [class.jb-card-ai]="r.ai_match">
        <div class="flex items-start gap-3">
          <jb-match-ring [score]="r.score" size="xs" />
          <div class="min-w-0 flex-1">
            <a
              [routerLink]="['/roles', r.id]"
              class="block leading-snug font-semibold text-ink no-underline hover:underline"
              >{{ r.title }}</a
            >
            <p class="mt-0.5 truncate text-sm text-ink-muted">
              {{ r.company }}
            </p>
          </div>
        </div>
        <div class="mt-3 flex items-center justify-between gap-2">
          <span class="flex min-w-0 flex-col text-xs leading-tight">
            @if (r.salary) {
              <span class="truncate font-medium text-ink-muted">{{
                r.salary
              }}</span>
            }
            <span class="truncate text-ink-faint">{{
              r.status_changed_at | relativeDay
            }}</span>
          </span>
          <jb-status-select class="shrink-0" [role]="r" [compact]="true" />
        </div>
      </article>
    </ng-template>
  `,
  styles: `
    .jb-board {
      grid-auto-flow: column;
      grid-auto-columns: minmax(14.5rem, 1fr);
      gap: 1rem;
      overflow-x: auto;
      padding-bottom: 0.75rem;
      scroll-snap-type: x proximity;
    }
    .jb-col {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      min-width: 0;
      scroll-snap-align: start;
    }
    .jb-col-list {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
      min-height: 8rem;
      padding: 0.5rem;
      border-radius: var(--r-card);
      background: color-mix(in srgb, var(--tone) 6%, var(--surface-sunken));
      transition:
        background-color var(--dur-base) var(--motion-ease),
        box-shadow var(--dur-base) var(--motion-ease);
    }
    .jb-col-list.cdk-drop-list-dragging {
      background: color-mix(in srgb, var(--tone) 14%, var(--surface-sunken));
      box-shadow: inset 0 0 0 2px
        color-mix(in srgb, var(--tone) 45%, transparent);
    }
    .jb-board-card {
      padding: 0.875rem;
    }
    .jb-drag {
      cursor: grab;
    }
    .jb-drag:active {
      cursor: grabbing;
    }
    .cdk-drag-preview .jb-board-card {
      box-shadow: var(--elev-overlay);
      transform: rotate(1.5deg);
    }
    .cdk-drag-animating {
      transition: transform var(--dur-slow) var(--motion-ease);
    }
    .jb-card-placeholder {
      min-height: 5.5rem;
      border: 2px dashed color-mix(in srgb, var(--tone) 55%, transparent);
      border-radius: var(--r-card);
    }
    .cdk-drop-list-dragging .jb-drag:not(.cdk-drag-placeholder) {
      transition: transform var(--dur-base) var(--motion-ease);
    }
  `,
})
export class Board {
  protected readonly repo = inject(RolesRepo);
  private readonly toast = inject(Toast);
  readonly columns = COLUMNS;
  readonly labels = ROLE_STATUS_LABELS;
  readonly mobileCol = signal<RoleStatus>('new');

  readonly byStatus = computed<Record<RoleStatus, RoleRow[]>>(() => {
    const groups = Object.fromEntries(
      [...COLUMNS, 'skipped'].map((s) => [s, [] as RoleRow[]]),
    ) as Record<RoleStatus, RoleRow[]>;
    for (const r of this.repo.roles()) groups[r.status].push(r);
    for (const s of COLUMNS) groups[s].sort((a, b) => b.score - a.score);
    return groups;
  });

  constructor() {
    void this.repo.load();
  }

  tone(col: RoleStatus) {
    return `var(--status-${col})`;
  }

  async drop(event: CdkDragDrop<RoleStatus, RoleStatus, RoleRow>) {
    const target = event.container.data;
    const role = event.item.data;
    if (!role || role.status === target) return;
    const from = role.status;
    try {
      await this.repo.setStatus(role.id, target);
      this.toast.show(`${role.company} moved to ${this.labels[target]}`, {
        action: {
          label: 'Undo',
          run: async () => {
            try {
              await this.repo.setStatus(role.id, from);
            } catch {
              this.toast.error('Could not undo the move');
            }
          },
        },
      });
    } catch {
      this.toast.error('Could not move the card');
    }
  }
}
