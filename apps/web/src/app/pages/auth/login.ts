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
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Auth } from '../../core/auth';
import { AuthShell } from './auth-shell';

@Component({
  selector: 'jb-login',
  imports: [ReactiveFormsModule, RouterLink, AuthShell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <jb-auth-shell
      heading="Sign in"
      lead="Your roles, letters and notes are waiting."
    >
      <form
        [formGroup]="form"
        (ngSubmit)="submit()"
        class="flex flex-col gap-4"
        novalidate
      >
        <label class="flex flex-col gap-1 text-sm">
          <span>Email</span>
          <input
            id="login-email"
            type="email"
            formControlName="email"
            autocomplete="email"
            class="jb-input"
          />
        </label>
        <label class="flex flex-col gap-1 text-sm">
          <span>Password</span>
          <input
            id="login-password"
            type="password"
            formControlName="password"
            autocomplete="current-password"
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
          [disabled]="form.invalid || busy()"
        >
          {{ busy() ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>
      <p footer>
        <a
          routerLink="/forgot-password"
          class="font-medium text-brand-ink underline"
          >Forgot password?</a
        >
        · Have an invite?
        <a routerLink="/signup" class="font-medium text-brand-ink underline"
          >Create an account</a
        >
      </p>
    </jb-auth-shell>
  `,
})
export class Login {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly busy = signal(false);
  readonly error = signal('');
  readonly form = new FormGroup({
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
    password: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  async submit() {
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const { email, password } = this.form.getRawValue();
      await this.auth.signIn(email, password);
      const next = this.route.snapshot.queryParamMap.get('next') || '/';
      await this.router.navigateByUrl(next);
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }
}
