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
import { longDate } from '../../shared/format';
import { Button, Field, FieldControl, Icon, MatchRing } from '../../ui';

/** Public front page: the positioning in one screen, and a way to ask for an invite. */
@Component({
  selector: 'jb-landing',
  imports: [
    Button,
    Field,
    FieldControl,
    Icon,
    MatchRing,
    ReactiveFormsModule,
    RouterLink,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Hero -->
    <section
      class="grid items-center gap-10 pt-6 pb-12 md:pt-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-16 lg:pb-20"
    >
      <div>
        <h1
          class="text-[clamp(2.4rem,6.2vw,4rem)] leading-[1.02] font-semibold tracking-[-0.035em] text-ink"
        >
          It finds, scores and drafts your applications. You press send.
        </h1>
        <p class="mt-6 max-w-xl text-lg text-ink-muted">
          Every morning Jobbotix searches the remote job boards, scores each
          posting against what you actually want, and writes the cover letter
          and screening answers for the good ones. It never submits anything for
          you.
        </p>
        <div class="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          @if (open()) {
            <a jbButton="primary" size="lg" routerLink="/signup"
              >Create your account</a
            >
          } @else {
            <a jbButton="primary" size="lg" href="#invite">Request an invite</a>
          }
          <a jbButton size="lg" routerLink="/login">Sign in</a>
        </div>
      </div>

      <!-- The morning brief, as the product shows it -->
      <div
        class="jb-card relative overflow-hidden p-5 shadow-overlay md:p-6"
        aria-hidden="true"
      >
        <p class="text-sm font-medium text-brand-ink">{{ today }}</p>
        <p class="mt-1 text-xl font-semibold tracking-tight text-ink">
          Good morning
        </p>
        <p class="mt-1 text-sm text-ink-muted">
          Today's 06:45 run reviewed 47 listings and added 3 worth a look.
        </p>
        <ul class="mt-5 flex flex-col gap-2.5">
          @for (r of sample; track r.title) {
            <li
              class="flex items-center gap-3.5 rounded-control border border-line bg-surface p-3"
            >
              <jb-match-ring [score]="r.score" size="sm" />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-semibold text-ink">{{
                  r.title
                }}</span>
                <span class="block truncate text-xs text-ink-muted">{{
                  r.company
                }}</span>
              </span>
              @if (r.letter) {
                <span class="jb-tag jb-tag-ai hidden sm:inline-flex">
                  <jb-icon name="check" [size]="13" /> Letter
                </span>
              }
            </li>
          }
        </ul>
      </div>
    </section>

    <!-- How a morning goes -->
    <section
      class="border-t border-line py-12 lg:py-16"
      aria-labelledby="how-heading"
    >
      <h2
        id="how-heading"
        class="max-w-xl text-2xl font-semibold tracking-tight text-ink md:text-3xl"
      >
        Four steps, and only the last one is yours.
      </h2>
      <ol class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        @for (step of steps; track step.title; let i = $index) {
          <li class="jb-card p-5">
            <span
              class="grid size-9 place-items-center rounded-full bg-brand-tint text-sm font-semibold text-brand-ink"
              >{{ i + 1 }}</span
            >
            <h3 class="mt-4 font-semibold text-ink">{{ step.title }}</h3>
            <p class="mt-1.5 text-sm text-ink-muted">{{ step.body }}</p>
          </li>
        }
      </ol>
    </section>

    <!-- Join -->
    <section id="invite" class="border-t border-line py-12 lg:py-16">
      <div
        class="jb-card grid grid-cols-1 gap-8 p-6 md:p-8 lg:grid-cols-2 lg:items-center"
      >
        @if (open()) {
          <div>
            <h2 class="text-2xl font-semibold tracking-tight text-ink">
              Free to join
            </h2>
            <p class="mt-2 text-ink-muted">
              Sign-up is open. Create an account, paste your resume, and your
              first run can go tomorrow morning.
            </p>
          </div>
          <div class="lg:justify-self-end">
            <a jbButton="primary" size="lg" routerLink="/signup"
              >Create your account</a
            >
          </div>
        } @else {
          <div>
            <h2 class="text-2xl font-semibold tracking-tight text-ink">
              Invite-only for now
            </h2>
            <p class="mt-2 text-ink-muted">
              Jobbotix runs on free tiers while it is small. Leave your email
              and the kind of role you are after; invites go out in order.
            </p>
            <p class="mt-3 text-sm text-ink-muted">
              Have a code?
              <a
                routerLink="/signup"
                class="font-medium text-brand-ink underline"
                >Create your account</a
              >
            </p>
          </div>
          @if (sent()) {
            <p
              class="flex items-center gap-2 rounded-control bg-brand-tint px-4 py-3 text-brand-ink"
              role="status"
            >
              <jb-icon name="circle-check" /> Noted. You will hear from us when
              a spot opens.
            </p>
          } @else {
            <form
              [formGroup]="form"
              (ngSubmit)="request()"
              class="flex flex-col gap-4"
              novalidate
            >
              <jb-field label="Email">
                <input
                  jbInput
                  id="invite-email"
                  type="email"
                  formControlName="email"
                  autocomplete="email"
                />
              </jb-field>
              <jb-field
                label="What are you looking for?"
                hint="One line, e.g. Senior Angular, remote worldwide"
              >
                <input
                  jbInput
                  id="invite-note"
                  type="text"
                  formControlName="note"
                />
              </jb-field>
              @if (error()) {
                <p class="text-sm text-bad" role="alert">{{ error() }}</p>
              }
              <button
                type="submit"
                jbButton="primary"
                size="lg"
                [busy]="busy()"
                [disabled]="email.invalid || busy()"
              >
                Request an invite
              </button>
            </form>
          }
        }
      </div>
    </section>

    <footer
      class="flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-6 text-sm text-ink-muted"
    >
      <span>© {{ year }} Jobbotix</span>
      <a routerLink="/privacy" class="hover:text-ink">Privacy</a>
      <a routerLink="/login" class="hover:text-ink">Sign in</a>
      <a
        href="https://github.com/rhossain/jobbotix"
        target="_blank"
        rel="noopener"
        class="hover:text-ink"
        >Source on GitHub</a
      >
    </footer>
  `,
})
export class Landing {
  private readonly supabase = injectSupabase();
  private readonly auth = inject(Auth);
  readonly year = new Date().getFullYear();
  readonly today = longDate(new Date());
  /** The sample brief in the hero (fictional roles, as in demo mode). */
  readonly sample = [
    {
      score: 92,
      title: 'Senior Angular Engineer, AI Products',
      company: 'Quill & Co',
      letter: true,
    },
    {
      score: 88,
      title: 'Senior Frontend Engineer (Angular)',
      company: 'Northwind Analytics',
      letter: true,
    },
    {
      score: 74,
      title: 'Senior Frontend Developer (React)',
      company: 'Lumen Commerce',
      letter: false,
    },
  ];
  readonly steps = [
    {
      title: 'Searches at 06:45',
      body: 'Your scheduled run reads the remote boards and skips what you have ruled out.',
    },
    {
      title: 'Scores every posting',
      body: 'A 0–100 match against your profile, with the reasons it fits and what to watch.',
    },
    {
      title: 'Drafts the paperwork',
      body: 'A cover letter in your voice and screening answers for anything scoring 70 or more.',
    },
    {
      title: 'You press send',
      body: 'Read, tweak and apply yourself. Jobbotix never submits on your behalf.',
    },
  ];
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
