import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  EMPLOYMENT_TYPE_LABELS,
  ROLE_STATUSES,
  ROLE_STATUS_LABELS,
  type EmploymentType,
  type RoleRow,
  type RoleStatus,
  type SavedViewRow,
} from '@jobbotix/shared-types';
import { RolesRepo, SavedViewsRepo } from '../../core/data/repos';
import { RelativeDayPipe, TypeLabelPipe, scoreBand } from '../../shared/format';
import { RoleCard } from '../../shared/role-card';
import { RoleMover } from '../../shared/role-mover';
import { Viewport } from '../../core/viewport';
import { Toast } from '../../shared/toast';
import {
  Button,
  Confirm,
  EmptyState,
  Icon,
  MatchRing,
  PageHeader,
  PullRefresh,
  Sheet,
  Skeleton,
  SwipeRow,
  type SwipeAction,
} from '../../ui';
import { StatusSelect } from '../../shared/status-select';

type Sort = 'score' | 'found' | 'posted' | 'company' | 'status';
type ScoreBand = '' | '80' | '60' | '0';

interface Filters {
  q: string;
  status: RoleStatus | '';
  type: EmploymentType | '';
  band: ScoreBand;
  ai: boolean;
  source: string;
  sort: Sort;
}

const DEFAULT_FILTERS: Filters = {
  q: '',
  status: '',
  type: '',
  band: '',
  ai: false,
  source: '',
  sort: 'score',
};
/** Every role, as a sortable, filterable table (cards on phones) with keyboard navigation. */
@Component({
  selector: 'jb-roles',
  imports: [
    Button,
    EmptyState,
    Icon,
    MatchRing,
    NgTemplateOutlet,
    PageHeader,
    PullRefresh,
    RelativeDayPipe,
    RoleCard,
    RouterLink,
    Sheet,
    Skeleton,
    StatusSelect,
    SwipeRow,
    TypeLabelPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <jb-pull-refresh [action]="refresh" />
    <jb-page-header title="Roles">
      <p lead class="mt-2 text-ink-muted">
        {{ rows().length }} of {{ repo.roles().length }} roles<span
          class="hidden [@media(hover:hover)]:inline"
          >. Use <kbd class="jb-kbd">↑</kbd> <kbd class="jb-kbd">↓</kbd> to
          move, <kbd class="jb-kbd">Enter</kbd> to open.</span
        >
      </p>
      <div actions class="hidden gap-2 md:flex">
        <a jbButton="primary" routerLink="/roles/new"
          ><jb-icon name="plus" /> Add role</a
        >
      </div>
    </jb-page-header>

    <!-- Toolbar -->
    <div
      class="mt-6 flex flex-col gap-3"
      role="search"
      data-tour="roles-search"
    >
      <div class="flex gap-2">
        <label class="relative min-w-0 flex-1">
          <span class="sr-only">Search roles</span>
          <jb-icon
            name="search"
            [size]="18"
            class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint"
          />
          <input
            id="roles-q"
            type="search"
            class="jb-input pl-10"
            placeholder="Search company, title, stack"
            [value]="filters().q"
            (input)="set('q', $any($event.target).value)"
          />
        </label>
        <button
          type="button"
          jbButton
          class="md:hidden"
          aria-haspopup="dialog"
          (click)="filtersOpen.set(true)"
        >
          <jb-icon name="list-filter" />
          Filters
          @if (activeCount()) {
            <span class="jb-count bg-brand-tint text-brand-ink">{{
              activeCount()
            }}</span>
          }
        </button>
      </div>
      <div class="hidden flex-wrap items-center gap-2 md:flex">
        <ng-container *ngTemplateOutlet="controls" />
      </div>

      @if (views().length || !isDefault()) {
        <div class="flex flex-wrap items-center gap-2">
          @for (v of views(); track v.id) {
            <span class="inline-flex items-center">
              <button
                type="button"
                class="jb-chip rounded-r-none pr-2"
                [class.is-on]="isCurrent(v)"
                (click)="applyView(v)"
              >
                <jb-icon name="bookmark" [size]="14" />
                {{ v.name }}
              </button>
              <button
                type="button"
                class="jb-chip rounded-l-none border-l-0 px-2"
                [class.is-on]="isCurrent(v)"
                [attr.aria-label]="'Delete view ' + v.name"
                (click)="removeView(v)"
              >
                <jb-icon name="x" [size]="14" />
              </button>
            </span>
          }
          @if (!isDefault()) {
            @if (naming()) {
              <form
                class="flex items-center gap-2"
                (submit)="
                  $event.preventDefault();
                  saveView(viewName.value);
                  viewName.value = ''
                "
              >
                <input
                  #viewName
                  id="roles-view-name"
                  class="jb-input min-h-9 w-44"
                  placeholder="Name this view"
                  aria-label="View name"
                />
                <button type="submit" jbButton="primary" size="sm">Save</button>
                <button
                  type="button"
                  jbButton="ghost"
                  size="sm"
                  (click)="naming.set(false)"
                >
                  Cancel
                </button>
              </form>
            } @else {
              <button
                type="button"
                class="jb-chip border-dashed"
                (click)="startNaming()"
              >
                <jb-icon name="plus" [size]="14" /> Save as view
              </button>
            }
            <button type="button" jbButton="ghost" size="sm" (click)="reset()">
              Clear filters
            </button>
          }
        </div>
      }
    </div>

    <!-- Results -->
    <div class="mt-6">
      <h2 class="sr-only">Results</h2>
      @if (!repo.loaded()) {
        <jb-skeleton shape="row" [count]="6" />
      } @else if (repo.roles().length === 0) {
        <jb-empty-state title="No roles yet" icon="inbox">
          The daily search adds roles here. Until its first run, add a posting
          yourself.
          <div actions>
            <a jbButton="primary" routerLink="/roles/new"
              ><jb-icon name="plus" /> Add a role</a
            >
          </div>
        </jb-empty-state>
      } @else if (rows().length === 0) {
        <jb-empty-state
          title="Nothing matches these filters"
          icon="list-filter"
        >
          {{ repo.roles().length }} roles are hidden by the current filters.
          <div actions>
            <button type="button" jbButton (click)="reset()">
              Clear filters
            </button>
          </div>
        </jb-empty-state>
      } @else {
        @if (viewport.phone()) {
          <!-- Phones: cards. The first screenful renders at once, the rest
               as it scrolls into view. -->
          <div class="flex flex-col gap-3">
            @for (r of rows().slice(0, firstScreen); track r.id) {
              <ng-container
                *ngTemplateOutlet="phoneCard; context: { $implicit: r }"
              />
            }
            @if (rows().length > firstScreen) {
              @defer (on viewport; prefetch on idle) {
                @for (r of rows().slice(firstScreen); track r.id) {
                  <ng-container
                    *ngTemplateOutlet="phoneCard; context: { $implicit: r }"
                  />
                }
              } @placeholder {
                <div class="h-40 rounded-card bg-sunken/60"></div>
              }
            }
          </div>
        } @else {
          <!-- Tablets and up: table -->
          <div class="jb-card overflow-hidden">
            <table class="w-full text-sm">
              <thead>
                <tr
                  class="border-b border-line text-left text-xs font-medium text-ink-muted"
                >
                  <th class="w-16 py-3 pr-2 pl-5 font-medium">Match</th>
                  <th class="py-3 pr-4 font-medium">Role</th>
                  <th class="hidden py-3 pr-4 font-medium lg:table-cell">
                    Type
                  </th>
                  <th class="hidden py-3 pr-4 font-medium xl:table-cell">
                    Remote
                  </th>
                  <th class="py-3 pr-4 font-medium">Found</th>
                  <th class="py-3 pr-5 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                @for (r of rows(); track r.id; let i = $index) {
                  <tr
                    class="jb-row border-b border-line last:border-b-0"
                    [class.jb-row-active]="i === active()"
                    [attr.tabindex]="i === active() ? 0 : -1"
                    [attr.aria-selected]="i === active()"
                    [attr.data-index]="i"
                    (focus)="active.set(i)"
                    (keydown)="onKey($event)"
                    (click)="open(r)"
                  >
                    <td class="py-3 pr-2 pl-5">
                      <jb-match-ring [score]="r.score" size="xs" />
                    </td>
                    <td class="min-w-0 py-3 pr-4">
                      <a
                        [routerLink]="['/roles', r.id]"
                        class="font-semibold text-ink no-underline hover:underline"
                        (click)="$event.stopPropagation()"
                        >{{ r.title }}</a
                      >
                      <div
                        class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-muted"
                      >
                        {{ r.company }}
                        @if (r.ai_match) {
                          <span
                            class="jb-tag jb-tag-ai min-h-5 px-2 text-[0.6875rem]"
                            >AI</span
                          >
                        }
                        @if (r.salary) {
                          <span class="text-xs text-ink-muted">{{
                            r.salary
                          }}</span>
                        }
                      </div>
                    </td>
                    <td
                      class="hidden py-3 pr-4 whitespace-nowrap text-ink-muted lg:table-cell"
                    >
                      {{ r.type | typeLabel }}
                    </td>
                    <td class="hidden py-3 pr-4 text-ink-muted xl:table-cell">
                      {{ r.location }}
                    </td>
                    <td class="py-3 pr-4 whitespace-nowrap text-ink-muted">
                      {{ r.found_at | relativeDay }}
                    </td>
                    <td class="py-3 pr-5 text-right">
                      <jb-status-select [role]="r" />
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
    </div>

    <jb-sheet [(open)]="filtersOpen" title="Filter roles">
      <div class="flex flex-col gap-4">
        <ng-container
          *ngTemplateOutlet="controls; context: { stacked: true }"
        />
      </div>
      <div footer>
        <button type="button" jbButton (click)="reset()">Clear</button>
        <button
          type="button"
          jbButton="primary"
          (click)="filtersOpen.set(false)"
        >
          Show {{ rows().length }} roles
        </button>
      </div>
    </jb-sheet>

    <ng-template #phoneCard let-r>
      <jb-swipe-row
        [start]="shortlistAction"
        [end]="skipAction"
        (startAction)="mover.move(r, 'shortlist')"
        (endAction)="mover.move(r, 'skipped')"
      >
        <jb-role-card [role]="r" [showReasons]="false" />
      </jb-swipe-row>
    </ng-template>

    <ng-template #controls let-stacked="stacked">
      <label
        [class]="
          stacked ? 'flex flex-col gap-1.5 text-sm font-medium' : 'contents'
        "
      >
        @if (stacked) {
          Status
        }
        <select
          class="jb-input"
          [class.w-auto]="!stacked"
          aria-label="Status"
          (change)="set('status', $any($event.target).value)"
        >
          <option value="" [selected]="filters().status === ''">
            All statuses
          </option>
          @for (s of statuses; track s) {
            <option [value]="s" [selected]="s === filters().status">
              {{ statusLabels[s] }}
            </option>
          }
        </select>
      </label>
      <label
        [class]="
          stacked ? 'flex flex-col gap-1.5 text-sm font-medium' : 'contents'
        "
      >
        @if (stacked) {
          Type
        }
        <select
          class="jb-input"
          [class.w-auto]="!stacked"
          aria-label="Type"
          (change)="set('type', $any($event.target).value)"
        >
          <option value="" [selected]="filters().type === ''">All types</option>
          <option value="full_time" [selected]="filters().type === 'full_time'">
            {{ typeLabels.full_time }}
          </option>
          <option value="contract" [selected]="filters().type === 'contract'">
            {{ typeLabels.contract }}
          </option>
        </select>
      </label>
      <label
        [class]="
          stacked ? 'flex flex-col gap-1.5 text-sm font-medium' : 'contents'
        "
      >
        @if (stacked) {
          Match score
        }
        <select
          class="jb-input"
          [class.w-auto]="!stacked"
          aria-label="Match score"
          (change)="set('band', $any($event.target).value)"
        >
          <option value="" [selected]="filters().band === ''">Any score</option>
          <option value="80" [selected]="filters().band === '80'">
            80 and up
          </option>
          <option value="60" [selected]="filters().band === '60'">60–79</option>
          <option value="0" [selected]="filters().band === '0'">
            Under 60
          </option>
        </select>
      </label>
      <label
        [class]="
          stacked ? 'flex flex-col gap-1.5 text-sm font-medium' : 'contents'
        "
      >
        @if (stacked) {
          Source
        }
        <select
          class="jb-input"
          [class.w-auto]="!stacked"
          aria-label="Source"
          (change)="set('source', $any($event.target).value)"
        >
          <option value="" [selected]="filters().source === ''">
            All sources
          </option>
          @for (src of sources(); track src) {
            <option [value]="src" [selected]="src === filters().source">
              {{ src }}
            </option>
          }
        </select>
      </label>
      <label
        [class]="
          stacked ? 'flex flex-col gap-1.5 text-sm font-medium' : 'contents'
        "
      >
        @if (stacked) {
          Sort by
        }
        <select
          class="jb-input"
          [class.w-auto]="!stacked"
          aria-label="Sort by"
          (change)="set('sort', $any($event.target).value)"
        >
          <option value="score" [selected]="filters().sort === 'score'">
            Best match
          </option>
          <option value="found" [selected]="filters().sort === 'found'">
            Newest found
          </option>
          <option value="posted" [selected]="filters().sort === 'posted'">
            Recently posted
          </option>
          <option value="company" [selected]="filters().sort === 'company'">
            Company A–Z
          </option>
          <option value="status" [selected]="filters().sort === 'status'">
            Status
          </option>
        </select>
      </label>
      <label
        class="inline-flex min-h-10 items-center gap-2.5 text-sm text-ink"
        [class.ml-1]="!stacked"
      >
        <input
          type="checkbox"
          role="switch"
          class="jb-switch"
          [checked]="filters().ai"
          (change)="set('ai', $any($event.target).checked)"
        />
        AI-assisted only
      </label>
    </ng-template>
  `,
  styles: `
    .jb-row {
      cursor: pointer;
      transition: background-color var(--dur-fast) var(--motion-ease);
    }
    .jb-row:hover {
      background: color-mix(in srgb, var(--brand) 5%, transparent);
    }
    .jb-row-active {
      background: color-mix(in srgb, var(--brand) 9%, transparent);
      outline: none;
    }
    .jb-row:focus-visible {
      outline: 2px solid var(--line-focus);
      outline-offset: -2px;
    }
  `,
})
export class Roles {
  protected readonly repo = inject(RolesRepo);
  private readonly router = inject(Router);

  readonly statuses = ROLE_STATUSES;
  readonly statusLabels = ROLE_STATUS_LABELS;
  readonly typeLabels = EMPLOYMENT_TYPE_LABELS;

  private readonly confirm = inject(Confirm);
  protected readonly mover = inject(RoleMover);
  protected readonly viewport = inject(Viewport);
  /** Phone cards rendered before the user scrolls. */
  protected readonly firstScreen = 8;
  // Touch shortcuts on phone cards; the status pill on each card does the same.
  readonly shortlistAction: SwipeAction = {
    label: 'To apply',
    icon: 'bookmark',
    tone: 'brand',
  };
  readonly skipAction: SwipeAction = {
    label: 'Skip',
    icon: 'x',
    tone: 'muted',
  };
  readonly refresh = () => this.repo.load();
  private readonly toast = inject(Toast);
  readonly filters = signal<Filters>({ ...DEFAULT_FILTERS });
  readonly filtersOpen = signal(false);
  /** Filters set besides search and sort, for the phone Filters button. */
  readonly activeCount = computed(() => {
    const f = this.filters();
    return [f.status, f.type, f.band, f.source, f.ai].filter(Boolean).length;
  });
  readonly active = signal(0);
  private readonly viewsRepo = inject(SavedViewsRepo);
  readonly views = this.viewsRepo.views;

  readonly isDefault = computed(
    () => JSON.stringify(this.filters()) === JSON.stringify(DEFAULT_FILTERS),
  );

  readonly sources = computed(() =>
    [
      ...new Set(
        this.repo
          .roles()
          .map((r) => r.source)
          .filter(Boolean),
      ),
    ].sort(),
  );

  readonly rows = computed<RoleRow[]>(() => {
    const f = this.filters();
    const q = f.q.trim().toLowerCase();
    const list = this.repo.roles().filter((r) => {
      if (f.status && r.status !== f.status) return false;
      if (f.type && r.type !== f.type) return false;
      if (f.source && r.source !== f.source) return false;
      if (f.ai && !r.ai_match) return false;
      if (f.band === '80' && r.score < 80) return false;
      if (f.band === '60' && (r.score < 60 || r.score >= 80)) return false;
      if (f.band === '0' && r.score >= 60) return false;
      if (q) {
        const hay = [
          r.company,
          r.title,
          r.location,
          r.source,
          r.salary,
          ...r.stack,
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const statusOrder = Object.fromEntries(ROLE_STATUSES.map((s, i) => [s, i]));
    return list.sort((a, b) => {
      switch (f.sort) {
        case 'found':
          return b.found_at.localeCompare(a.found_at);
        case 'posted':
          return (b.posted_at ?? '').localeCompare(a.posted_at ?? '');
        case 'company':
          return a.company.localeCompare(b.company) || b.score - a.score;
        case 'status':
          return (
            statusOrder[a.status] - statusOrder[b.status] || b.score - a.score
          );
        default:
          return b.score - a.score || b.found_at.localeCompare(a.found_at);
      }
    });
  });

  private readonly route = inject(ActivatedRoute);

  constructor() {
    void this.repo.load();
    void this.viewsRepo.load();
    const status = this.route.snapshot.queryParamMap.get(
      'status',
    ) as RoleStatus | null;
    if (status && (ROLE_STATUSES as readonly string[]).includes(status))
      this.set('status', status);
    // keep the active row inside the list when filters shrink it
    effect(() => {
      const n = this.rows().length;
      if (this.active() >= n) this.active.set(Math.max(0, n - 1));
    });
  }

  set<K extends keyof Filters>(key: K, value: Filters[K]) {
    this.filters.update((f) => ({ ...f, [key]: value }));
  }

  reset() {
    this.filters.set({ ...DEFAULT_FILTERS });
  }

  band(score: number) {
    return scoreBand(score);
  }

  open(r: RoleRow) {
    void this.router.navigate(['/roles', r.id]);
  }

  onKey(e: KeyboardEvent) {
    const rows = this.rows();
    if (!rows.length) return;
    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault();
      this.focusRow(Math.min(rows.length - 1, this.active() + 1));
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault();
      this.focusRow(Math.max(0, this.active() - 1));
    } else if (
      e.key === 'Enter' &&
      (e.target as HTMLElement).tagName === 'TR'
    ) {
      e.preventDefault();
      this.open(rows[this.active()]);
    }
  }

  private focusRow(i: number) {
    this.active.set(i);
    queueMicrotask(() => {
      (
        document.querySelector(`tr[data-index="${i}"]`) as HTMLElement | null
      )?.focus();
    });
  }

  applyView(v: SavedViewRow) {
    const f = (v.filters ?? {}) as Partial<Filters>;
    this.filters.set({
      ...DEFAULT_FILTERS,
      ...f,
      sort: (v.sort as Sort) || 'score',
    });
  }

  async removeView(v: SavedViewRow) {
    const ok = await this.confirm.ask({
      title: `Delete the view “${v.name}”?`,
      body: 'Only the saved filters go; no roles are touched.',
      action: 'Delete view',
      danger: true,
    });
    if (!ok) return;
    try {
      await this.viewsRepo.remove(v.id);
      this.toast.show(`Deleted “${v.name}”`);
    } catch {
      this.toast.error('Could not delete the view');
    }
  }

  isCurrent(v: SavedViewRow) {
    const f = (v.filters ?? {}) as Partial<Filters>;
    const view = {
      ...DEFAULT_FILTERS,
      ...f,
      sort: (v.sort as Sort) || 'score',
    };
    return JSON.stringify(view) === JSON.stringify(this.filters());
  }

  startNaming() {
    this.naming.set(true);
    queueMicrotask(() => document.getElementById('roles-view-name')?.focus());
  }

  readonly naming = signal(false);

  async saveView(name: string) {
    name = name.trim();
    if (!name) return;
    this.naming.set(false);
    const { sort, ...rest } = this.filters();
    try {
      await this.viewsRepo.save(name, rest, sort);
      this.toast.success(`Saved view “${name}”`);
    } catch {
      this.toast.error('Could not save the view');
    }
  }
}
