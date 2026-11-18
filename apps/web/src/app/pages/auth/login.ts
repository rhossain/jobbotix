import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
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
import { environment } from '../../../environments/environment';
import { Auth } from '../../core/auth';
import { AuthShell } from './auth-shell';
import { EyeToggle } from './eye-toggle';
import { emailHelp, focusFirstInvalid } from './field-help';
import { LinkedInButton, readAuthError } from './linkedin-button';

@Component({
  selector: 'jb-login',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AuthShell,
    EyeToggle,
    LinkedInButton,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <jb-auth-shell
      heading="Sign in"
      lead="Your jobs, letters and notes are waiting."
    >
      @if (ended(); as why) {
        <p
          class="mb-4 rounded-card border border-line bg-sunken p-3 text-sm text-ink"
          role="status"
        >
          @if (why === 'suspended') {
            This account has been suspended, so you were signed out. Write to
            <a class="text-brand-ink underline" [href]="'mailto:' + support">{{
              support
            }}</a>
            to ask about it.
          } @else {
            This account no longer exists, so you were signed out. If that is a
            mistake, write to
            <a class="text-brand-ink underline" [href]="'mailto:' + support">{{
              support
            }}</a
            >.
          }
        </p>
      }
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
            [attr.aria-invalid]="tried() && form.controls.email.invalid"
          />
          @if (tried() && form.controls.email.invalid) {
            <span class="text-bad">{{ emailHelp(form.controls.email) }}</span>
          }
        </label>
        <label class="flex flex-col gap-1 text-sm">
          <span>Password</span>
          <div class="relative">
            <input
              id="login-password"
              [type]="show() ? 'text' : 'password'"
              formControlName="password"
              autocomplete="current-password"
              class="jb-input pr-11"
              [attr.aria-invalid]="tried() && form.controls.password.invalid"
            />
            <jb-eye-toggle [(shown)]="show" />
          </div>
          @if (tried() && form.controls.password.invalid) {
            <span class="text-bad">Enter your password.</span>
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
          [disabled]="busy()"
        >
          {{ busy() ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>
      @if (linkedIn) {
        <jb-linkedin-button
          [busy]="liBusy()"
          [error]="liError()"
          (go)="continueWithLinkedIn()"
        />
      }
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

  protected readonly support = 'support@jobbotix.com';
  /** Set when the app signed this browser out: the account was deleted or suspended. */
  protected readonly ended = computed(() => {
    const why = this.route.snapshot.queryParamMap.get('ended');
    return why === 'removed' || why === 'suspended' ? why : null;
  });

  protected readonly linkedIn = environment.linkedinSignIn;
  readonly liBusy = signal(false);
  /** Why a LinkedIn sign-in did not work: read from the address it came back to, or set on a failed start. */
  readonly liError = signal(
    readAuthError(
      this.route.snapshot.queryParamMap,
      this.route.snapshot.fragment,
    ) ?? '',
  );

  readonly busy = signal(false);
  readonly error = signal('');
  /** True once Sign in was pressed: empty or mistyped boxes then say so. */
  readonly tried = signal(false);
  readonly show = signal(false);
  protected readonly emailHelp = emailHelp;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
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

  /** Off to LinkedIn's sign-in page; the browser comes back to /login. */
  async continueWithLinkedIn() {
    if (this.liBusy()) return;
    this.liBusy.set(true);
    this.liError.set('');
    try {
      await this.auth.signInWithLinkedIn(
        this.route.snapshot.queryParamMap.get('next'),
      );
      // The browser is leaving for LinkedIn; the button stays busy.
    } catch (e) {
      this.liError.set((e as Error).message);
      this.liBusy.set(false);
    }
  }

  async submit() {
    if (this.busy()) return;
    this.tried.set(true);
    if (this.form.invalid) {
      focusFirstInvalid(this.host.nativeElement);
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const { email, password } = this.form.getRawValue();
      await this.auth.signIn(email, password);
      const next = this.route.snapshot.queryParamMap.get('next') || '/today';
      await this.router.navigateByUrl(next);
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }
}
