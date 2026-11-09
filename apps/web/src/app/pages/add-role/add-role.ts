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
import { Router } from '@angular/router';
import { RolesRepo } from '../../core/data/repos';
import { Toast } from '../../shared/toast';
import {
  BackLink,
  Button,
  Field,
  FieldControl,
  Icon,
  PageHeader,
} from '../../ui';
import { environment } from '../../../environments/environment';

const URL_PATTERN = /^https?:\/\/\S+$/i;

/** Add a posting the daily run did not find. */
@Component({
  selector: 'jb-add-role',
  imports: [
    BackLink,
    Button,
    Field,
    FieldControl,
    Icon,
    PageHeader,
    ReactiveFormsModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-2xl">
      <jb-back-link
        class="mb-4 hidden md:inline-block"
        link="/roles"
        label="Roles"
      />
      <jb-page-header
        title="Add a role"
        lead="Paste the posting's link. Jobbotix reads the page, fills in company, title, stack and pay, and scores it against your search profile. You can fix anything on the role's page afterwards."
      />

      <form
        [formGroup]="form"
        (ngSubmit)="submit()"
        class="jb-card mt-6 flex flex-col gap-5 p-5 md:mt-8 md:p-7"
        novalidate
      >
        <jb-field label="Posting URL" [error]="urlError()">
          <input
            jbInput
            id="add-url"
            type="url"
            inputmode="url"
            formControlName="url"
            placeholder="https://company.com/careers/senior-angular-engineer"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            (blur)="urlTouched.set(true)"
          />
        </jb-field>
        <jb-field
          label="Posting text"
          [optional]="!demo"
          [hint]="
            demo
              ? 'Demo mode cannot fetch pages, so paste the posting here (80 characters or more).'
              : 'Paste it if the page blocks automated reading: select all on the posting, copy, paste.'
          "
        >
          <textarea
            jbInput
            [autogrow]="true"
            id="add-text"
            rows="6"
            formControlName="text"
            class="max-h-[60dvh]"
            placeholder="The full posting text"
          ></textarea>
        </jb-field>

        @if (error()) {
          <p
            class="flex items-start gap-2.5 rounded-control bg-bad-tint px-3.5 py-3 text-sm text-bad"
            role="alert"
          >
            <jb-icon name="circle-x" [size]="18" class="mt-px" />
            {{ error() }}
          </p>
        }
        @if (busy()) {
          <p
            class="flex items-center gap-2.5 text-sm text-ink-muted"
            role="status"
          >
            <jb-icon
              name="loader-circle"
              [size]="18"
              class="animate-spin text-brand"
            />
            Reading and scoring the posting. This can take up to 30 seconds.
          </p>
        }

        <div
          class="flex flex-col-reverse gap-3 border-t border-line pt-5 md:flex-row md:items-center md:justify-between"
        >
          <p class="text-xs text-ink-muted">
            Scored the same way as the roles the morning run finds.
          </p>
          <button
            type="submit"
            jbButton="primary"
            size="lg"
            [busy]="busy()"
            [disabled]="form.invalid || busy()"
          >
            <jb-icon name="plus" /> Add role
          </button>
        </div>
      </form>
    </div>
  `,
})
export class AddRole {
  private readonly repo = inject(RolesRepo);
  private readonly router = inject(Router);
  private readonly toast = inject(Toast);
  readonly demo = environment.demo;
  readonly busy = signal(false);
  readonly error = signal('');
  readonly urlTouched = signal(false);

  urlError(): string | null {
    const c = this.form.controls.url;
    if (!this.urlTouched() || c.valid) return null;
    return c.value
      ? 'Use the full link, starting with https://'
      : 'Paste the link to the posting';
  }

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
      if (result.existed) this.toast.show('Already in your roles');
      else this.toast.success('Role added');
      await this.router.navigate(['/roles', result.id]);
    } catch (e) {
      this.error.set((e as Error).message || 'Could not add the role');
    } finally {
      this.busy.set(false);
    }
  }
}
