import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
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
import { emailHelp, focusFirstInvalid } from './field-help';

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
          If there is an account for that address, the email is on its way. It
          can take a minute; check your spam folder too.
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
              [attr.aria-invalid]="tried() && email.invalid"
            />
            @if (tried() && email.invalid) {
              <span class="text-bad">{{ emailHelp(email) }}</span>
            }
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
            [disabled]="busy()"
          >
            Send reset link
          </button>
        </form>
      }
      <p footer>
        <a routerLink="/login" class="font-medium text-brand-ink underline"
          >Back to sign in</a
        >
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
  readonly tried = signal(false);
  protected readonly emailHelp = emailHelp;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly error = signal('');

  async submit() {
    if (this.busy()) return;
    this.tried.set(true);
    if (this.email.invalid) {
      focusFirstInvalid(this.host.nativeElement);
      return;
    }
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
