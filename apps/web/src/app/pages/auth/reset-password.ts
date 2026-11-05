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
import { Auth } from '../../core/auth';
import { AuthShell } from './auth-shell';

/** Landing page for the email link; Supabase puts a recovery session in the URL. */
@Component({
  selector: 'jb-reset-password',
  imports: [ReactiveFormsModule, AuthShell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <jb-auth-shell heading="Choose a new password">
      <form
        [formGroup]="form"
        (ngSubmit)="submit()"
        class="flex flex-col gap-4"
        novalidate
      >
        <label class="flex flex-col gap-1 text-sm">
          <span
            >New password
            <span class="text-ink-muted">(8+ characters)</span></span
          >
          <input
            id="reset-password"
            type="password"
            formControlName="password"
            autocomplete="new-password"
            class="jb-input"
          />
        </label>
        @if (error()) {
          <p class="text-sm text-bad" role="alert">
            {{ error() }}
          </p>
        }
        <button
          type="submit"
          class="jb-btn-primary jb-btn-lg mt-2 w-full"
          [attr.aria-busy]="busy() ? 'true' : null"
          [disabled]="password.invalid || busy()"
        >
          Save password
        </button>
      </form>
    </jb-auth-shell>
  `,
})
export class ResetPassword {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  readonly form = new FormGroup({
    password: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(8)],
    }),
  });
  readonly password = this.form.controls.password;
  readonly busy = signal(false);
  readonly error = signal('');

  async submit() {
    if (this.password.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.updatePassword(this.password.getRawValue());
      await this.router.navigateByUrl('/');
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }
}
