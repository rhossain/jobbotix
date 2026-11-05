import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SettingsRepo } from '../../core/data/repos';
import { RelativeDayPipe } from '../../shared/format';
import { Toast } from '../../shared/toast';

/** Account, AI key and model, usage, ingest keys. */
@Component({
  selector: 'jb-settings',
  imports: [ReactiveFormsModule, RouterLink, RelativeDayPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="flex max-w-3xl flex-col gap-10">
      <header>
        <h1 class="text-2xl font-semibold tracking-tight">Settings</h1>
      </header>

      <!-- Profile -->
      <form
        [formGroup]="profileForm"
        (ngSubmit)="saveProfile()"
        class="flex flex-col gap-4"
        novalidate
      >
        <h2 class="jb-section-title">Account</h2>
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="flex flex-col gap-1 text-sm"
            ><span>Name</span
            ><input
              id="st-name"
              class="jb-input"
              formControlName="name"
              autocomplete="name"
          /></label>
          <label class="flex flex-col gap-1 text-sm">
            <span
              >Timezone
              <span class="text-neutral-500">(for the digest hour)</span></span
            >
            <input
              id="st-tz"
              class="jb-input"
              formControlName="timezone"
              list="tz-list"
            />
            <datalist id="tz-list">
              @for (tz of timezones; track tz) {
                <option [value]="tz"></option>
              }
            </datalist>
          </label>
        </div>
        <p class="text-sm text-neutral-500">
          Signed in as {{ repo.profile()?.email }}
        </p>
        <div>
          <button
            type="submit"
            class="jb-btn-primary"
            [disabled]="profileForm.pristine || busy()"
          >
            Save
          </button>
        </div>
      </form>

      <!-- AI -->
      <section class="flex flex-col gap-4">
        <h2 class="jb-section-title">AI</h2>
        <p class="text-sm text-neutral-600 dark:text-neutral-300">
          Your daily search already produces scores, letters and answers through
          your Claude scheduled task at no cost here. Add your own Anthropic API
          key only if you want to regenerate inside the app; calls are billed to
          your key.
        </p>
        @if (hasKey()) {
          <div
            class="jb-card flex flex-wrap items-center justify-between gap-3 p-3 text-sm"
          >
            <span
              >Anthropic key on file{{ last4() ? ' · ending ' + last4() : '' }}.
              Stored server-side in Vault; never shown again.</span
            >
            <button
              type="button"
              class="jb-btn"
              (click)="clearKey()"
              [disabled]="busy()"
            >
              Remove key
            </button>
          </div>
        } @else {
          <form
            [formGroup]="keyForm"
            (ngSubmit)="saveKey()"
            class="flex flex-wrap items-end gap-2"
            novalidate
          >
            <label class="flex min-w-0 flex-1 basis-72 flex-col gap-1 text-sm">
              <span>Anthropic API key</span>
              <input
                id="st-key"
                type="password"
                class="jb-input font-mono"
                formControlName="key"
                autocomplete="off"
                placeholder="sk-ant-…"
              />
            </label>
            <button
              type="submit"
              class="jb-btn-primary"
              [disabled]="keyForm.invalid || busy()"
            >
              {{ busy() ? 'Checking…' : 'Save key' }}
            </button>
          </form>
          @if (keyError()) {
            <p class="text-sm text-red-700 dark:text-red-300" role="alert">
              {{ keyError() }}
            </p>
          }
        }
        <label class="flex flex-wrap items-center gap-2 text-sm">
          Default model
          <select
            id="st-model"
            class="jb-input jb-input-inline"
            [value]="repo.profile()?.default_model"
            (change)="setModel($any($event.target).value)"
          >
            @for (m of repo.models(); track m.id) {
              <option
                [value]="m.id"
                [selected]="m.id === repo.profile()?.default_model"
              >
                {{ m.label }}
              </option>
            }
          </select>
          <span class="text-neutral-500"
            >Every Generate button can override it.</span
          >
        </label>
      </section>

      <!-- Usage -->
      <section class="flex flex-col gap-3">
        <h2 class="jb-section-title">AI usage on your key</h2>
        @if (usageByModel().length === 0) {
          <p class="text-sm text-neutral-500">No in-app AI calls yet.</p>
        } @else {
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead
                class="text-left text-xs uppercase tracking-wide text-neutral-500"
              >
                <tr>
                  <th class="py-2 pr-4">Model</th>
                  <th class="py-2 pr-4">Calls</th>
                  <th class="py-2 pr-4">Tokens in</th>
                  <th class="py-2 pr-4">Tokens out</th>
                  <th class="py-2">Last used</th>
                </tr>
              </thead>
              <tbody>
                @for (u of usageByModel(); track u.model) {
                  <tr
                    class="border-t border-neutral-200 dark:border-neutral-800"
                  >
                    <td class="py-2 pr-4 font-mono">{{ u.model }}</td>
                    <td class="py-2 pr-4 tabular-nums">{{ u.calls }}</td>
                    <td class="py-2 pr-4 tabular-nums">{{ u.in }}</td>
                    <td class="py-2 pr-4 tabular-nums">{{ u.out }}</td>
                    <td class="py-2">{{ u.last | relativeDay }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>

      <!-- Ingest keys -->
      <section class="flex flex-col gap-3">
        <h2 class="jb-section-title">Ingest keys</h2>
        <p class="text-sm text-neutral-600 dark:text-neutral-300">
          Each key lets one scheduled task post results under your account.
          Create one from
          <a routerLink="/search" class="underline">Search profile</a>; revoke
          it here if it leaks.
        </p>
        @if (repo.ingestKeys().length === 0) {
          <p class="text-sm text-neutral-500">No keys yet.</p>
        } @else {
          <ul
            class="divide-y divide-neutral-200 text-sm dark:divide-neutral-800"
          >
            @for (k of repo.ingestKeys(); track k.id) {
              <li
                class="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <span>
                  {{ k.label }} · created {{ k.created_at | relativeDay }}
                  @if (k.last_used_at) {
                    · last used {{ k.last_used_at | relativeDay }}
                  }
                  @if (k.revoked_at) {
                    <span class="jb-tag ml-1">revoked</span>
                  }
                </span>
                @if (!k.revoked_at) {
                  <button
                    type="button"
                    class="jb-btn"
                    (click)="revoke(k.id)"
                    [disabled]="busy()"
                  >
                    Revoke
                  </button>
                }
              </li>
            }
          </ul>
        }
      </section>
    </section>
  `,
})
export class Settings {
  protected readonly repo = inject(SettingsRepo);
  private readonly toast = inject(Toast);

  readonly busy = signal(false);
  readonly keyError = signal('');
  readonly last4 = signal('');
  readonly hasKey = computed(() => !!this.repo.profile()?.anthropic_key_ref);
  readonly timezones: string[] =
    (
      Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
    ).supportedValuesOf?.('timeZone') ?? [];

  readonly profileForm = new FormGroup({
    name: new FormControl('', { nonNullable: true }),
    timezone: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });
  readonly keyForm = new FormGroup({
    key: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.pattern(/^sk-ant-[A-Za-z0-9_-]{20,}$/),
      ],
    }),
  });

  readonly usageByModel = computed(() => {
    const by = new Map<
      string,
      { model: string; calls: number; in: number; out: number; last: string }
    >();
    for (const u of this.repo.usage()) {
      const row = by.get(u.model) ?? {
        model: u.model,
        calls: 0,
        in: 0,
        out: 0,
        last: u.created_at,
      };
      row.calls++;
      row.in += u.tokens_in;
      row.out += u.tokens_out;
      if (u.created_at > row.last) row.last = u.created_at;
      by.set(u.model, row);
    }
    return [...by.values()].sort((a, b) => b.calls - a.calls);
  });

  constructor() {
    void this.repo.load();
    effect(() => {
      const p = this.repo.profile();
      if (p)
        untracked(() =>
          this.profileForm.reset({ name: p.name, timezone: p.timezone }),
        );
    });
  }

  async saveProfile() {
    if (this.profileForm.invalid || this.busy()) return;
    this.busy.set(true);
    try {
      await this.repo.updateProfile(this.profileForm.getRawValue());
      this.profileForm.markAsPristine();
      this.toast.show('Saved');
    } catch (e) {
      this.toast.show((e as Error).message || 'Could not save');
    } finally {
      this.busy.set(false);
    }
  }

  async setModel(model: string) {
    try {
      await this.repo.updateProfile({ default_model: model });
      this.toast.show('Default model updated');
    } catch {
      this.toast.show('Could not save the model');
    }
  }

  async saveKey() {
    if (this.keyForm.invalid || this.busy()) return;
    this.busy.set(true);
    this.keyError.set('');
    try {
      this.last4.set(
        await this.repo.setAnthropicKey(
          this.keyForm.controls.key.getRawValue(),
        ),
      );
      this.keyForm.reset();
      this.toast.show('Key stored');
    } catch (e) {
      this.keyError.set((e as Error).message || 'Could not store the key');
    } finally {
      this.busy.set(false);
    }
  }

  async clearKey() {
    this.busy.set(true);
    try {
      await this.repo.clearAnthropicKey();
      this.last4.set('');
      this.toast.show('Key removed');
    } finally {
      this.busy.set(false);
    }
  }

  async revoke(id: string) {
    this.busy.set(true);
    try {
      await this.repo.revokeIngestKey(id);
      this.toast.show('Key revoked');
    } finally {
      this.busy.set(false);
    }
  }
}
