import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import type { InviteCodeRow } from '@jobbotix/shared-types';
import { injectSupabase } from '../../core/supabase';
import { BackLink, Confirm, CopyButton, Icon, PageHeader } from '../../ui';

/** Admin v0: create and revoke invite codes. */
@Component({
  selector: 'jb-admin-invites',
  imports: [BackLink, CopyButton, Icon, PageHeader, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="max-w-3xl">
      <jb-back-link
        class="mb-4 hidden md:inline-block"
        link="/admin"
        label="Admin"
      />
      <jb-page-header
        title="Invite codes"
        lead="Each code admits one person. Send them the link shown next to the code."
      />

      <form
        [formGroup]="form"
        (ngSubmit)="create()"
        class="jb-card mt-6 flex flex-col gap-3 p-5 sm:flex-row sm:items-end"
        novalidate
      >
        <label class="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-medium">
          <span
            >Who is this for?
            <span class="font-normal text-ink-muted">(optional)</span></span
          >
          <input
            id="invite-note"
            type="text"
            formControlName="note"
            class="jb-input"
            placeholder="e.g. Rafi from the Angular meetup"
          />
        </label>
        <button
          type="submit"
          class="jb-btn-primary"
          [attr.aria-busy]="busy() ? 'true' : null"
          [disabled]="busy()"
        >
          <jb-icon name="plus" /> New code
        </button>
      </form>
      @if (error()) {
        <p class="mt-3 text-sm text-bad" role="alert">
          {{ error() }}
        </p>
      }
      @if (lastCode()) {
        <div
          class="mt-3 flex flex-col gap-2 rounded-control bg-brand-tint px-3.5 py-3 text-sm text-brand-ink sm:flex-row sm:items-center"
          role="status"
        >
          <span class="min-w-0 flex-1 break-all">
            Created <code class="font-mono">{{ lastCode() }}</code
            >. Link:
            <code class="font-mono">{{ origin }}/signup/{{ lastCode() }}</code>
          </span>
          <jb-copy-button
            [text]="origin + '/signup/' + lastCode()"
            label="Copy link"
            size="sm"
          />
        </div>
      }

      <div class="jb-card mt-6 overflow-x-auto p-5">
        @if (codes().length === 0) {
          <p class="text-sm text-ink-muted">
            No invite codes yet. Create the first one above.
          </p>
        } @else {
          <table class="w-full text-sm">
            <thead class="text-left text-xs text-ink-muted">
              <tr>
                <th class="py-2 pr-4">Code</th>
                <th class="py-2 pr-4">Note</th>
                <th class="py-2 pr-4">Uses</th>
                <th class="py-2 pr-4">Status</th>
                <th class="py-2"></th>
              </tr>
            </thead>
            <tbody>
              @for (c of codes(); track c.code) {
                <tr class="border-t border-line">
                  <td class="py-2 pr-4 font-mono">{{ c.code }}</td>
                  <td class="py-2 pr-4">{{ c.note }}</td>
                  <td class="py-2 pr-4 tabular-nums">
                    {{ c.uses }} / {{ c.max_uses }}
                  </td>
                  <td class="py-2 pr-4">{{ statusOf(c) }}</td>
                  <td class="py-2 text-right">
                    @if (statusOf(c) === 'Open') {
                      <button
                        type="button"
                        class="jb-btn jb-btn-sm text-bad"
                        (click)="revoke(c.code)"
                        [disabled]="busy()"
                      >
                        Revoke
                      </button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </div>
    </section>
  `,
})
export class AdminInvites {
  private readonly confirm = inject(Confirm);
  private readonly supabase = injectSupabase();
  readonly origin = location.origin;
  readonly form = new FormGroup({
    note: new FormControl('', { nonNullable: true }),
  });
  readonly note = this.form.controls.note;
  readonly codes = signal<InviteCodeRow[]>([]);
  readonly lastCode = signal('');
  readonly busy = signal(false);
  readonly error = signal('');

  constructor() {
    void this.load();
  }

  statusOf(c: InviteCodeRow): 'Open' | 'Used' | 'Revoked' | 'Expired' {
    if (c.revoked_at) return 'Revoked';
    if (c.expires_at && new Date(c.expires_at) < new Date()) return 'Expired';
    if (c.uses >= c.max_uses) return 'Used';
    return 'Open';
  }

  async load() {
    const { data, error } = await this.supabase
      .from('invite_codes')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) this.error.set(error.message);
    this.codes.set(data ?? []);
  }

  async create() {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const { data, error } = await this.supabase.rpc('admin_create_invite', {
        p_note: this.note.getRawValue(),
      });
      if (error) throw error;
      this.lastCode.set(data ?? '');
      this.note.setValue('');
      await this.load();
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }

  async revoke(code: string) {
    if (this.busy()) return;
    const ok = await this.confirm.ask({
      title: `Revoke the code ${code}?`,
      body: 'Nobody can sign up with it after this. Accounts already created stay.',
      action: 'Revoke code',
      danger: true,
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      const { error } = await this.supabase.rpc('admin_revoke_invite', {
        p_code: code,
      });
      if (error) throw error;
      await this.load();
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }
}
