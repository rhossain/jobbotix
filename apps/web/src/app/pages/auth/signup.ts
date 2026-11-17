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
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Auth } from '../../core/auth';
import { AuthShell } from './auth-shell';
import { EyeToggle } from './eye-toggle';
import { emailHelp, focusFirstInvalid } from './field-help';

@Component({
  selector: 'jb-signup',
  imports: [ReactiveFormsModule, RouterLink, AuthShell, EyeToggle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <jb-auth-shell
      heading="Create your account"
      [lead]="
        open()
          ? 'Free while it is small. No card, no invite needed.'
          : 'You need an invite code to join for now. It is in the invitation you were sent.'
      "
    >
      <form
        [formGroup]="form"
        (ngSubmit)="submit()"
        class="flex flex-col gap-4"
        novalidate
      >
        @if (!open()) {
          <label class="flex flex-col gap-1 text-sm">
            <span>Invite code</span>
            <input
              id="signup-invite"
              type="text"
              formControlName="inviteCode"
              autocomplete="off"
              class="jb-input font-mono uppercase"
            />
            @if (tried() && !form.controls.inviteCode.value.trim()) {
              <span class="text-bad"
                >Enter the invite code from your invitation.</span
              >
            }
          </label>
        }
        <label class="flex flex-col gap-1 text-sm">
          <span>Your name</span>
          <input
            id="signup-name"
            type="text"
            formControlName="name"
            autocomplete="name"
            class="jb-input"
            [attr.aria-invalid]="tried() && form.controls.name.invalid"
          />
          @if (tried() && form.controls.name.invalid) {
            <span class="text-bad">Enter your name.</span>
          }
        </label>
        <label class="flex flex-col gap-1 text-sm">
          <span>Email</span>
          <input
            id="signup-email"
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
          <span
            >Password <span class="text-ink-muted">(8+ characters)</span></span
          >
          <div class="relative">
            <input
              id="signup-password"
              [type]="show() ? 'text' : 'password'"
              formControlName="password"
              autocomplete="new-password"
              class="jb-input pr-11"
              [attr.aria-invalid]="tried() && form.controls.password.invalid"
            />
            <jb-eye-toggle [(shown)]="show" />
          </div>
          @if (tried() && form.controls.password.invalid) {
            <span class="text-bad"
              >Choose a password with at least 8 characters.</span
            >
          }
        </label>
        <label class="flex flex-col gap-1 text-sm">
          <span>Type the password again</span>
          <div class="relative">
            <input
              id="signup-confirm"
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
        @if (done()) {
          <p class="text-sm text-brand-ink" role="status">
            Account created. We sent an email to
            {{ form.controls.email.value }}. Open the link in it to confirm your
            address, then sign in.
          </p>
        } @else {
          <button
            type="submit"
            class="jb-btn-primary jb-btn-lg mt-2 w-full"
            [disabled]="busy()"
          >
            {{ busy() ? 'Creating…' : 'Create account' }}
          </button>
        }
      </form>
      <p footer>
        Already have an account?
        <a routerLink="/login" class="font-medium text-brand-ink underline"
          >Sign in</a
        >
      </p>
    </jb-auth-shell>
  `,
})
export class Signup {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly busy = signal(false);
  readonly done = signal(false);
  readonly error = signal('');
  /** True once Create account was pressed: boxes that need fixing then say so. */
  readonly tried = signal(false);
  readonly show = signal(false);
  protected readonly emailHelp = emailHelp;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  /** Set from the admin switch; while false an invite code is required. */
  readonly open = signal(false);
  readonly form = new FormGroup({
    inviteCode: new FormControl(
      this.route.snapshot.paramMap.get('code') ?? '',
      { nonNullable: true },
    ),
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
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

  constructor() {
    void this.auth.signupIsOpen().then((o) => this.open.set(o));
  }

  async submit() {
    if (this.busy()) return;
    this.tried.set(true);
    const needsCode =
      !this.open() && !this.form.controls.inviteCode.value.trim();
    if (this.form.invalid || needsCode) {
      if (needsCode)
        this.host.nativeElement
          .querySelector<HTMLElement>('#signup-invite')
          ?.focus();
      else focusFirstInvalid(this.host.nativeElement);
      return;
    }
    if (this.mismatch()) {
      this.host.nativeElement
        .querySelector<HTMLElement>('#signup-confirm')
        ?.focus();
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const value = this.form.getRawValue();
      if (
        value.inviteCode.trim() &&
        !(await this.auth.inviteCodeIsValid(value.inviteCode))
      ) {
        this.error.set(
          'That invite code is not valid. Check it with the person who gave it to you.',
        );
        return;
      }
      await this.auth.signUp(value);
      this.done.set(true);
      if (this.auth.isSignedIn()) await this.router.navigateByUrl('/today');
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }
}
