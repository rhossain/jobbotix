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
import { RouterLink } from '@angular/router';
import { Auth } from '../../core/auth';
import { AuthShell } from './auth-shell';

@Component({
  selector: 'jb-forgot-password',
  imports: [ReactiveFormsModule, RouterLink, AuthShell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <jb-auth-shell
      heading="Reset your password"
      lead="We'll email you a link that opens a page to set a new one."
    >
      @if (sent()) {
        <p class="text-sm" role="status">
          If an account exists for that address, the email is on its way.
        </p>
      } @else {
        <form
          [formGroup]="form"
          (ngSubmit)="submit()"
          class="flex flex-col gap-4"
          novalidate
        >
          <label class="flex flex-col gap-1 text-sm">
            <span>Email</span>
            <input
              id="forgot-email"
              type="email"
              formControlName="email"
              autocomplete="email"
              class="jb-input"
            />
          </label>
          @if (error()) {
            <p class="text-sm text-red-700 dark:text-red-300" role="alert">
              {{ error() }}
            </p>
          }
          <button
            type="submit"
            class="jb-btn-primary"
            [disabled]="email.invalid || busy()"
          >
            Send reset link
          </button>
        </form>
      }
      <p class="mt-4 text-sm">
        <a routerLink="/login" class="underline">Back to sign in</a>
      </p>
    </jb-auth-shell>
  `,
})
export class ForgotPassword {
  private readonly auth = inject(Auth);
  readonly form = new FormGroup({
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
  });
  readonly email = this.form.controls.email;
  readonly busy = signal(false);
  readonly sent = signal(false);
  readonly error = signal('');

  async submit() {
    if (this.email.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.requestPasswordReset(this.email.getRawValue());
      this.sent.set(true);
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }
}
