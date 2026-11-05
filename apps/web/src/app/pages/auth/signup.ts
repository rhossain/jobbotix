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
  selector: 'jb-signup',
  imports: [ReactiveFormsModule, RouterLink, AuthShell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <jb-auth-shell
      heading="Create your account"
      [lead]="
        open()
          ? 'Free while it is small. No card, no invite needed.'
          : 'Jobbotix is invite-only while the free tiers settle.'
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
          />
        </label>
        <label class="flex flex-col gap-1 text-sm">
          <span>Email</span>
          <input
            id="signup-email"
            type="email"
            formControlName="email"
            autocomplete="email"
            class="jb-input"
          />
        </label>
        <label class="flex flex-col gap-1 text-sm">
          <span
            >Password <span class="text-ink-muted">(8+ characters)</span></span
          >
          <input
            id="signup-password"
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
        @if (done()) {
          <p class="text-sm text-brand-ink" role="status">
            Account created. Check your inbox if a confirmation email is
            required, then sign in.
          </p>
        } @else {
          <button
            type="submit"
            class="jb-btn-primary jb-btn-lg mt-2 w-full"
            [disabled]="form.invalid || busy()"
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
  });

  constructor() {
    void this.auth.signupIsOpen().then((o) => this.open.set(o));
  }

  async submit() {
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const value = this.form.getRawValue();
      if (!this.open() && !value.inviteCode.trim()) {
        this.error.set('An invite code is required while sign-up is closed.');
        return;
      }
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
      if (this.auth.isSignedIn()) await this.router.navigateByUrl('/');
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }
}
