import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import {
  AdminRepo,
  type AdminTotals,
  type AdminUser,
} from '../../core/data/repos';
import { RelativeDayPipe } from '../../shared/format';
import { Toast } from '../../shared/toast';
import { AdminTabs } from './admin-tabs';
import { ErrorsPanel } from './errors-panel';
import { PlansPanel } from './plans-panel';
import { MoneyPanel } from './money-panel';
import { ProAiPanel } from './pro-ai-panel';
import { Button, Icon, PageHeader, Skeleton, tabIds } from '../../ui';

/** Supabase free tier, as published; the bars below are against these. */
const LIMITS = {
  dbBytes: 500 * 1024 * 1024,
  /** Edge Function invocations per month; runs + AI calls approximate ours. */
  edgeInvocations: 500_000,
  /** Monthly active users on the free tier. */
  mau: 50_000,
};

type OverviewTab = 'overview' | 'activity' | 'money';
function overviewTab(raw: string | null): OverviewTab {
  return raw === 'activity' || raw === 'money' ? raw : 'overview';
}

/**
 * Admin, three of its tabs: Overview (free-tier headroom, sign-up switch,
 * errors), Activity (each account's last 30 days) and Plans & AI. Users and
 * Invites are pages of their own under the same tab strip.
 */
@Component({
  selector: 'jb-admin-overview',
  imports: [
    AdminTabs,
    Button,
    ErrorsPanel,
    MoneyPanel,
    PlansPanel,
    ProAiPanel,
    Icon,
    PageHeader,
    RelativeDayPipe,
    RouterLink,
    Skeleton,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <jb-page-header title="Admin" [lead]="leads[tab()]" />
    <jb-admin-tabs class="mt-6" [current]="tab()" />
    <section
      class="mt-6 flex flex-col gap-6"
      role="tabpanel"
      [id]="ids().panel"
      [attr.aria-labelledby]="ids().tab"
    >
      @if (error()) {
        <p class="text-sm text-bad" role="alert">
          {{ error() }}
        </p>
      }
      @switch (tab()) {
        @case ('activity') {
          <section class="jb-card p-5 md:p-6">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <h2 class="jb-section-title">Activity, last 30 days</h2>
              <a jbButton="ghost" size="sm" routerLink="/admin/users"
                >Find an account <jb-icon name="arrow-up-right" [size]="16"
              /></a>
            </div>
            @if (!loaded() && !error()) {
              <jb-skeleton class="mt-3" shape="row" [count]="3" />
            } @else if (users().length === 0) {
              <p class="mt-2 text-sm text-ink-muted">No users yet.</p>
            } @else {
              <div
                class="-mx-5 mt-3 overflow-x-auto px-5 md:-mx-6 md:px-6"
                tabindex="0"
                role="region"
                aria-label="Users table"
              >
                <table class="w-full text-sm">
                  <thead
                    class="text-left text-xs whitespace-nowrap text-ink-muted"
                  >
                    <tr>
                      <th class="py-2 pr-4">User</th>
                      <th class="py-2 pr-4">Joined</th>
                      <th class="py-2 pr-4">Jobs</th>
                      <th class="py-2 pr-4">Applied</th>
                      <th class="py-2 pr-4">Last search</th>
                      <th class="py-2 pr-4">Searches / 30d</th>
                      <th class="py-2 pr-4">AI calls / 30d</th>
                      <th class="py-2">Keys</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (u of users(); track u.id) {
                      <tr class="border-t border-line">
                        <td class="py-2 pr-4">
                          <div class="font-medium">
                            {{ u.name || u.email }}
                            @if (u.is_admin) {
                              <span class="jb-tag ml-1">admin</span>
                            }
                          </div>
                          <div class="text-xs text-ink-muted">
                            {{ u.email }} · {{ u.timezone }}
                          </div>
                        </td>
                        <td class="py-2 pr-4">
                          {{ u.created_at | relativeDay }}
                        </td>
                        <td class="py-2 pr-4 tabular-nums">{{ u.roles }}</td>
                        <td class="py-2 pr-4 tabular-nums">{{ u.applied }}</td>
                        <td class="py-2 pr-4">
                          @if (u.last_run) {
                            {{ u.last_run | relativeDay }}
                          } @else {
                            <span class="text-warn">never</span>
                          }
                        </td>
                        <td class="py-2 pr-4 tabular-nums">{{ u.runs_30d }}</td>
                        <td class="py-2 pr-4 tabular-nums">
                          {{ u.ai_calls_30d }}
                          @if (u.has_ai_key) {
                            <span class="text-xs text-ink-muted"
                              >({{
                                u.ai_providers?.length
                                  ? u.ai_providers!.join(', ')
                                  : 'own key'
                              }})</span
                            >
                          }
                        </td>
                        <td class="py-2 tabular-nums">{{ u.ingest_keys }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </section>
        }
        @case ('money') {
          @if (users().length) {
            <jb-plans-panel [users]="users()" />
          }

          <jb-pro-ai-panel />

          <jb-money-panel />
        }
        @default {
          @if (totals(); as t) {
            <section>
              <h2 class="jb-section-title">Free-tier headroom</h2>
              <ul class="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <li class="jb-card p-5 text-sm">
                  <div class="flex justify-between gap-2">
                    <span class="font-medium text-ink">Database</span>
                    <span class="tabular-nums"
                      >{{ mb(t.db_bytes) }} / {{ mb(limits.dbBytes) }} MB</span
                    >
                  </div>
                  <div class="mt-3 h-2 overflow-hidden rounded-full bg-sunken">
                    <div
                      class="h-2 rounded-full"
                      [class.bg-brand]="pct(t.db_bytes, limits.dbBytes) < 70"
                      [class.bg-signal]="pct(t.db_bytes, limits.dbBytes) >= 70"
                      [style.width.%]="pct(t.db_bytes, limits.dbBytes)"
                    ></div>
                  </div>
                  <p class="mt-2 text-xs text-ink-muted">
                    {{ t.roles }} jobs · {{ t.events }} events
                  </p>
                </li>
                <li class="jb-card p-5 text-sm">
                  <div class="flex justify-between gap-2">
                    <span class="font-medium text-ink"
                      >Function calls, 30 days</span
                    >
                    <span class="tabular-nums"
                      >{{ t.runs_30d + t.ai_calls_30d }} /
                      {{ limits.edgeInvocations.toLocaleString() }}</span
                    >
                  </div>
                  <div class="mt-3 h-2 overflow-hidden rounded-full bg-sunken">
                    <div
                      class="h-2 rounded-full bg-brand"
                      [style.width.%]="
                        pct(t.runs_30d + t.ai_calls_30d, limits.edgeInvocations)
                      "
                    ></div>
                  </div>
                  <p class="mt-2 text-xs text-ink-muted">
                    {{ t.runs_30d }} searches · {{ t.ai_calls_30d }} AI calls
                    (counted from events; the Supabase dashboard has the exact
                    number)
                  </p>
                </li>
                <li class="jb-card p-5 text-sm">
                  <div class="flex justify-between gap-2">
                    <span class="font-medium text-ink">Users</span>
                    <span class="tabular-nums"
                      >{{ t.users }} / {{ limits.mau.toLocaleString() }}</span
                    >
                  </div>
                  <div class="mt-3 h-2 overflow-hidden rounded-full bg-sunken">
                    <div
                      class="h-2 rounded-full bg-brand"
                      [style.width.%]="pct(t.users, limits.mau)"
                    ></div>
                  </div>
                  <p class="mt-2 text-xs text-ink-muted">
                    {{ t.open_codes }} open invite
                    {{ t.open_codes === 1 ? 'code' : 'codes' }} ·
                    {{ t.open_requests }} waiting
                  </p>
                </li>
              </ul>
            </section>
          }

          <section
            class="jb-card flex flex-wrap items-center justify-between gap-4 p-5 text-sm"
          >
            <div>
              <div class="font-medium">
                Sign-up is {{ signupOpen() ? 'open to anyone' : 'invite-only' }}
              </div>
              <div class="text-ink-muted">
                Keep it invite-only until the free tiers are known to hold; the
                database check enforces it either way.
              </div>
            </div>
            <label class="inline-flex items-center gap-3 font-medium text-ink">
              <input
                type="checkbox"
                role="switch"
                class="jb-switch"
                [checked]="signupOpen()"
                [disabled]="busy()"
                (change)="toggleSignup()"
              />
              Open sign-up
            </label>
          </section>

          <jb-errors-panel />
        }
      }
    </section>
  `,
})
export class AdminOverview {
  private readonly repo = inject(AdminRepo);
  private readonly toast = inject(Toast);
  readonly limits = LIMITS;
  readonly users = signal<AdminUser[]>([]);
  readonly loaded = signal(false);
  readonly totals = signal<AdminTotals | null>(null);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly signupOpen = signal(false);
  private readonly route = inject(ActivatedRoute);
  /** /admin, /admin/activity or /admin/money. */
  protected readonly tab = toSignal(
    this.route.paramMap.pipe(map((p) => overviewTab(p.get('tab')))),
    { initialValue: overviewTab(this.route.snapshot.paramMap.get('tab')) },
  );
  protected readonly ids = computed(() => tabIds('admin', this.tab()));
  protected readonly leads: Record<OverviewTab, string> = {
    overview: 'How close the free tiers are, who may sign up, and what broke.',
    activity: 'What each account did in the last 30 days.',
    money: 'Plans, AI paid from credits, and what it costs.',
  };

  constructor() {
    void this.load();
  }

  async load() {
    try {
      const [o, open] = await Promise.all([
        this.repo.overview(),
        this.repo.signupOpen(),
      ]);
      this.users.set(o.users);
      this.totals.set(o.totals);
      this.signupOpen.set(open);
    } catch (e) {
      this.error.set((e as Error).message || 'Could not load');
    } finally {
      this.loaded.set(true);
    }
  }

  async toggleSignup() {
    this.busy.set(true);
    try {
      await this.repo.setSignupOpen(!this.signupOpen());
      this.signupOpen.update((v) => !v);
      this.toast.show(
        this.signupOpen() ? 'Sign-up is open' : 'Sign-up is invite-only',
      );
    } catch (e) {
      this.toast.show((e as Error).message || 'Could not change it');
    } finally {
      this.busy.set(false);
    }
  }

  mb(bytes: number): string {
    return (bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0);
  }
  pct(n: number, max: number): number {
    return Math.min(100, Math.round((100 * n) / max));
  }
}
