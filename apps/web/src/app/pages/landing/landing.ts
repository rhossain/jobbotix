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
import { injectSupabase } from '../../core/supabase';
import { environment } from '../../../environments/environment';

/** Public front page: the positioning in one screen, and a way to ask for an invite. */
@Component({
  selector: 'jb-landing',
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mx-auto max-w-3xl py-10">
      <p class="jb-section-title">Jobbotix</p>
      <h1
        class="mt-3 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl"
      >
        Finds, scores and drafts your job applications.<br />
        <span class="text-brand-600 dark:text-brand-50">You press send.</span>
      </h1>
      <p class="mt-5 max-w-2xl text-lg text-neutral-600 dark:text-neutral-300">
        Every morning Jobbotix searches the remote job boards, scores each
        posting against what you actually want, writes the cover letter and the
        screening answers for the good ones, and puts them in a short list. It
        never submits an application for you.
      </p>

      <div class="mt-8 grid gap-4 sm:grid-cols-3">
        <div class="jb-card p-4">
          <div
            class="font-mono text-2xl font-medium text-brand-600 dark:text-brand-50"
          >
            06:45
          </div>
          <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
            A run finishes before you wake. The digest lands in your inbox at
            the hour you choose.
          </p>
        </div>
        <div class="jb-card p-4">
          <div
            class="font-mono text-2xl font-medium text-brand-600 dark:text-brand-50"
          >
            0–100
          </div>
          <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
            Every role gets a score, the reasons it fits, and what to watch out
            for. You set the weights.
          </p>
        </div>
        <div class="jb-card p-4">
          <div
            class="font-mono text-2xl font-medium text-brand-600 dark:text-brand-50"
          >
            200 words
          </div>
          <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
            A cover letter in your voice for anything scoring 70 or more, with
            one honest gap named.
          </p>
        </div>
      </div>

      <div class="mt-10 jb-card overflow-hidden">
        <div
          class="border-b border-neutral-200 px-4 py-2 font-mono text-xs text-neutral-500 dark:border-neutral-800"
        >
          Today · last run today · 47 listings reviewed · 3 added · 21 excluded
        </div>
        <ul class="divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
          <li class="flex items-center gap-4 px-4 py-3">
            <span class="jb-score jb-score-high">92<small>MATCH</small></span
            ><span
              ><b>Senior Angular Engineer, AI Products</b><br /><span
                class="text-neutral-600 dark:text-neutral-300"
                >Quill &amp; Co · Remote, worldwide · $100k–140k</span
              ></span
            >
          </li>
          <li class="flex items-center gap-4 px-4 py-3">
            <span class="jb-score jb-score-high">88<small>MATCH</small></span
            ><span
              ><b>Senior Frontend Engineer (Angular)</b><br /><span
                class="text-neutral-600 dark:text-neutral-300"
                >Northwind Analytics · Remote, worldwide · $95k–130k</span
              ></span
            >
          </li>
          <li class="flex items-center gap-4 px-4 py-3">
            <span class="jb-score jb-score-mid">74<small>MATCH</small></span
            ><span
              ><b>Senior Frontend Developer (React)</b><br /><span
                class="text-neutral-600 dark:text-neutral-300"
                >Lumen Commerce · Remote, worldwide · $80k–110k</span
              ></span
            >
          </li>
        </ul>
      </div>

      @if (open()) {
        <section class="mt-10 max-w-xl" id="invite">
          <h2 class="text-xl font-semibold tracking-tight">Free to join</h2>
          <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
            Sign-up is open. Create an account, paste your resume, and your
            first run can go tomorrow morning.
          </p>
          <a routerLink="/signup" class="jb-btn-primary mt-4 inline-block"
            >Create your account</a
          >
        </section>
      } @else {
        <section class="mt-10 max-w-xl" id="invite">
          <h2 class="text-xl font-semibold tracking-tight">
            Invite-only for now
          </h2>
          <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
            Jobbotix runs on free tiers while it is small. Leave your email and
            the kind of role you are after; invites go out in order.
          </p>
          @if (sent()) {
            <p
              class="mt-4 text-sm text-brand-600 dark:text-brand-50"
              role="status"
            >
              Noted. You will hear from us when a spot opens.
            </p>
          } @else {
            <form
              [formGroup]="form"
              (ngSubmit)="request()"
              class="mt-4 flex flex-col gap-3"
              novalidate
            >
              <label class="flex flex-col gap-1 text-sm">
                <span>Email</span>
                <input
                  id="invite-email"
                  type="email"
                  formControlName="email"
                  class="jb-input"
                  autocomplete="email"
                />
              </label>
              <label class="flex flex-col gap-1 text-sm">
                <span
                  >What are you looking for?
                  <span class="text-neutral-500">(one line)</span></span
                >
                <input
                  id="invite-note"
                  type="text"
                  formControlName="note"
                  class="jb-input"
                  placeholder="Senior Angular, remote worldwide"
                />
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
                  [disabled]="email.invalid || busy()"
                >
                  Request an invite
                </button>
                <span class="text-sm text-neutral-500"
                  >Have a code?
                  <a routerLink="/signup" class="underline"
                    >Create your account</a
                  ></span
                >
              </div>
            </form>
          }
        </section>
      }

      <footer
        class="mt-14 flex flex-wrap gap-x-6 gap-y-2 text-xs text-neutral-500"
      >
        <span>© {{ year }} Jobbotix</span>
        <a routerLink="/privacy" class="underline">Privacy</a>
        <a routerLink="/login" class="underline">Sign in</a>
        <a
          href="https://github.com/rhossain/jobbotix"
          target="_blank"
          rel="noopener"
          class="underline"
          >Source on GitHub</a
        >
      </footer>
    </section>
  `,
})
export class Landing {
  private readonly supabase = injectSupabase();
  private readonly auth = inject(Auth);
  readonly year = new Date().getFullYear();
  readonly form = new FormGroup({
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
    note: new FormControl('', { nonNullable: true }),
  });
  readonly email = this.form.controls.email;
  readonly note = this.form.controls.note;
  readonly busy = signal(false);
  readonly sent = signal(false);
  readonly open = signal(false);

  constructor() {
    void this.auth.signupIsOpen().then((o) => this.open.set(o));
  }
  readonly error = signal('');

  async request() {
    if (this.email.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      if (!environment.demo) {
        const { error } = await this.supabase.rpc('request_invite', {
          p_email: this.email.getRawValue().trim(),
          p_note: this.note.getRawValue().trim().slice(0, 300),
        });
        if (error) throw error;
      }
      this.sent.set(true);
    } catch {
      this.error.set('Could not send that right now. Try again in a minute.');
    } finally {
      this.busy.set(false);
    }
  }
}
