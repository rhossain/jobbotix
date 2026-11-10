import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ROLE_STATUS_LABELS } from '@jobbotix/shared-types';
import { Auth } from '../../core/auth';
import { AccountDataRepo, RolesRepo } from '../../core/data/repos';
import {
  previewImport,
  rolesToCsv,
  type ImportPreview,
} from '../../shared/csv';
import { Toast } from '../../shared/toast';
import { Button, Icon } from '../../ui';

function download(name: string, type: string, body: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([body], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const today = () => new Date().toISOString().slice(0, 10);

/** Settings → Your data: download it, bring roles in from a spreadsheet, delete the account. */
@Component({
  selector: 'jb-data-panel',
  imports: [Button, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    <section
      class="jb-card flex flex-col gap-3 p-5 md:p-6"
      aria-labelledby="data-h"
    >
      <h2 id="data-h" class="jb-section-title">Your data</h2>
      <p class="text-sm text-ink-muted">
        Download your roles for a spreadsheet, or everything in your account
        (roles, resumes, letters, interviews, people, settings) as one file.
      </p>
      <div class="flex flex-wrap gap-2">
        <button type="button" jbButton (click)="exportCsv()">
          <jb-icon name="download" /> Roles (CSV)
        </button>
        <button
          type="button"
          jbButton
          [busy]="exporting()"
          [disabled]="exporting()"
          (click)="exportJson()"
        >
          <jb-icon name="download" /> Everything (JSON)
        </button>
      </div>

      <h3 class="mt-3 font-semibold text-ink">Import roles</h3>
      <p class="text-sm text-ink-muted">
        A CSV from a spreadsheet, Huntr or Teal. Jobbotix finds the company,
        title, link, status, location, pay and notes columns by name; rows
        without a link are skipped, and roles you already have are left alone.
      </p>
      <label class="w-fit">
        <span class="jb-btn cursor-pointer"
          ><jb-icon name="upload" /> Choose a CSV file</span
        >
        <input
          type="file"
          accept=".csv,text/csv,.tsv,text/tab-separated-values"
          class="sr-only"
          (change)="read($any($event.target))"
        />
      </label>
      @if (preview(); as p) {
        <div class="rounded-control border border-line p-4 text-sm">
          <p class="font-medium text-ink">
            {{ fileName() }}: {{ p.roles.length }}
            {{ p.roles.length === 1 ? 'role' : 'roles' }} to import{{
              p.skipped.length ? ', ' + p.skipped.length + ' skipped' : ''
            }}
          </p>
          <p class="mt-1 text-ink-muted">
            Columns used:
            @for (c of columnList(); track c[0]; let last = $last) {
              <b class="font-medium text-ink">{{ c[1] }}</b> as {{ c[0]
              }}{{ last ? '' : ', ' }}
            } @empty {
              none recognised
            }
          </p>
          @if (p.roles.length) {
            <ul class="mt-3 flex flex-col gap-1">
              @for (r of p.roles.slice(0, 5); track r.url) {
                <li class="truncate">
                  {{ r.title }}
                  <span class="text-ink-muted"
                    >at {{ r.company }} · {{ statusLabels[r.status] }}</span
                  >
                </li>
              }
              @if (p.roles.length > 5) {
                <li class="text-ink-muted">
                  and {{ p.roles.length - 5 }} more
                </li>
              }
            </ul>
          }
          @if (p.skipped.length) {
            <details class="mt-3 text-ink-muted">
              <summary class="cursor-pointer">Skipped rows</summary>
              <ul class="mt-1">
                @for (s of p.skipped.slice(0, 50); track s.row) {
                  <li>Row {{ s.row }}: {{ s.reason }}</li>
                }
              </ul>
            </details>
          }
          <div class="mt-4 flex gap-2">
            <button
              type="button"
              jbButton="primary"
              [busy]="importing()"
              [disabled]="importing() || !p.roles.length"
              (click)="runImport()"
            >
              Import {{ p.roles.length }}
              {{ p.roles.length === 1 ? 'role' : 'roles' }}
            </button>
            <button type="button" jbButton="ghost" (click)="preview.set(null)">
              Cancel
            </button>
          </div>
        </div>
      }
    </section>

    <section
      class="jb-card flex flex-col gap-3 border-bad/40 p-5 md:p-6"
      aria-labelledby="delete-h"
    >
      <h2 id="delete-h" class="jb-section-title text-bad">
        Delete your account
      </h2>
      <p class="text-sm text-ink-muted">
        Removes your account and everything in it straight away: roles, resumes,
        letters, interviews, people, keys and your saved Anthropic key. It
        cannot be undone; download your data first if you want a copy.
      </p>
      <label class="flex flex-col gap-1.5 text-sm font-medium">
        Type your email to confirm
        <input
          class="jb-input max-w-sm"
          type="email"
          autocomplete="off"
          [placeholder]="email()"
          [value]="typed()"
          (input)="typed.set($any($event.target).value)"
        />
      </label>
      <div>
        <button
          type="button"
          jbButton="danger"
          [busy]="deleting()"
          [disabled]="deleting() || !matches()"
          (click)="deleteAccount()"
        >
          <jb-icon name="trash" /> Delete my account
        </button>
      </div>
    </section>
  `,
})
export class DataPanel {
  private readonly data = inject(AccountDataRepo);
  private readonly roles = inject(RolesRepo);
  private readonly auth = inject(Auth);
  private readonly toast = inject(Toast);
  readonly statusLabels = ROLE_STATUS_LABELS;

  readonly exporting = signal(false);
  readonly importing = signal(false);
  readonly deleting = signal(false);
  readonly preview = signal<ImportPreview | null>(null);
  readonly fileName = signal('');
  readonly typed = signal('');
  readonly email = computed(() => this.auth.profile()?.email ?? '');
  readonly matches = computed(
    () =>
      !!this.email() &&
      this.typed().trim().toLowerCase() === this.email().toLowerCase(),
  );
  readonly columnList = computed(() =>
    Object.entries(this.preview()?.columns ?? {}),
  );

  constructor() {
    void this.roles.load();
  }

  exportCsv() {
    download(
      `jobbotix-roles-${today()}.csv`,
      'text/csv;charset=utf-8',
      rolesToCsv(this.roles.roles()),
    );
  }

  async exportJson() {
    this.exporting.set(true);
    try {
      const all = await this.data.exportAll();
      download(
        `jobbotix-export-${today()}.json`,
        'application/json',
        JSON.stringify(
          { exportedAt: new Date().toISOString(), ...all },
          null,
          2,
        ),
      );
    } catch (e) {
      this.toast.error((e as Error).message || 'Could not export');
    } finally {
      this.exporting.set(false);
    }
  }

  async read(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > 5_000_000) {
      this.toast.error('That file is over 5 MB; split it first');
      return;
    }
    this.fileName.set(file.name);
    this.preview.set(previewImport(await file.text()));
  }

  async runImport() {
    const p = this.preview();
    if (!p?.roles.length) return;
    this.importing.set(true);
    try {
      const r = await this.data.importRoles(p.roles);
      this.preview.set(null);
      const parts = [`${r.added} added`];
      if (r.duplicates) parts.push(`${r.duplicates} already there`);
      if (r.failed) parts.push(`${r.failed} failed`);
      this.toast.show(`Import done: ${parts.join(', ')}`);
    } catch (e) {
      this.toast.error((e as Error).message || 'Could not import');
    } finally {
      this.importing.set(false);
    }
  }

  async deleteAccount() {
    if (!this.matches()) return;
    this.deleting.set(true);
    try {
      await this.data.deleteAccount();
      location.assign('/');
    } catch (e) {
      this.toast.error((e as Error).message || 'Could not delete the account');
      this.deleting.set(false);
    }
  }
}
