import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { InviteRequestRow } from '@jobbotix/shared-types';
import {
  AdminRepo,
  type AdminTotals,
  type AdminUser,
} from '../../core/data/repos';
import { RelativeDayPipe } from '../../shared/format';
import { Toast } from '../../shared/toast';

/** Supabase free tier, as published; the bars below are against these. */
const LIMITS = {
  dbBytes: 500 * 1024 * 1024,
  /** Edge Function invocations per month; runs + AI calls approximate ours. */
  edgeInvocations: 500_000,
  /** Monthly active users on the free tier. */
  mau: 50_000,
};

/** Admin: users, usage against the free tier, invite requests, codes. */
@Component({
  selector: 'jb-admin-overview',
  imports: [RouterLink, RelativeDayPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="flex flex-col gap-8">
      <header class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight">Admin</h1>
          <p class="mt-1 text-sm text-ink-muted">
            Who is on Jobbotix and how close the free tiers are.
          </p>
        </div>
        <a routerLink="/admin/invites" class="jb-btn">Invite codes</a>
      </header>

      @if (error()) {
        <p class="text-sm text-bad" role="alert">
          {{ error() }}
        </p>
      }

      @if (totals(); as t) {
        <section>
          <h2 class="jb-section-title">Free-tier headroom</h2>
          <ul class="mt-2 grid gap-3 sm:grid-cols-3">
            <li class="jb-card p-4 text-sm">
              <div class="flex justify-between">
                <span>Database</span>
                <span class="tabular-nums"
                  >{{ mb(t.db_bytes) }} / {{ mb(limits.dbBytes) }} MB</span
                >
              </div>
              <div class="mt-2 h-2 rounded bg-sunken">
                <div
                  class="h-2 rounded"
                  [class.bg-brand]="pct(t.db_bytes, limits.dbBytes) < 70"
                  [class.bg-signal]="pct(t.db_bytes, limits.dbBytes) >= 70"
                  [style.width.%]="pct(t.db_bytes, limits.dbBytes)"
                ></div>
              </div>
              <p class="mt-1 text-xs text-ink-muted">
                {{ t.roles }} roles · {{ t.events }} events
              </p>
            </li>
            <li class="jb-card p-4 text-sm">
              <div class="flex justify-between">
                <span>Function calls, 30 days</span>
                <span class="tabular-nums"
                  >{{ t.runs_30d + t.ai_calls_30d }} /
                  {{ limits.edgeInvocations.toLocaleString() }}</span
                >
              </div>
              <div class="mt-2 h-2 rounded bg-sunken">
                <div
                  class="h-2 rounded bg-brand"
                  [style.width.%]="
                    pct(t.runs_30d + t.ai_calls_30d, limits.edgeInvocations)
                  "
                ></div>
              </div>
              <p class="mt-1 text-xs text-ink-muted">
                {{ t.runs_30d }} ingest runs · {{ t.ai_calls_30d }} AI calls
                (counted from events; the Supabase dashboard has the exact
                number)
              </p>
            </li>
            <li class="jb-card p-4 text-sm">
              <div class="flex justify-between">
                <span>Users</span>
                <span class="tabular-nums"
                  >{{ t.users }} / {{ limits.mau.toLocaleString() }}</span
                >
              </div>
              <div class="mt-2 h-2 rounded bg-sunken">
                <div
                  class="h-2 rounded bg-brand"
                  [style.width.%]="pct(t.users, limits.mau)"
                ></div>
              </div>
              <p class="mt-1 text-xs text-ink-muted">
                {{ t.open_codes }} open invite
                {{ t.open_codes === 1 ? 'code' : 'codes' }} ·
                {{ t.open_requests }} waiting
              </p>
            </li>
          </ul>
        </section>
      }

      <section
        class="jb-card flex flex-wrap items-center justify-between gap-3 p-4 text-sm"
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
        <button
          type="button"
          class="jb-btn"
          (click)="toggleSignup()"
          [disabled]="busy()"
          [attr.aria-pressed]="signupOpen()"
        >
          {{ signupOpen() ? 'Close sign-up' : 'Open sign-up' }}
        </button>
      </section>

      <section>
        <h2 class="jb-section-title">Users</h2>
        @if (users().length === 0 && !error()) {
          <p class="mt-2 text-sm text-ink-muted">Loading…</p>
        } @else {
          <div class="mt-2 overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="text-left text-xs text-ink-muted">
                <tr>
                  <th class="py-2 pr-4">User</th>
                  <th class="py-2 pr-4">Joined</th>
                  <th class="py-2 pr-4">Roles</th>
                  <th class="py-2 pr-4">Applied</th>
                  <th class="py-2 pr-4">Last run</th>
                  <th class="py-2 pr-4">Runs / 30d</th>
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
                    <td class="py-2 pr-4">{{ u.created_at | relativeDay }}</td>
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
                        <span class="text-xs text-ink-muted">(own key)</span>
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

      <section>
        <h2 class="jb-section-title">Invite requests</h2>
        @if (requests().length === 0) {
          <p class="mt-2 text-sm text-ink-muted">
            No requests from the landing page yet.
          </p>
        } @else {
          <ul class="mt-2 divide-y divide-line text-sm">
            @for (r of requests(); track r.id) {
              <li
                class="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <span>
                  <span class="font-medium">{{ r.email }}</span>
                  <span class="text-ink-muted">
                    · {{ r.created_at | relativeDay }}</span
                  >
                  @if (r.note) {
                    <span class="block text-ink-muted">{{ r.note }}</span>
                  }
                </span>
                @if (r.invited_code) {
                  <span class="text-xs text-ink-muted"
                    >invited ·
                    <code class="font-mono">{{ r.invited_code }}</code></span
                  >
                } @else {
                  <button
                    type="button"
                    class="jb-btn-primary"
                    (click)="invite(r)"
                    [disabled]="busy()"
                  >
                    Create invite
                  </button>
                }
              </li>
            }
          </ul>
          @if (lastCode()) {
            <p
              class="mt-3 rounded-md bg-brand-tint px-3 py-2 text-sm text-brand-ink"
              role="status"
            >
              Send them
              <code class="font-mono"
                >{{ origin }}/signup/{{ lastCode() }}</code
              >
            </p>
          }
        }
      </section>
    </section>
  `,
})
export class AdminOverview {
  private readonly repo = inject(AdminRepo);
  private readonly toast = inject(Toast);
  readonly limits = LIMITS;
  readonly origin = location.origin;
  readonly users = signal<AdminUser[]>([]);
  readonly totals = signal<AdminTotals | null>(null);
  readonly requests = signal<InviteRequestRow[]>([]);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly lastCode = signal('');
  readonly signupOpen = signal(false);
  readonly pending = computed(
    () => this.requests().filter((r) => !r.invited_code).length,
  );

  constructor() {
    void this.load();
  }

  async load() {
    try {
      const [o, reqs, open] = await Promise.all([
        this.repo.overview(),
        this.repo.requests(),
        this.repo.signupOpen(),
      ]);
      this.users.set(o.users);
      this.totals.set(o.totals);
      this.requests.set(reqs);
      this.signupOpen.set(open);
    } catch (e) {
      this.error.set((e as Error).message || 'Could not load');
    }
  }

  async invite(r: InviteRequestRow) {
    this.busy.set(true);
    try {
      this.lastCode.set(await this.repo.inviteRequest(r.id));
      this.toast.show('Invite created');
      await this.load();
    } catch (e) {
      this.toast.show((e as Error).message || 'Could not create the invite');
    } finally {
      this.busy.set(false);
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
