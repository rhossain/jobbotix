import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { InviteCodeRow } from '@jobbotix/shared-types';
import { injectSupabase } from '../../core/supabase';

/** Admin v0: create and revoke invite codes. */
@Component({
  selector: 'jb-admin-invites',
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="max-w-3xl">
      <p class="text-sm">
        <a routerLink="/admin" class="underline">← Admin</a>
      </p>
      <h1 class="mt-2 text-2xl font-semibold tracking-tight">Invite codes</h1>
      <p class="mt-1 text-sm text-ink-muted">
        Each code admits one person. Send them the link shown next to the code.
      </p>

      <form
        [formGroup]="form"
        (ngSubmit)="create()"
        class="mt-6 flex flex-wrap items-end gap-3"
        novalidate
      >
        <label class="flex flex-col gap-1 text-sm">
          <span>Who is this for? (optional)</span>
          <input
            id="invite-note"
            type="text"
            formControlName="note"
            class="jb-input w-64"
            placeholder="e.g. Rafi from the Angular meetup"
          />
        </label>
        <button type="submit" class="jb-btn-primary" [disabled]="busy()">
          New code
        </button>
      </form>
      @if (error()) {
        <p class="mt-3 text-sm text-bad" role="alert">
          {{ error() }}
        </p>
      }
      @if (lastCode()) {
        <p
          class="mt-3 rounded-md bg-brand-tint px-3 py-2 text-sm text-brand-ink"
          role="status"
        >
          Created <code class="font-mono">{{ lastCode() }}</code> · link:
          <code class="font-mono">{{ origin }}/signup/{{ lastCode() }}</code>
        </p>
      }

      <div class="mt-6 overflow-x-auto">
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
                        class="jb-btn"
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
