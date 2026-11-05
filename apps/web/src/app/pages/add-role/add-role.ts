import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { RolesRepo } from '../../core/data/repos';
import { Toast } from '../../shared/toast';
import { environment } from '../../../environments/environment';

const URL_PATTERN = /^https?:\/\/\S+$/i;

/** Add a posting the daily run did not find. */
@Component({
  selector: 'jb-add-role',
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="max-w-2xl">
      <nav class="text-sm">
        <a routerLink="/roles" class="text-neutral-500 hover:underline"
          >← Roles</a
        >
      </nav>
      <h1 class="mt-4 text-2xl font-semibold tracking-tight">Add a role</h1>
      <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
        Paste the posting's link. Jobbotix reads the page and fills in company,
        title, stack and pay; you can fix anything on the role's page
        afterwards.
      </p>

      <form
        [formGroup]="form"
        (ngSubmit)="submit()"
        class="mt-6 flex flex-col gap-4"
        novalidate
      >
        <label class="flex flex-col gap-1 text-sm">
          <span>Posting URL</span>
          <input
            id="add-url"
            type="url"
            formControlName="url"
            class="jb-input"
            placeholder="https://…"
            autocomplete="off"
          />
        </label>
        <label class="flex flex-col gap-1 text-sm">
          <span>
            Posting text
            <span class="text-neutral-500">{{
              demo
                ? '(demo mode cannot fetch pages, so paste the posting here)'
                : '(optional: paste it if the page blocks automated reading)'
            }}</span>
          </span>
          <textarea
            id="add-text"
            formControlName="text"
            class="jb-input min-h-40"
            placeholder="Select all on the posting page, copy, paste here"
          ></textarea>
        </label>
        @if (error()) {
          <p class="text-sm text-red-700 dark:text-red-300" role="alert">
            {{ error() }}
          </p>
        }
        <div class="flex items-center gap-3">
          <button
            type="submit"
            class="jb-btn-primary"
            [disabled]="form.invalid || busy()"
          >
            {{ busy() ? 'Reading the posting…' : 'Add role' }}
          </button>
          <span class="text-xs text-neutral-500"
            >Added roles start with score 0 until a run or you score them.</span
          >
        </div>
      </form>
    </section>
  `,
})
export class AddRole {
  private readonly repo = inject(RolesRepo);
  private readonly router = inject(Router);
  private readonly toast = inject(Toast);
  readonly demo = environment.demo;
  readonly busy = signal(false);
  readonly error = signal('');

  readonly form = new FormGroup({
    url: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(URL_PATTERN)],
    }),
    text: new FormControl('', {
      nonNullable: true,
      validators: environment.demo
        ? [Validators.required, Validators.minLength(80)]
        : [],
    }),
  });

  async submit() {
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const { url, text } = this.form.getRawValue();
      const result = await this.repo.addFromUrl(url.trim(), text.trim());
      this.toast.show(result.existed ? 'Already in your roles' : 'Role added');
      await this.router.navigate(['/roles', result.id]);
    } catch (e) {
      this.error.set((e as Error).message || 'Could not add the role');
    } finally {
      this.busy.set(false);
    }
  }
}
