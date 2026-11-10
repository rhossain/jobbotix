import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { planLine } from '@jobbotix/shared-types';
import {
  AdminRepo,
  type AdminPlan,
  type AdminUser,
} from '../../core/data/repos';
import { Plan } from '../../core/plan';
import { Toast } from '../../shared/toast';
import { Button, Field, FieldControl, Sheet, Skeleton } from '../../ui';

export interface PlanForm {
  plan: 'free' | 'pro';
  /** yyyy-mm-dd, or '' for no end date. */
  until: string;
  credits: number;
  reason: string;
}

export interface PlanChange {
  /** Set when the plan or its end date differs from what the account has. */
  setPlan: { plan: 'free' | 'pro'; until: string | null } | null;
  /** Credits to add (negative takes them back); 0 for none. */
  credits: number;
  /** Why Save cannot go ahead, or ''. */
  problem: string;
}

/** The end of the chosen day in UTC, so "until 10 Dec" includes the 10th. */
const endOfDay = (date: string) => `${date}T23:59:59Z`;

/**
 * What saving the form would do to an account. Pure, so the rules (a reason
 * every time, no balance below zero, nothing sent when nothing changed) are
 * tested without a browser.
 */
export function planChange(current: AdminPlan, form: PlanForm): PlanChange {
  const until = form.plan === 'pro' && form.until ? endOfDay(form.until) : null;
  const currentUntil = current.periodEnd ? current.periodEnd.slice(0, 10) : '';
  const planChanged =
    form.plan !== current.plan ||
    (form.plan === 'pro' && form.until !== currentUntil);
  const credits = Number.isFinite(form.credits) ? Math.trunc(form.credits) : 0;

  let problem = '';
  if (!planChanged && credits === 0) problem = 'Nothing to change';
  else if (!form.reason.trim()) problem = 'Give a reason';
  else if (planChanged && current.source === 'polar')
    problem = 'This subscription is billed through Polar; change it there';
  else if (Math.abs(credits) > 10_000)
    problem = 'At most 10,000 credits at a time';
  else if (current.credits + credits < 0)
    problem = `They only have ${current.credits} credits`;
  else if (until && Date.parse(until) < Date.now())
    problem = 'The end date is in the past';

  return {
    setPlan: planChanged ? { plan: form.plan, until } : null,
    credits,
    problem,
  };
}

interface Row {
  user: AdminUser;
  plan: AdminPlan;
  line: string;
}

/**
 * Admin: every account's plan and credits, with the three things an admin
 * does by hand before billing exists: grant or remove Pro, add credits, and
 * switch the billing gates on for one account to test them.
 */
@Component({
  selector: 'jb-plans-panel',
  imports: [Button, Field, FieldControl, ReactiveFormsModule, Sheet, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section class="jb-card p-5 md:p-6">
      <h2 class="jb-section-title">Plans and credits</h2>
      <p class="mt-1 text-sm text-ink-muted">
        @if (enabled()) {
          Billing is on: each account gets what its plan includes.
        } @else {
          Billing is off: every account has every feature, whatever its plan.
          Switch on Test billing for one account to see the app as a paying or
          free user would.
        }
      </p>

      @if (error()) {
        <p class="mt-3 text-sm text-bad" role="alert">{{ error() }}</p>
      } @else if (!loaded()) {
        <jb-skeleton class="mt-3" shape="row" [count]="2" />
      } @else if (rows().length === 0) {
        <p class="mt-3 text-sm text-ink-muted">No accounts yet.</p>
      } @else {
        <div
          class="-mx-5 mt-3 overflow-x-auto px-5 md:-mx-6 md:px-6"
          tabindex="0"
          role="region"
          aria-label="Plans table"
        >
          <table class="w-full text-sm">
            <thead class="text-left text-xs whitespace-nowrap text-ink-muted">
              <tr>
                <th class="py-2 pr-4">User</th>
                <th class="py-2 pr-4">Plan</th>
                <th class="py-2 pr-4">Credits</th>
                <th class="py-2 pr-4">Plan reason</th>
                <!-- no sr-only text here: an absolutely placed span in a
                     scrolling table widens the page on a phone -->
                <th class="py-2" aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody>
              @for (r of rows(); track r.user.id) {
                <tr class="border-t border-line">
                  <td class="py-2 pr-4">
                    <div class="font-medium">
                      {{ r.user.name || r.user.email }}
                    </div>
                    <div class="text-xs text-ink-muted">{{ r.user.email }}</div>
                  </td>
                  <td class="py-2 pr-4 whitespace-nowrap">
                    <span
                      class="jb-tag"
                      [class.jb-tag-ai]="r.plan.plan !== 'free'"
                      >{{ r.line }}</span
                    >
                    @if (r.plan.preview) {
                      <span class="jb-tag jb-tag-warn ml-1">test billing</span>
                    }
                  </td>
                  <td class="py-2 pr-4 tabular-nums">{{ r.plan.credits }}</td>
                  <td class="max-w-56 py-2 pr-4 text-ink-muted">
                    <span class="line-clamp-2">{{ r.plan.note || '—' }}</span>
                  </td>
                  <td class="py-2 text-right">
                    <button
                      type="button"
                      jbButton
                      size="sm"
                      (click)="manage(r)"
                    >
                      Manage
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>

    <jb-sheet [(open)]="open" [title]="sheetTitle()">
      @if (editing(); as r) {
        <form
          id="plan-form"
          [formGroup]="form"
          (ngSubmit)="save()"
          class="flex flex-col gap-4"
          novalidate
        >
          <p class="text-sm text-ink-muted">
            {{ r.user.email }} is on {{ r.line }} with
            {{ r.plan.credits }} credits.
          </p>
          <jb-field label="Plan">
            <select jbInput formControlName="plan">
              <option value="free">Free</option>
              <option value="pro">Pro</option>
            </select>
          </jb-field>
          @if (form.controls.plan.value === 'pro') {
            <jb-field
              label="Pro until"
              [optional]="true"
              hint="Leave empty for no end date."
            >
              <input jbInput type="date" formControlName="until" />
            </jb-field>
          }
          <jb-field
            label="Credits to add"
            hint="A negative number takes credits back."
          >
            <input
              jbInput
              type="number"
              step="1"
              inputmode="numeric"
              formControlName="credits"
            />
          </jb-field>
          <jb-field
            label="Reason"
            hint="Kept with the change, so you know later why it was made."
          >
            <input
              jbInput
              formControlName="reason"
              maxlength="500"
              placeholder="Beta tester, refund, support fix…"
            />
          </jb-field>
          @if (problem() && form.dirty) {
            <p class="text-sm text-ink-muted" role="status">{{ problem() }}</p>
          }

          <label
            class="mt-2 flex items-start gap-3 border-t border-line pt-4 text-sm"
          >
            <input
              type="checkbox"
              role="switch"
              class="jb-switch mt-0.5 shrink-0"
              [checked]="r.plan.preview"
              [disabled]="busy()"
              (change)="togglePreview(r)"
            />
            <span>
              <span class="font-medium text-ink">Test billing</span>
              <span class="block text-ink-muted"
                >Applies the plan's limits to this account now, while billing
                stays off for everyone else.</span
              >
            </span>
          </label>
        </form>
      }
      <div footer class="flex justify-end gap-2">
        <button type="button" jbButton (click)="open.set(false)">Cancel</button>
        <button
          type="submit"
          form="plan-form"
          jbButton="primary"
          [busy]="busy()"
          [disabled]="busy() || !!problem()"
        >
          Save
        </button>
      </div>
    </jb-sheet>
  `,
})
export class PlansPanel {
  private readonly repo = inject(AdminRepo);
  private readonly toast = inject(Toast);
  private readonly ownPlan = inject(Plan);

  /** The accounts from the admin overview, for names and emails. */
  readonly users = input.required<AdminUser[]>();

  readonly plans = signal<AdminPlan[]>([]);
  readonly enabled = signal(false);
  readonly loaded = signal(false);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly open = signal(false);
  readonly editing = signal<Row | null>(null);

  readonly rows = computed<Row[]>(() => {
    const byId = new Map(this.plans().map((p) => [p.id, p]));
    return this.users().flatMap((user) => {
      const plan = byId.get(user.id);
      return plan ? [{ user, plan, line: planLine(plan) }] : [];
    });
  });
  readonly sheetTitle = computed(() => {
    const r = this.editing();
    return r ? `Plan for ${r.user.name || r.user.email}` : 'Plan';
  });

  readonly form = new FormGroup({
    plan: new FormControl<'free' | 'pro'>('free', { nonNullable: true }),
    until: new FormControl('', { nonNullable: true }),
    credits: new FormControl(0, { nonNullable: true }),
    reason: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(500)],
    }),
  });
  private readonly formValue = signal(this.form.getRawValue());

  readonly change = computed(() => {
    const r = this.editing();
    return r ? planChange(r.plan, this.formValue()) : null;
  });
  readonly problem = computed(() => this.change()?.problem ?? '');

  constructor() {
    this.form.valueChanges.subscribe(() =>
      this.formValue.set(this.form.getRawValue()),
    );
    void this.load();
  }

  async load() {
    try {
      const v = await this.repo.plans();
      this.plans.set(v.users);
      this.enabled.set(v.enabled);
      this.error.set('');
    } catch (e) {
      this.error.set(
        /admin_plans/.test((e as Error).message)
          ? 'Plans need migration 0033 on the database; it is not applied yet.'
          : (e as Error).message || 'Could not load plans',
      );
    } finally {
      this.loaded.set(true);
    }
  }

  manage(r: Row) {
    this.editing.set(r);
    this.form.reset({
      plan: r.plan.plan === 'pro' ? 'pro' : 'free',
      until: r.plan.periodEnd ? r.plan.periodEnd.slice(0, 10) : '',
      credits: 0,
      reason: '',
    });
    this.open.set(true);
  }

  async save() {
    const r = this.editing();
    const change = this.change();
    if (!r || !change || change.problem || this.busy()) return;
    const reason = this.form.controls.reason.value.trim();
    this.busy.set(true);
    try {
      if (change.setPlan)
        await this.repo.setPlan(
          r.user.id,
          change.setPlan.plan,
          reason,
          change.setPlan.until,
        );
      if (change.credits)
        await this.repo.addCredits(r.user.id, change.credits, reason);
      this.toast.show('Saved');
      this.open.set(false);
      await this.afterChange();
    } catch (e) {
      this.toast.show((e as Error).message || 'Could not save');
      await this.load(); // one of the two steps may have gone through
    } finally {
      this.busy.set(false);
    }
  }

  async togglePreview(r: Row) {
    if (this.busy()) return;
    const on = !r.plan.preview;
    this.busy.set(true);
    try {
      await this.repo.setBillingPreview(r.user.id, on);
      this.toast.show(
        on ? 'Test billing is on for them' : 'Test billing is off for them',
      );
      await this.afterChange();
      const fresh = this.rows().find((x) => x.user.id === r.user.id);
      if (fresh) this.editing.set(fresh);
    } catch (e) {
      this.toast.show((e as Error).message || 'Could not change it');
    } finally {
      this.busy.set(false);
    }
  }

  /** Reloads the table, and the admin's own plan in case it was theirs. */
  private async afterChange() {
    await Promise.all([this.load(), this.ownPlan.refresh()]);
  }
}
