import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  adminUsersCsvRows,
  aiRouteLabel,
  type AdminAiRoute,
  type AdminUserFilters,
  type AdminUserRow,
} from '@jobbotix/shared-types';
import { AdminRepo } from '../../core/data/repos';
import { toCsv } from '../../shared/csv';
import { RelativeDayPipe } from '../../shared/format';
import { Toast } from '../../shared/toast';
import { BackLink, Button, Icon, PageHeader, Skeleton } from '../../ui';

const PAGE = 50;

function download(name: string, type: string, body: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([body], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * Admin: every account, with search and filters by plan and by how its AI is
 * paid for, and a CSV of whatever the filters show. Nothing here is an
 * account's content; each row opens the account.
 */
@Component({
  selector: 'jb-admin-users',
  imports: [
    BackLink,
    Button,
    FormsModule,
    Icon,
    PageHeader,
    RelativeDayPipe,
    RouterLink,
    Skeleton,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <jb-back-link link="/admin" label="Admin" />
    <jb-page-header
      title="Users"
      lead="Every account, its plan and how its AI is paid for. Opening this page and each account is recorded."
    >
      <div actions>
        <button
          type="button"
          jbButton
          [busy]="exporting()"
          [disabled]="exporting() || !total()"
          (click)="exportCsv()"
        >
          <jb-icon name="download" /> Export CSV
        </button>
      </div>
    </jb-page-header>

    <form
      class="mt-6 flex flex-wrap items-end gap-3"
      role="search"
      (ngSubmit)="search()"
    >
      <label class="flex min-w-0 flex-1 basis-56 flex-col gap-1 text-sm">
        <span>Search</span>
        <input
          class="jb-input"
          type="search"
          name="q"
          placeholder="Email or name"
          autocomplete="off"
          [ngModel]="q()"
          (ngModelChange)="q.set($event)"
        />
      </label>
      <label class="flex flex-col gap-1 text-sm">
        <span>Plan</span>
        <select
          class="jb-input"
          name="plan"
          [ngModel]="plan()"
          (ngModelChange)="plan.set($event); search()"
        >
          <option value="">Any plan</option>
          <option value="free">Free</option>
          <option value="pro">Pro</option>
        </select>
      </label>
      <label class="flex flex-col gap-1 text-sm">
        <span>AI paid by</span>
        <select
          class="jb-input"
          name="route"
          [ngModel]="route()"
          (ngModelChange)="route.set($event); search()"
        >
          <option value="">Any</option>
          <option value="credits">Credits</option>
          <option value="own">Own key</option>
          <option value="none">No AI</option>
        </select>
      </label>
      <button type="submit" jbButton="primary" [disabled]="loading()">
        Search
      </button>
    </form>

    <section class="jb-card mt-6 p-5 md:p-6">
      @if (error()) {
        <p class="text-sm text-bad" role="alert">{{ error() }}</p>
      } @else if (loading() && !rows().length) {
        <jb-skeleton shape="row" [count]="4" />
      } @else if (!rows().length) {
        <p class="text-sm text-ink-muted">No account matches.</p>
      } @else {
        <p class="text-sm text-ink-muted" role="status">
          {{ rows().length }} of {{ total() }}
          {{ total() === 1 ? 'account' : 'accounts' }}
        </p>
        <div
          class="-mx-5 mt-3 overflow-x-auto px-5 md:-mx-6 md:px-6"
          tabindex="0"
          role="region"
          aria-label="Users table"
        >
          <table class="w-full text-sm">
            <thead class="text-left text-xs whitespace-nowrap text-ink-muted">
              <tr>
                <th class="py-2 pr-4">User</th>
                <th class="py-2 pr-4">Plan</th>
                <th class="py-2 pr-4">Credits</th>
                <th class="py-2 pr-4">AI paid by</th>
                <th class="py-2 pr-4">Roles</th>
                <th class="py-2 pr-4">AI calls, 30 days</th>
                <th class="py-2 pr-4">Signed up</th>
                <th class="py-2">Last active</th>
              </tr>
            </thead>
            <tbody>
              @for (u of rows(); track u.id) {
                <tr class="border-t border-line align-top">
                  <td class="py-2 pr-4">
                    <a
                      [routerLink]="['/admin/users', u.id]"
                      class="font-medium text-brand-ink underline"
                      >{{ u.email }}</a
                    >
                    <div class="text-xs text-ink-muted">
                      {{ u.name }}
                      @if (u.is_admin) {
                        <span class="jb-tag ml-1">Admin</span>
                      }
                      @if (u.suspended) {
                        <span class="jb-tag jb-tag-bad ml-1">Suspended</span>
                      }
                      @if (u.support_access) {
                        <span class="jb-tag jb-tag-warn ml-1"
                          >Support access</span
                        >
                      }
                    </div>
                  </td>
                  <td class="py-2 pr-4 whitespace-nowrap">
                    {{ u.plan_name }}
                    @if (u.status !== 'none' && u.status !== 'active') {
                      <span class="text-xs text-ink-muted"
                        >· {{ u.status.replace('_', ' ') }}</span
                      >
                    }
                  </td>
                  <td class="py-2 pr-4 tabular-nums">{{ u.credits }}</td>
                  <td class="py-2 pr-4">{{ ai(u) }}</td>
                  <td class="py-2 pr-4 tabular-nums">{{ u.roles }}</td>
                  <td class="py-2 pr-4 tabular-nums">{{ u.ai_calls_30d }}</td>
                  <td class="py-2 pr-4 whitespace-nowrap">
                    {{ u.created_at | relativeDay }}
                  </td>
                  <td class="py-2 whitespace-nowrap">
                    @if (u.last_active) {
                      {{ u.last_active | relativeDay }}
                    } @else {
                      <span class="text-ink-muted">never</span>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        @if (rows().length < total()) {
          <button
            type="button"
            jbButton="ghost"
            class="mt-3"
            [busy]="loading()"
            [disabled]="loading()"
            (click)="more()"
          >
            Show more
          </button>
        }
      }
    </section>
  `,
})
export class AdminUsers {
  private readonly repo = inject(AdminRepo);
  private readonly toast = inject(Toast);

  readonly q = signal('');
  readonly plan = signal<'' | 'free' | 'pro'>('');
  readonly route = signal<'' | AdminAiRoute>('');
  readonly rows = signal<AdminUserRow[]>([]);
  readonly total = signal(0);
  readonly loading = signal(true);
  readonly exporting = signal(false);
  readonly error = signal('');

  private readonly filters = computed<AdminUserFilters>(() => ({
    q: this.q().trim(),
    plan: this.plan() || null,
    route: this.route() || null,
  }));
  /** Bumped by every search, so a slow earlier answer cannot land on top. */
  private asked = 0;

  constructor() {
    void this.search();
  }

  ai(u: AdminUserRow) {
    return aiRouteLabel(u);
  }

  async search() {
    await this.load(0);
  }

  async more() {
    await this.load(this.rows().length);
  }

  private async load(offset: number) {
    const mine = ++this.asked;
    this.loading.set(true);
    this.error.set('');
    try {
      const page = await this.repo.users({
        ...this.filters(),
        limit: PAGE,
        offset,
      });
      if (mine !== this.asked) return;
      this.total.set(page.total);
      this.rows.set(offset ? [...this.rows(), ...page.users] : page.users);
    } catch (e) {
      if (mine === this.asked)
        this.error.set((e as Error).message || 'Could not load the accounts');
    } finally {
      if (mine === this.asked) this.loading.set(false);
    }
  }

  async exportCsv() {
    this.exporting.set(true);
    try {
      const users = await this.repo.exportUsers(this.filters());
      download(
        `jobbotix-users-${new Date().toISOString().slice(0, 10)}.csv`,
        'text/csv;charset=utf-8',
        toCsv(adminUsersCsvRows(users)),
      );
      this.toast.show(
        `Exported ${users.length} ${users.length === 1 ? 'account' : 'accounts'}`,
      );
    } catch (e) {
      this.toast.show(
        `Could not export: ${(e as Error).message || 'try again'}`,
      );
    } finally {
      this.exporting.set(false);
    }
  }
}
