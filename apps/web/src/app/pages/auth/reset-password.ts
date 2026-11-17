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
import { Router } from '@angular/router';
import { Auth } from '../../core/auth';
import { AuthShell } from './auth-shell';
import { EyeToggle } from './eye-toggle';
import { focusFirstInvalid } from './field-help';

/** Landing page for the email link; Supabase puts a recovery session in the URL. */
@Component({
  selector: 'jb-reset-password',
  imports: [ReactiveFormsModule, AuthShell, EyeToggle],
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
          <div class="relative">
            <input
              id="reset-password"
              [type]="show() ? 'text' : 'password'"
              formControlName="password"
              autocomplete="new-password"
              class="jb-input pr-11"
              [attr.aria-invalid]="tried() && password.invalid"
            />
            <jb-eye-toggle [(shown)]="show" />
          </div>
          @if (tried() && password.invalid) {
            <span class="text-bad"
              >Choose a password with at least 8 characters.</span
            >
          }
        </label>
        <label class="flex flex-col gap-1 text-sm">
          <span>Type the new password again</span>
          <div class="relative">
            <input
              id="reset-confirm"
              [type]="show() ? 'text' : 'password'"
              formControlName="confirm"
              autocomplete="new-password"
              class="jb-input pr-11"
              [attr.aria-invalid]="tried() && mismatch()"
            />
            <jb-eye-toggle [(shown)]="show" />
          </div>
          @if (tried() && mismatch()) {
            <span class="text-bad">{{
              form.controls.confirm.value
                ? 'The two passwords are not the same. Type it again.'
                : 'Type the password a second time, so a typing mistake is caught.'
            }}</span>
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
    confirm: new FormControl('', { nonNullable: true }),
  });

  /** The second password box is empty or differs from the first. */
  protected mismatch(): boolean {
    const { password, confirm } = this.form.controls;
    return confirm.value !== password.value || !confirm.value;
  }
  readonly password = this.form.controls.password;
  readonly busy = signal(false);
  readonly error = signal('');
  readonly tried = signal(false);
  readonly show = signal(false);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  async submit() {
    if (this.busy()) return;
    this.tried.set(true);
    if (this.password.invalid) {
      focusFirstInvalid(this.host.nativeElement);
      return;
    }
    if (this.mismatch()) {
      this.host.nativeElement
        .querySelector<HTMLElement>('#reset-confirm')
        ?.focus();
      return;
    }
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
