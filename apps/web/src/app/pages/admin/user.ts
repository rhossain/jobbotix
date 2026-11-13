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
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  JOB_LABELS,
  auditLabel,
  formatTokens,
  formatUsd,
  planLine,
  providerName,
  type AdminUserDetail,
  type RoleRecheck,
  type SearchExplain,
  type AiJob,
} from '@jobbotix/shared-types';
import { AdminRepo } from '../../core/data/repos';
import { RelativeDayPipe } from '../../shared/format';
import { Toast } from '../../shared/toast';
import {
  BackLink,
  Button,
  Confirm,
  PageHeader,
  Skeleton,
  Tabs,
  tabIds,
  type TabItem,
} from '../../ui';

type TabId = 'account' | 'billing' | 'ai' | 'search' | 'activity' | 'content';

/** "$15.00", "-$5.00" for an amount in cents. */
export function cents(amount: number, currency = 'usd'): string {
  const v = `$${(Math.abs(amount) / 100).toFixed(2)}`;
  return `${amount < 0 ? '-' : ''}${v}${currency.toLowerCase() === 'usd' ? '' : ` ${currency.toUpperCase()}`}`;
}

/**
 * Admin: one account. Four tabs (Account, Billing, AI usage, Activity) and
 * the actions an admin can take. The account's roles and resume show in a
 * fifth tab only while its owner has support access open; notes and letters
 * never show. Opening this page and every action is recorded.
 */
@Component({
  selector: 'jb-admin-user',
  imports: [
    BackLink,
    Button,
    FormsModule,
    PageHeader,
    RelativeDayPipe,
    Skeleton,
    Tabs,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <jb-back-link link="/admin/users" label="Users" />
    @if (error()) {
      <p class="mt-6 text-sm text-bad" role="alert">{{ error() }}</p>
    } @else if (!detail()) {
      <jb-skeleton class="mt-6" shape="row" [count]="5" />
    } @else {
      @let d = detail()!;
      <jb-page-header [title]="d.account.email" [lead]="lead()" />
      <div class="mt-2 flex flex-wrap gap-1.5">
        <span class="jb-tag" [class.jb-tag-ai]="paid()">{{ planText() }}</span>
        @if (d.account.is_admin) {
          <span class="jb-tag">Admin</span>
        }
        @if (d.account.suspended_at) {
          <span class="jb-tag jb-tag-bad">Suspended</span>
        }
        @if (d.account.support_access_until) {
          <span class="jb-tag jb-tag-warn"
            >Support access until
            {{ untilDay(d.account.support_access_until) }}</span
          >
        }
      </div>

      <div class="mt-6">
        <jb-tabs
          prefix="admin-user"
          label="Account sections"
          [tabs]="tabs()"
          [value]="tab()"
          (valueChange)="tab.set($any($event))"
        />
      </div>

      <section
        class="jb-card mt-4 p-5 md:p-6"
        role="tabpanel"
        [id]="ids().panel"
        [attr.aria-labelledby]="ids().tab"
      >
        @switch (tab()) {
          @case ('account') {
            <dl class="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
              @for (f of accountFacts(); track f.label) {
                <div>
                  <dt class="text-xs text-ink-muted">{{ f.label }}</dt>
                  <dd class="text-ink">{{ f.value }}</dd>
                </div>
              }
            </dl>
            @if (d.account.suspended_at) {
              <p class="mt-4 text-sm text-bad">
                Suspended {{ d.account.suspended_at | relativeDay }}:
                {{ d.account.suspended_reason }}
              </p>
            }
          }
          @case ('billing') {
            <p class="text-sm">
              <span class="font-medium text-ink">{{ planText() }}</span>
              · {{ d.billing.entitlements.credits }} credits left
            </p>
            @if (d.billing.subscription; as s) {
              <p class="mt-1 text-sm text-ink-muted">
                {{
                  s.source === 'polar'
                    ? 'Billed through Polar'
                    : 'Granted by an admin'
                }}{{ s.note ? ': ' + s.note : '' }}.
                @if (s.cancel_at_period_end) {
                  Cancels at the end of the period.
                }
                @if (s.provider_customer_id) {
                  Polar customer {{ s.provider_customer_id }}.
                }
              </p>
            }
            <h3 class="mt-5 text-sm font-semibold text-ink">Payments</h3>
            @if (!d.billing.payments.length) {
              <p class="mt-1 text-sm text-ink-muted">No payments.</p>
            } @else {
              <ul class="mt-1 divide-y divide-line text-sm">
                @for (p of d.billing.payments; track $index) {
                  <li class="flex flex-wrap justify-between gap-2 py-2">
                    <span
                      >{{ p.product || p.kind }}
                      <span class="text-xs text-ink-muted"
                        >· {{ p.status }}</span
                      ></span
                    >
                    <span class="tabular-nums"
                      >{{ money(p.amount_cents, p.currency) }} ·
                      {{ p.paid_at | relativeDay }}</span
                    >
                  </li>
                }
              </ul>
            }
            <h3 class="mt-5 text-sm font-semibold text-ink">Credits</h3>
            @if (!d.billing.ledger.length) {
              <p class="mt-1 text-sm text-ink-muted">No credits yet.</p>
            } @else {
              <ul class="mt-1 divide-y divide-line text-sm">
                @for (l of d.billing.ledger; track $index) {
                  <li class="flex flex-wrap justify-between gap-2 py-2">
                    <span
                      >{{ l.kind }}
                      @if (l.reason) {
                        <span class="text-xs text-ink-muted"
                          >· {{ l.reason }}</span
                        >
                      }
                    </span>
                    <span class="tabular-nums"
                      >{{ l.delta > 0 ? '+' : '' }}{{ l.delta }} ·
                      {{ l.created_at | relativeDay }}</span
                    >
                  </li>
                }
              </ul>
            }
          }
          @case ('ai') {
            <p class="text-sm text-ink-muted">
              This month: {{ aiTotals().calls }} calls,
              {{ d.ai.credits_spent_month }} credits spent, about
              {{ usd(d.ai.platform_cost_month) }} on Jobbotix's key.
            </p>
            <h3 class="mt-5 text-sm font-semibold text-ink">Connections</h3>
            @if (!d.ai.connections.length) {
              <p class="mt-1 text-sm text-ink-muted">No key of its own.</p>
            } @else {
              <ul class="mt-1 divide-y divide-line text-sm">
                @for (c of d.ai.connections; track c.provider) {
                  <li class="flex flex-wrap justify-between gap-2 py-2">
                    <span>{{ provider(c.provider) }}</span>
                    <span
                      [class.text-bad]="c.status === 'error'"
                      [class.text-ink-muted]="c.status !== 'error'"
                      >{{
                        c.status === 'error'
                          ? c.last_error || 'Needs attention'
                          : c.limited_until
                            ? 'Rate limited'
                            : c.status === 'ok'
                              ? 'Working'
                              : 'Not tested'
                      }}</span
                    >
                  </li>
                }
              </ul>
            }
            <h3 class="mt-5 text-sm font-semibold text-ink">
              Calls this month
            </h3>
            @if (!d.ai.month.length) {
              <p class="mt-1 text-sm text-ink-muted">No AI calls this month.</p>
            } @else {
              <div class="mt-1 overflow-x-auto">
                <table class="w-full text-sm whitespace-nowrap">
                  <thead class="text-left text-xs text-ink-muted">
                    <tr>
                      <th class="py-2 pr-4 font-medium">Work</th>
                      <th class="py-2 pr-4 font-medium">Model</th>
                      <th class="py-2 pr-4 font-medium">Paid by</th>
                      <th class="py-2 pr-4 text-right font-medium">Calls</th>
                      <th class="py-2 pr-4 text-right font-medium">Tokens</th>
                      <th class="py-2 text-right font-medium">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (m of d.ai.month; track $index) {
                      <tr class="border-t border-line">
                        <td class="py-2 pr-4">{{ job(m.job) }}</td>
                        <td class="py-2 pr-4">
                          {{ provider(m.provider) }} · {{ m.model }}
                        </td>
                        <td class="py-2 pr-4">
                          {{ m.route === 'platform' ? 'Credits' : 'Own key' }}
                        </td>
                        <td class="py-2 pr-4 text-right tabular-nums">
                          {{ m.calls }}
                        </td>
                        <td class="py-2 pr-4 text-right tabular-nums">
                          {{ tokens(m.tokens_in + m.tokens_out) }}
                        </td>
                        <td class="py-2 text-right tabular-nums">
                          {{ m.route === 'platform' ? usd(m.cost_usd) : '–' }}
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              <p class="mt-2 text-xs text-ink-muted">
                Cost is what Jobbotix paid; calls on the account's own key cost
                Jobbotix nothing.
              </p>
            }
          }
          @case ('search') {
            <p class="text-sm text-ink-muted">
              Replays this account's search rules over recent postings and
              counts where each one stopped. It reads their search profile only,
              writes nothing, and is recorded under Activity.
            </p>
            <div class="mt-3">
              <button
                type="button"
                jbButton
                size="sm"
                [busy]="busy() === 'explain'"
                [disabled]="!!busy()"
                (click)="explain()"
              >
                {{ search() ? 'Check again' : 'Check the last 14 days' }}
              </button>
            </div>
            @if (search(); as x) {
              <p class="mt-4 text-sm text-ink">
                Looking for
                <strong>{{
                  x.targetRoles.join(', ') || 'no target role'
                }}</strong
                >. Searched on the boards as:
                {{ x.searchTerms.join(', ') || 'nothing' }}.
              </p>
              @for (w of x.warnings; track w) {
                <p class="mt-1 text-sm text-warn" role="note">{{ w }}</p>
              }
              <dl
                class="mt-4 grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-3"
              >
                @for (f of searchFacts(); track f.label) {
                  <div>
                    <dt class="text-xs text-ink-muted">{{ f.label }}</dt>
                    <dd class="text-ink">{{ f.value }}</dd>
                  </div>
                }
              </dl>
              @if (x.excluded.length) {
                <h3 class="mt-5 text-sm font-semibold text-ink">
                  Their kind of job, ruled out by
                </h3>
                <ul class="mt-1 divide-y divide-line text-sm">
                  @for (e of x.excluded; track e.reason) {
                    <li class="flex justify-between gap-2 py-2">
                      <span>{{ e.reason }}</span>
                      <span class="tabular-nums text-ink-muted">{{
                        e.count
                      }}</span>
                    </li>
                  }
                </ul>
              }
              @if (x.limitedTo.length) {
                <h3 class="mt-5 text-sm font-semibold text-ink">
                  Country-limited postings are open to
                </h3>
                <ul class="mt-1 divide-y divide-line text-sm">
                  @for (l of x.limitedTo; track l.place) {
                    <li class="flex justify-between gap-2 py-2">
                      <span>{{ l.place }}</span>
                      <span class="tabular-nums text-ink-muted">{{
                        l.count
                      }}</span>
                    </li>
                  }
                </ul>
              }
              @if (x.ruledOut.length) {
                <h3 class="mt-5 text-sm font-semibold text-ink">
                  Title matches that were ruled out
                </h3>
                <ul class="mt-1 divide-y divide-line text-sm">
                  @for (r of x.ruledOut; track $index) {
                    <li class="py-2">
                      <span class="text-ink"
                        >{{ r.title }} · {{ r.company }}</span
                      >
                      <span class="block text-xs text-ink-muted"
                        >{{ r.reason }}. Posting says:
                        {{
                          r.where ||
                            'no
                        location'
                        }}
                        ({{ r.source }})</span
                      >
                    </li>
                  }
                </ul>
              }
              <h3 class="mt-5 text-sm font-semibold text-ink">By source</h3>
              <ul class="mt-1 divide-y divide-line text-sm">
                @for (s of x.bySource; track s.source) {
                  <li class="flex justify-between gap-2 py-2">
                    <span>{{ s.source }}</span>
                    <span class="tabular-nums text-ink-muted"
                      >{{ s.matched }} matched of {{ s.pool }}</span
                    >
                  </li>
                }
              </ul>
              @if (x.top.length) {
                <h3 class="mt-5 text-sm font-semibold text-ink">
                  Strongest matches
                </h3>
                <ul class="mt-1 divide-y divide-line text-sm">
                  @for (t of x.top; track $index) {
                    <li class="flex justify-between gap-2 py-2">
                      <span>{{ t.title }} · {{ t.company }}</span>
                      <span class="tabular-nums text-ink-muted">{{
                        t.score
                      }}</span>
                    </li>
                  }
                </ul>
              }
              @if (x.low.length) {
                <h3 class="mt-5 text-sm font-semibold text-ink">
                  Matched but under {{ x.threshold }}
                </h3>
                <ul class="mt-1 divide-y divide-line text-sm">
                  @for (t of x.low; track $index) {
                    <li class="flex justify-between gap-2 py-2">
                      <span>{{ t.title }} · {{ t.company }}</span>
                      <span class="tabular-nums text-ink-muted">{{
                        t.score
                      }}</span>
                    </li>
                  }
                </ul>
              }
            }
            <h3 class="mt-6 text-sm font-semibold text-ink">
              Filed roles that no longer match
            </h3>
            <p class="mt-1 text-sm text-ink-muted">
              Roles Jobbotix filed for this account that today's rules would
              call another kind of job. Only roles they have not touched: still
              New, no notes, nothing drafted. Moving them to Skipped deletes
              nothing; they can move any of them back.
            </p>
            <div class="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                jbButton="ghost"
                size="sm"
                [busy]="busy() === 'recheck'"
                [disabled]="!!busy()"
                (click)="recheck(false)"
              >
                Find them
              </button>
              @if (stale(); as st) {
                @if (st.count && !st.applied) {
                  <button
                    type="button"
                    jbButton
                    size="sm"
                    [busy]="busy() === 'recheck'"
                    [disabled]="!!busy()"
                    (click)="recheck(true)"
                  >
                    Move {{ st.count }} to Skipped
                  </button>
                }
              }
            </div>
            @if (stale(); as st) {
              <p class="mt-3 text-sm text-ink" role="status">
                @if (st.applied) {
                  Moved {{ st.count }} of {{ st.checked }} untouched roles to
                  Skipped.
                } @else {
                  {{ st.count }} of {{ st.checked }} untouched roles no longer
                  match.
                }
              </p>
              <ul class="mt-1 divide-y divide-line text-sm">
                @for (r of st.roles; track $index) {
                  <li class="py-2">{{ r.title }} · {{ r.company }}</li>
                }
              </ul>
            }
          }
          @case ('activity') {
            <dl class="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
              @for (f of activityFacts(); track f.label) {
                <div>
                  <dt class="text-xs text-ink-muted">{{ f.label }}</dt>
                  <dd class="text-ink">{{ f.value }}</dd>
                </div>
              }
            </dl>
            <h3 class="mt-5 text-sm font-semibold text-ink">
              Admin actions on this account
            </h3>
            @if (!d.activity.audit.length) {
              <p class="mt-1 text-sm text-ink-muted">None yet.</p>
            } @else {
              <ul class="mt-1 divide-y divide-line text-sm">
                @for (a of d.activity.audit; track $index) {
                  <li class="flex flex-wrap justify-between gap-2 py-2">
                    <span>{{ audit(a.action, a.detail) }}</span>
                    <span class="text-xs text-ink-muted"
                      >{{ a.admin_email }} ·
                      {{ a.created_at | relativeDay }}</span
                    >
                  </li>
                }
              </ul>
            }
          }
          @case ('content') {
            <p class="text-sm text-ink-muted">
              The owner opened this for support. Notes, letters and posting text
              stay closed. Reading this tab is recorded.
            </p>
            @if (!d.content?.roles?.length) {
              <p class="mt-3 text-sm text-ink-muted">No roles.</p>
            } @else {
              <ul class="mt-3 divide-y divide-line text-sm">
                @for (r of d.content!.roles; track $index) {
                  <li class="flex flex-wrap justify-between gap-2 py-2">
                    <span
                      >{{ r.title }}
                      <span class="text-ink-muted"
                        >· {{ r.company }}</span
                      ></span
                    >
                    <span class="text-xs text-ink-muted"
                      >{{ r.status.replace('_', ' ') }} · score
                      {{ r.score }}</span
                    >
                  </li>
                }
              </ul>
            }
            @if (d.content?.resume) {
              <h3 class="mt-5 text-sm font-semibold text-ink">Master resume</h3>
              <pre
                class="mt-1 max-h-96 overflow-auto rounded-control bg-sunken p-3 text-xs whitespace-pre-wrap"
                >{{ resumeText() }}</pre>
            }
          }
        }
      </section>

      <!-- Actions -->
      <section class="jb-card mt-6 flex flex-col gap-5 p-5 md:p-6">
        <h2 class="jb-section-title">Actions</h2>
        @if (actionError()) {
          <p class="text-sm text-bad" role="alert">{{ actionError() }}</p>
        }

        <form
          class="flex flex-wrap items-end gap-2"
          (ngSubmit)="setPlan()"
          novalidate
        >
          <label class="flex flex-col gap-1 text-sm">
            <span>Plan</span>
            <select
              class="jb-input"
              name="plan"
              [ngModel]="planChoice()"
              (ngModelChange)="planChoice.set($event)"
            >
              <option value="pro">Pro</option>
              <option value="free">Free</option>
            </select>
          </label>
          <label class="flex min-w-0 flex-1 basis-56 flex-col gap-1 text-sm">
            <span>Reason</span>
            <input
              class="jb-input"
              name="planReason"
              autocomplete="off"
              [ngModel]="planReason()"
              (ngModelChange)="planReason.set($event)"
            />
          </label>
          <button
            type="submit"
            jbButton
            [busy]="busy() === 'plan'"
            [disabled]="!!busy() || !planReason().trim() || billedByPolar()"
          >
            Set plan
          </button>
        </form>
        @if (billedByPolar()) {
          <p class="-mt-3 text-xs text-ink-muted">
            This subscription is billed through Polar; change it there.
          </p>
        }

        <form
          class="flex flex-wrap items-end gap-2"
          (ngSubmit)="addCredits()"
          novalidate
        >
          <label class="flex flex-col gap-1 text-sm">
            <span>Credits (negative removes)</span>
            <input
              class="jb-input w-40"
              type="number"
              name="credits"
              step="1"
              [ngModel]="creditAmount()"
              (ngModelChange)="creditAmount.set($event)"
            />
          </label>
          <label class="flex min-w-0 flex-1 basis-56 flex-col gap-1 text-sm">
            <span>Reason</span>
            <input
              class="jb-input"
              name="creditReason"
              autocomplete="off"
              [ngModel]="creditReason()"
              (ngModelChange)="creditReason.set($event)"
            />
          </label>
          <button
            type="submit"
            jbButton
            [busy]="busy() === 'credits'"
            [disabled]="!!busy() || !creditsValid()"
          >
            Add credits
          </button>
        </form>

        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            jbButton
            [busy]="busy() === 'link'"
            [disabled]="!!busy()"
            (click)="sendLink()"
          >
            Send a sign-in link
          </button>
          <span class="text-xs text-ink-muted"
            >Emails {{ d.account.email }} the same link the sign-in page
            sends.</span
          >
        </div>

        @if (!d.account.is_admin) {
          <div class="flex flex-col gap-3 border-t border-line pt-5">
            @if (d.account.suspended_at) {
              <div>
                <button
                  type="button"
                  jbButton
                  [busy]="busy() === 'suspend'"
                  [disabled]="!!busy()"
                  (click)="unsuspend()"
                >
                  Lift the suspension
                </button>
              </div>
            } @else {
              <form
                class="flex flex-wrap items-end gap-2"
                (ngSubmit)="suspend()"
                novalidate
              >
                <label
                  class="flex min-w-0 flex-1 basis-56 flex-col gap-1 text-sm"
                >
                  <span>Reason for suspending</span>
                  <input
                    class="jb-input"
                    name="suspendReason"
                    autocomplete="off"
                    [ngModel]="suspendReason()"
                    (ngModelChange)="suspendReason.set($event)"
                  />
                </label>
                <button
                  type="submit"
                  jbButton="danger"
                  [busy]="busy() === 'suspend'"
                  [disabled]="!!busy() || suspendReason().trim().length < 3"
                >
                  Suspend
                </button>
              </form>
              <p class="-mt-1 text-xs text-ink-muted">
                Blocks sign-in, AI calls, scheduled matching and the digest.
                Nothing is deleted.
              </p>
            }

            <form
              class="flex flex-wrap items-end gap-2"
              (ngSubmit)="remove()"
              novalidate
            >
              <label
                class="flex min-w-0 flex-1 basis-56 flex-col gap-1 text-sm"
              >
                <span>Type the email to delete this account</span>
                <input
                  class="jb-input"
                  name="confirmEmail"
                  autocomplete="off"
                  [ngModel]="confirmEmail()"
                  (ngModelChange)="confirmEmail.set($event)"
                />
              </label>
              <button
                type="submit"
                jbButton="danger"
                [busy]="busy() === 'delete'"
                [disabled]="!!busy() || !emailMatches()"
              >
                Delete account
              </button>
            </form>
          </div>
        } @else {
          <p class="border-t border-line pt-5 text-xs text-ink-muted">
            An admin account is not suspended or deleted from the console.
          </p>
        }
      </section>
    }
  `,
})
export class AdminUser {
  /** The account id, from the route. */
  readonly id = input.required<string>();

  private readonly repo = inject(AdminRepo);
  private readonly toast = inject(Toast);
  private readonly confirm = inject(Confirm);
  private readonly router = inject(Router);

  readonly detail = signal<AdminUserDetail | null>(null);
  readonly error = signal('');
  readonly actionError = signal('');
  readonly busy = signal<
    | ''
    | 'plan'
    | 'credits'
    | 'link'
    | 'suspend'
    | 'delete'
    | 'explain'
    | 'recheck'
  >('');
  readonly tab = signal<TabId>('account');
  readonly search = signal<SearchExplain | null>(null);
  readonly stale = signal<RoleRecheck | null>(null);
  readonly searchFacts = computed(() => {
    const x = this.search();
    if (!x) return [];
    const ruledOut = x.excluded.reduce((n, e) => n + e.count, 0);
    const g = x.byGrade;
    return [
      { label: `Postings, last ${x.days} days`, value: String(x.pool) },
      { label: 'Another kind of job', value: String(x.notRelevant) },
      {
        label: 'Of those, near misses for the AI check',
        value: String(x.nearMiss),
      },
      {
        label: 'AI check in their real runs',
        value: x.aiCheck.looked
          ? `read ${x.aiCheck.looked}, turned down ${x.aiCheck.turnedDown}, brought in ${x.aiCheck.broughtIn}`
          : 'has not read a title yet',
      },
      ...(x.aiCheck.failedRuns
        ? [
            {
              label: 'Runs where the AI step failed',
              value: x.aiCheck.error
                ? `${x.aiCheck.failedRuns}: ${x.aiCheck.error}`
                : String(x.aiCheck.failedRuns),
            },
          ]
        : []),
      { label: 'Too old or expired', value: String(x.tooOld) },
      { label: 'Ruled out by their settings', value: String(ruledOut) },
      { label: 'No country set to compare', value: String(x.needsCountry) },
      { label: `Scored under ${x.threshold}`, value: String(x.lowScore) },
      { label: 'Good enough to file', value: String(x.wouldFile) },
      {
        label: 'Matched by title',
        value: `${g.exact} exact, ${g.variant} other name, ${g.partial + g.described} close`,
      },
      { label: 'Matched by stack only', value: String(g.stack) },
    ];
  });

  readonly planChoice = signal<'free' | 'pro'>('pro');
  readonly planReason = signal('');
  readonly creditAmount = signal<number | null>(null);
  readonly creditReason = signal('');
  readonly suspendReason = signal('');
  readonly confirmEmail = signal('');

  readonly tabs = computed<TabItem<TabId>[]>(() => [
    { id: 'account', label: 'Account' },
    { id: 'billing', label: 'Billing' },
    { id: 'ai', label: 'AI usage' },
    { id: 'search', label: 'Search results' },
    { id: 'activity', label: 'Activity' },
    ...(this.detail()?.content
      ? [{ id: 'content' as const, label: 'Roles and resume' }]
      : []),
  ]);
  readonly ids = computed(() => tabIds('admin-user', this.tab()));

  readonly paid = computed(
    () => this.detail()?.billing.entitlements.plan !== 'free',
  );
  readonly planText = computed(() => {
    const d = this.detail();
    return d ? planLine(d.billing.entitlements) : '';
  });
  readonly billedByPolar = computed(
    () => this.detail()?.billing.subscription?.source === 'polar',
  );
  readonly lead = computed(() => {
    const a = this.detail()?.account;
    return a ? `${a.name || 'No name'} · ${a.timezone}` : '';
  });
  readonly creditsValid = computed(() => {
    const n = Number(this.creditAmount());
    return (
      Number.isInteger(n) &&
      n !== 0 &&
      Math.abs(n) <= 10000 &&
      !!this.creditReason().trim()
    );
  });
  readonly emailMatches = computed(
    () =>
      this.confirmEmail().trim().toLowerCase() ===
      (this.detail()?.account.email.toLowerCase() ?? null),
  );

  readonly accountFacts = computed(() => {
    const a = this.detail()?.account;
    if (!a) return [];
    const day = (iso: string | null) =>
      iso
        ? new Date(iso).toLocaleDateString('en-GB', { dateStyle: 'medium' })
        : 'never';
    return [
      { label: 'Signed up', value: day(a.created_at) },
      { label: 'Last sign-in', value: day(a.last_sign_in_at) },
      { label: 'Email confirmed', value: a.email_confirmed ? 'Yes' : 'No' },
      { label: 'Invite code', value: a.invite_code || 'None' },
      { label: 'Master resume', value: a.has_resume ? 'Saved' : 'None' },
      {
        label: 'Search profile',
        value: a.has_search_profile ? 'Set up' : 'None',
      },
      { label: 'Ingest keys in use', value: String(a.ingest_keys) },
      {
        label: 'AI paid by',
        value: a.ai_route === 'own' ? 'Own key only' : 'Credits, then own key',
      },
    ];
  });

  readonly activityFacts = computed(() => {
    const a = this.detail()?.activity;
    if (!a) return [];
    const roles = Object.entries(a.roles_by_status)
      .map(([status, n]) => `${n} ${status.replace('_', ' ')}`)
      .join(', ');
    return [
      { label: 'Roles tracked', value: roles || 'None' },
      {
        label: 'Last scheduled run',
        value: a.last_run
          ? new Date(a.last_run).toLocaleString('en-GB', {
              dateStyle: 'medium',
              timeStyle: 'short',
            })
          : 'never',
      },
      { label: 'Runs in 30 days', value: String(a.runs_30d) },
      {
        label: 'Status changes in 30 days',
        value: String(a.events_30d['status_change'] ?? 0),
      },
      {
        label: 'Drafts generated in 30 days',
        value: String(a.events_30d['generated'] ?? 0),
      },
    ];
  });

  readonly aiTotals = computed(() => ({
    calls: (this.detail()?.ai.month ?? []).reduce((n, m) => n + m.calls, 0),
  }));
  readonly resumeText = computed(() =>
    JSON.stringify(this.detail()?.content?.resume ?? null, null, 2),
  );

  constructor() {
    effect(() => {
      this.id();
      untracked(() => {
        this.detail.set(null);
        this.search.set(null);
        this.stale.set(null);
        void this.load();
      });
    });
  }

  private async load() {
    try {
      const d = await this.repo.user(this.id());
      if (!d) {
        this.error.set('No such account.');
        return;
      }
      this.detail.set(d);
      this.planChoice.set(
        d.billing.entitlements.plan === 'free' ? 'pro' : 'free',
      );
      if (this.tab() === 'content' && !d.content) this.tab.set('account');
    } catch (e) {
      this.error.set((e as Error).message || 'Could not load the account');
    }
  }

  /** "16 Nov": the day a future time falls on. */
  untilDay(iso: string) {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
    });
  }
  usd(v: number) {
    return formatUsd(v);
  }
  tokens(n: number) {
    return formatTokens(n);
  }
  money(amount: number, currency: string) {
    return cents(amount, currency);
  }
  provider(id: string) {
    return providerName(id);
  }
  job(job: string) {
    return JOB_LABELS[job as AiJob] ?? job;
  }
  audit(action: string, detail: Record<string, unknown>) {
    return auditLabel(action, detail);
  }

  async setPlan() {
    const reason = this.planReason().trim();
    if (!reason) return;
    await this.run('plan', async () => {
      await this.repo.setPlan(this.id(), this.planChoice(), reason);
      this.planReason.set('');
      this.toast.show(
        `Plan set to ${this.planChoice() === 'pro' ? 'Pro' : 'Free'}`,
      );
    });
  }

  async addCredits() {
    if (!this.creditsValid()) return;
    const amount = Number(this.creditAmount());
    await this.run('credits', async () => {
      const balance = await this.repo.addCredits(
        this.id(),
        amount,
        this.creditReason().trim(),
      );
      this.creditAmount.set(null);
      this.creditReason.set('');
      this.toast.show(`Balance is now ${balance} credits`);
    });
  }

  async recheck(apply: boolean) {
    await this.run('recheck', async () => {
      this.stale.set(await this.repo.recheckRoles(this.id(), apply));
    });
  }

  async explain() {
    await this.run('explain', async () => {
      this.search.set(await this.repo.explainSearch(this.id()));
    });
  }

  async sendLink() {
    const email = this.detail()?.account.email;
    const ok = await this.confirm.ask({
      title: 'Send a sign-in link?',
      body: `${email} gets an email with a link that signs them in.`,
      action: 'Send link',
    });
    if (!ok) return;
    await this.run('link', async () => {
      await this.repo.sendLoginLink(this.id());
      this.toast.show(`Sign-in link sent to ${email}`);
    });
  }

  async suspend() {
    const reason = this.suspendReason().trim();
    const ok = await this.confirm.ask({
      title: 'Suspend this account?',
      body: 'They are signed out within the hour and cannot sign in again. AI calls, scheduled matching and the digest stop. Nothing is deleted, and you can lift it at any time.',
      action: 'Suspend',
      danger: true,
    });
    if (!ok) return;
    await this.run('suspend', async () => {
      await this.repo.suspend(this.id(), reason);
      this.suspendReason.set('');
      this.toast.show('Account suspended');
    });
  }

  async unsuspend() {
    await this.run('suspend', async () => {
      await this.repo.unsuspend(this.id());
      this.toast.show('Suspension lifted');
    });
  }

  async remove() {
    if (!this.emailMatches()) return;
    const email = this.detail()?.account.email ?? '';
    const ok = await this.confirm.ask({
      title: `Delete ${email}?`,
      body: 'The account and everything in it is removed straight away: roles, resumes, letters, keys. It cannot be undone.',
      action: 'Delete account',
      danger: true,
    });
    if (!ok) return;
    this.busy.set('delete');
    this.actionError.set('');
    try {
      await this.repo.deleteUser(this.id(), this.confirmEmail());
      this.toast.show(`${email} deleted`);
      await this.router.navigate(['/admin/users']);
    } catch (e) {
      this.actionError.set(
        (e as Error).message || 'Could not delete the account',
      );
    } finally {
      this.busy.set('');
    }
  }

  /** One action at a time; the account is read again when it worked. */
  private async run(
    what: 'plan' | 'credits' | 'link' | 'suspend' | 'explain' | 'recheck',
    action: () => Promise<void>,
  ) {
    if (this.busy()) return;
    this.busy.set(what);
    this.actionError.set('');
    try {
      await action();
      await this.load();
    } catch (e) {
      this.actionError.set(
        (e as Error).message || 'That did not work; try again.',
      );
    } finally {
      this.busy.set('');
    }
  }
}
