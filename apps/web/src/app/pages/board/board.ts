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
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  ROLE_STATUS_LABELS,
  type RoleRow,
  type RoleStatus,
} from '@jobbotix/shared-types';
import { RolesRepo } from '../../core/data/repos';
import { RelativeDayPipe, scoreBand } from '../../shared/format';
import { ShareButton } from '../../shared/share-button';
import { Toast } from '../../shared/toast';

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
    RouterLink,
    RelativeDayPipe,
    ShareButton,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="flex h-full flex-col gap-4">
      <header class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight">Board</h1>
          <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
            Drag a card to change its status. Skipped roles are kept out of the
            way under
            <a
              routerLink="/roles"
              [queryParams]="{ status: 'skipped' }"
              class="underline"
              >Roles</a
            >.
          </p>
        </div>
        <jb-share-button kind="board" />
      </header>

      @if (repo.loaded() && repo.roles().length === 0) {
        <div class="jb-empty">
          <b>The board fills itself.</b> Each daily run adds new roles to the
          first column.
        </div>
      } @else {
        <div class="jb-board" cdkDropListGroup>
          @for (col of columns; track col) {
            <section class="jb-col" [attr.aria-label]="labels[col]">
              <h2
                class="jb-section-title flex items-center justify-between px-1"
              >
                {{ labels[col] }}
                <span class="font-mono font-normal tabular-nums">{{
                  byStatus()[col].length
                }}</span>
              </h2>
              <div
                class="jb-col-list"
                cdkDropList
                [id]="col"
                [cdkDropListData]="col"
                (cdkDropListDropped)="drop($event)"
              >
                @for (r of byStatus()[col]; track r.id) {
                  <article
                    class="jb-card jb-board-card"
                    cdkDrag
                    [cdkDragData]="r"
                    [class.jb-card-ai]="r.ai_match"
                  >
                    <div class="flex items-start justify-between gap-2">
                      <a
                        [routerLink]="['/roles', r.id]"
                        class="min-w-0 font-medium leading-snug hover:underline"
                        >{{ r.title }}</a
                      >
                      <span
                        class="font-mono text-sm tabular-nums jb-score-{{
                          band(r.score)
                        }}"
                        >{{ r.score }}</span
                      >
                    </div>
                    <div
                      class="mt-0.5 text-sm text-neutral-600 dark:text-neutral-300"
                    >
                      {{ r.company }}
                    </div>
                    <div
                      class="mt-2 flex flex-wrap gap-1 text-xs text-neutral-500"
                    >
                      <span>{{ r.status_changed_at | relativeDay }}</span>
                      @if (r.salary) {
                        <span>· {{ r.salary }}</span>
                      }
                    </div>
                    <div class="jb-card-placeholder" *cdkDragPlaceholder></div>
                  </article>
                } @empty {
                  <p class="px-1 py-2 text-xs text-neutral-400">Drop here</p>
                }
              </div>
            </section>
          }
        </div>
      }
    </section>
  `,
  styles: `
    .jb-board {
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: minmax(230px, 1fr);
      gap: 0.75rem;
      overflow-x: auto;
      padding-bottom: 0.5rem;
    }
    .jb-col {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .jb-col-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      min-height: 6rem;
      padding: 0.25rem;
      border-radius: 0.5rem;
      background: color-mix(in srgb, currentColor 4%, transparent);
    }
    .jb-col-list.cdk-drop-list-dragging {
      background: color-mix(in srgb, var(--color-brand-500) 10%, transparent);
    }
    .jb-board-card {
      padding: 0.75rem;
      cursor: grab;
    }
    .jb-board-card:active {
      cursor: grabbing;
    }
    .cdk-drag-preview {
      box-shadow: 0 8px 24px rgb(0 0 0 / 0.18);
      border-radius: 0.5rem;
    }
    .cdk-drag-animating {
      transition: transform 180ms cubic-bezier(0, 0, 0.2, 1);
    }
    .jb-card-placeholder {
      min-height: 4.5rem;
      border: 2px dashed var(--color-brand-500);
      border-radius: 0.5rem;
      opacity: 0.6;
    }
    @media (prefers-reduced-motion: reduce) {
      .cdk-drag-animating {
        transition: none;
      }
    }
  `,
})
export class Board {
  protected readonly repo = inject(RolesRepo);
  private readonly toast = inject(Toast);
  readonly columns = COLUMNS;
  readonly labels = ROLE_STATUS_LABELS;

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

  band(score: number) {
    return scoreBand(score);
  }

  async drop(event: CdkDragDrop<RoleStatus, RoleStatus, RoleRow>) {
    const target = event.container.data;
    const role = event.item.data;
    if (!role || role.status === target) return;
    try {
      await this.repo.setStatus(role.id, target);
      this.toast.show(`${role.company}: ${this.labels[target]}`);
    } catch {
      this.toast.show('Could not move the card');
    }
  }
}
