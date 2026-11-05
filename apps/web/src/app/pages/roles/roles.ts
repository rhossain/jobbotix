import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  EMPLOYMENT_TYPE_LABELS,
  ROLE_STATUSES,
  ROLE_STATUS_LABELS,
  type EmploymentType,
  type RoleRow,
  type RoleStatus,
} from '@jobbotix/shared-types';
import { RolesRepo } from '../../core/data/repos';
import { RelativeDayPipe, TypeLabelPipe, scoreBand } from '../../shared/format';
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
const VIEWS_KEY = 'jobbotix.views.v1';

interface SavedView {
  name: string;
  filters: Filters;
}

/** Every role, as a sortable, filterable table with keyboard navigation. */
@Component({
  selector: 'jb-roles',
  imports: [RouterLink, RelativeDayPipe, TypeLabelPipe, StatusSelect],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="flex flex-col gap-4">
      <header class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight">Roles</h1>
          <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
            {{ rows().length }} of {{ repo.roles().length }} roles. Use ↑ ↓ to
            move, Enter to open.
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          @for (v of views(); track v.name) {
            <button type="button" class="jb-btn" (click)="applyView(v)">
              {{ v.name }}
            </button>
          }
          @if (naming()) {
            <form
              class="flex gap-2"
              (submit)="
                $event.preventDefault();
                saveView(viewName.value);
                viewName.value = ''
              "
            >
              <input
                #viewName
                id="roles-view-name"
                class="jb-input w-40"
                placeholder="View name"
                aria-label="View name"
              />
              <button type="submit" class="jb-btn-primary">Save</button>
              <button type="button" class="jb-btn" (click)="naming.set(false)">
                Cancel
              </button>
            </form>
          } @else {
            <button
              type="button"
              class="jb-btn"
              (click)="naming.set(true)"
              [disabled]="isDefault()"
            >
              Save view…
            </button>
          }
        </div>
      </header>

      <div class="flex flex-wrap gap-2" role="search">
        <input
          id="roles-q"
          type="search"
          class="jb-input flex-1 basis-56"
          placeholder="Search company, title, stack…"
          aria-label="Search roles"
          [value]="filters().q"
          (input)="set('q', $any($event.target).value)"
        />
        <select
          id="roles-status"
          class="jb-input jb-input-inline"
          aria-label="Status"
          [value]="filters().status"
          (change)="set('status', $any($event.target).value)"
        >
          <option value="">All statuses</option>
          @for (s of statuses; track s) {
            <option [value]="s" [selected]="s === filters().status">
              {{ statusLabels[s] }}
            </option>
          }
        </select>
        <select
          id="roles-type"
          class="jb-input jb-input-inline"
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
        <select
          id="roles-band"
          class="jb-input jb-input-inline"
          aria-label="Score"
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
        <select
          id="roles-source"
          class="jb-input jb-input-inline"
          aria-label="Source"
          (change)="set('source', $any($event.target).value)"
        >
          <option value="" [selected]="filters().source === ''">
            All sources
          </option>
          @for (s of sources(); track s) {
            <option [value]="s" [selected]="s === filters().source">
              {{ s }}
            </option>
          }
        </select>
        <label class="flex items-center gap-2 text-sm">
          <input
            id="roles-ai"
            type="checkbox"
            [checked]="filters().ai"
            (change)="set('ai', $any($event.target).checked)"
          />
          AI-assisted only
        </label>
        <select
          id="roles-sort"
          class="jb-input jb-input-inline"
          aria-label="Sort"
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
        @if (!isDefault()) {
          <button type="button" class="jb-btn" (click)="reset()">Clear</button>
        }
      </div>

      @if (!repo.loaded()) {
        <p class="text-sm text-neutral-500" role="status">Loading…</p>
      } @else if (repo.roles().length === 0) {
        <div class="jb-empty">
          <b>No roles yet.</b>
          The daily search adds roles here. Until the first run, nothing to
          triage.
        </div>
      } @else if (rows().length === 0) {
        <div class="jb-empty">
          <b>Nothing matches these filters.</b>
          <button type="button" class="underline" (click)="reset()">
            Clear them
          </button>
          to see all {{ repo.roles().length }} roles.
        </div>
      } @else {
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead
              class="text-left text-xs uppercase tracking-wide text-neutral-500"
            >
              <tr>
                <th class="py-2 pr-3">Score</th>
                <th class="py-2 pr-3">Role</th>
                <th class="py-2 pr-3">Type</th>
                <th class="py-2 pr-3">Remote</th>
                <th class="py-2 pr-3">Found</th>
                <th class="py-2 pr-3">Status</th>
              </tr>
            </thead>
            <tbody>
              @for (r of rows(); track r.id; let i = $index) {
                <tr
                  class="jb-row border-t border-neutral-200 dark:border-neutral-800"
                  [class.jb-row-active]="i === active()"
                  [attr.tabindex]="i === active() ? 0 : -1"
                  [attr.aria-selected]="i === active()"
                  [attr.data-index]="i"
                  (focus)="active.set(i)"
                  (keydown)="onKey($event)"
                  (click)="open(r)"
                >
                  <td
                    class="py-2 pr-3 font-mono tabular-nums jb-score-{{
                      band(r.score)
                    }}"
                  >
                    {{ r.score }}
                  </td>
                  <td class="min-w-0 py-2 pr-3">
                    <a
                      [routerLink]="['/roles', r.id]"
                      class="font-medium hover:underline"
                      (click)="$event.stopPropagation()"
                      >{{ r.title }}</a
                    >
                    <div class="text-neutral-600 dark:text-neutral-300">
                      {{ r.company }}
                      @if (r.ai_match) {
                        <span class="jb-tag jb-tag-ai ml-1">AI</span>
                      }
                      @if (r.salary) {
                        <span class="ml-1 text-xs text-neutral-500">{{
                          r.salary
                        }}</span>
                      }
                    </div>
                  </td>
                  <td class="py-2 pr-3 whitespace-nowrap">
                    {{ r.type | typeLabel }}
                  </td>
                  <td class="py-2 pr-3">{{ r.location }}</td>
                  <td
                    class="py-2 pr-3 whitespace-nowrap text-neutral-600 dark:text-neutral-300"
                  >
                    {{ r.found_at | relativeDay }}
                  </td>
                  <td class="py-2 pr-3"><jb-status-select [role]="r" /></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>
  `,
  styles: `
    .jb-row {
      cursor: pointer;
    }
    .jb-row:hover {
      background: color-mix(in srgb, var(--color-brand-500) 6%, transparent);
    }
    .jb-row-active {
      background: color-mix(in srgb, var(--color-brand-500) 12%, transparent);
      outline: none;
    }
    .jb-row:focus-visible {
      outline: 2px solid var(--color-brand-500);
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

  readonly filters = signal<Filters>({ ...DEFAULT_FILTERS });
  readonly active = signal(0);
  readonly views = signal<SavedView[]>(loadViews());

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

  constructor() {
    void this.repo.load();
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

  applyView(v: SavedView) {
    this.filters.set({ ...DEFAULT_FILTERS, ...v.filters });
  }

  readonly naming = signal(false);

  saveView(name: string) {
    name = name.trim();
    if (!name) return;
    this.naming.set(false);
    const next = [
      ...this.views().filter((v) => v.name !== name),
      { name, filters: this.filters() },
    ];
    this.views.set(next);
    try {
      localStorage.setItem(VIEWS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }
}

function loadViews(): SavedView[] {
  try {
    const raw = localStorage.getItem(VIEWS_KEY);
    return raw ? (JSON.parse(raw) as SavedView[]) : [];
  } catch {
    return [];
  }
}
