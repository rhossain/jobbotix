import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  GIG_TEXT_MIN,
  upworkJobUrl,
  upworkSearchUrl,
  type GigDraft,
} from '@jobbotix/shared-types';
import { environment } from '../../../environments/environment';
import { RolesRepo, SearchProfileRepo } from '../../core/data/repos';
import { Toast } from '../../shared/toast';
import {
  BackLink,
  Button,
  Field,
  FieldControl,
  Icon,
  PageHeader,
} from '../../ui';

const amount = (v: string): number | null => {
  const n = Number(v.replace(/[$,\s]/g, ''));
  return v.trim() && Number.isFinite(n) && n > 0 ? n : null;
};
const lines = (v: string, split: RegExp) =>
  v
    .split(split)
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * Add a freelance job found on Upwork. Jobbotix does not read Upwork: the
 * user searches there in their own browser, copies the job post and pastes it
 * here; Jobbotix reads the pasted text, the user checks the fields, and the
 * gig joins their jobs.
 */
@Component({
  selector: 'jb-add-gig',
  imports: [
    BackLink,
    Button,
    Field,
    FieldControl,
    Icon,
    PageHeader,
    ReactiveFormsModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-2xl">
      <jb-back-link
        class="mb-4 hidden md:inline-block"
        link="/jobs"
        label="Jobs"
      />
      <jb-page-header
        title="Add a job from Upwork"
        lead="Upwork does not let apps read its jobs for you, so Jobbotix never does. You find the job on Upwork, copy it and paste it here. Jobbotix keeps track of it and helps you write the proposal. You always send the proposal on Upwork yourself."
      />

      @if (!enabled) {
        <section class="jb-card mt-6 p-5 text-sm md:mt-8 md:p-7" role="status">
          <h2 class="font-semibold text-ink">Coming soon</h2>
          <p class="mt-1 text-ink-muted">
            Adding jobs from Upwork is being switched on. Please check back in a
            little while.
          </p>
        </section>
      } @else if (!draft()) {
        <section
          class="jb-card mt-6 flex flex-col gap-4 p-5 md:mt-8 md:p-7"
          aria-labelledby="gig-find-h"
        >
          <h2 id="gig-find-h" class="font-semibold text-ink">
            1. Find a job on Upwork
          </h2>
          <jb-field
            label="What to search for"
            hint="A job title works best, such as “Angular developer”. Upwork opens in a new tab with the newest jobs first."
          >
            <input
              jbInput
              id="gig-search"
              type="text"
              autocomplete="off"
              [value]="searchWords()"
              (input)="searchWords.set($any($event.target).value)"
            />
          </jb-field>
          <div>
            <a
              jbButton
              [href]="searchLink()"
              target="_blank"
              rel="noopener noreferrer"
            >
              <jb-icon name="search" /> Search on Upwork
              <jb-icon name="arrow-up-right" [size]="16" />
            </a>
          </div>
        </section>

        <form
          [formGroup]="paste"
          (ngSubmit)="read()"
          class="jb-card mt-6 flex flex-col gap-5 p-5 md:p-7"
          aria-labelledby="gig-paste-h"
          novalidate
        >
          <h2 id="gig-paste-h" class="font-semibold text-ink">
            2. Paste the job here
          </h2>
          <jb-field
            label="Link to the job on Upwork"
            [error]="linkError()"
            hint="Open the job on Upwork and copy the address from the top of your browser."
          >
            <input
              jbInput
              id="gig-url"
              type="url"
              inputmode="url"
              formControlName="url"
              placeholder="https://www.upwork.com/jobs/~01…"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              (blur)="linkTouched.set(true)"
            />
          </jb-field>
          <jb-field
            label="Text of the job post"
            [error]="textError()"
            hint="On the Upwork job page, select everything (Ctrl+A, or ⌘A on a Mac), copy, then paste here."
          >
            <textarea
              jbInput
              [autogrow]="true"
              id="gig-text"
              rows="6"
              formControlName="text"
              class="max-h-[60dvh]"
              placeholder="The full text of the job post"
              (blur)="textTouched.set(true)"
            ></textarea>
          </jb-field>

          @if (error()) {
            <p
              class="flex items-start gap-2.5 rounded-control bg-bad-tint px-3.5 py-3 text-sm text-bad"
              role="alert"
            >
              <jb-icon name="circle-x" [size]="18" class="mt-px" />
              {{ error() }}
            </p>
          }
          @if (busy()) {
            <p
              class="flex items-center gap-2.5 text-sm text-ink-muted"
              role="status"
            >
              <jb-icon
                name="loader-circle"
                [size]="18"
                class="animate-spin text-brand"
              />
              Reading the text you pasted. This can take up to 30 seconds.
            </p>
          }

          <div
            class="flex flex-col-reverse gap-3 border-t border-line pt-5 md:flex-row md:items-center md:justify-between"
          >
            <p class="text-xs text-ink-muted">
              Nothing is saved yet. You check the details next.
            </p>
            <button
              type="submit"
              jbButton="primary"
              size="lg"
              [busy]="busy()"
              [disabled]="busy()"
            >
              Read the job post
            </button>
          </div>
        </form>
      } @else {
        <form
          [formGroup]="review"
          (ngSubmit)="save()"
          class="jb-card mt-6 flex flex-col gap-5 p-5 md:mt-8 md:p-7"
          aria-labelledby="gig-check-h"
          novalidate
        >
          <div>
            <h2 id="gig-check-h" class="font-semibold text-ink">
              3. Check the details
            </h2>
            <p class="mt-1 text-sm text-ink-muted">
              {{
                method() === 'ai'
                  ? 'Read from the text you pasted. Fix anything that is wrong, then save.'
                  : 'Jobbotix filled in what it could find in the text you pasted. Fill in the rest, then save.'
              }}
            </p>
          </div>

          <jb-field label="Job title" [error]="titleError()">
            <input jbInput id="gig-title" type="text" formControlName="title" />
          </jb-field>

          <div class="grid gap-5 md:grid-cols-3">
            <jb-field label="How it pays">
              <select jbInput id="gig-budget-type" formControlName="budgetType">
                <option value="">Not stated</option>
                <option value="hourly">By the hour</option>
                <option value="fixed">Fixed price</option>
              </select>
            </jb-field>
            @if (review.controls.budgetType.value === 'fixed') {
              <jb-field label="Budget, US dollars" class="md:col-span-2">
                <input
                  jbInput
                  id="gig-budget"
                  type="text"
                  inputmode="decimal"
                  formControlName="budget"
                  placeholder="1200"
                />
              </jb-field>
            } @else {
              <jb-field label="From, dollars an hour">
                <input
                  jbInput
                  id="gig-rate-min"
                  type="text"
                  inputmode="decimal"
                  formControlName="rateMin"
                  placeholder="25"
                />
              </jb-field>
              <jb-field label="To, dollars an hour">
                <input
                  jbInput
                  id="gig-rate-max"
                  type="text"
                  inputmode="decimal"
                  formControlName="rateMax"
                  placeholder="40"
                />
              </jb-field>
            }
          </div>

          <div class="grid gap-5 md:grid-cols-3">
            <jb-field
              label="Connects to apply"
              [optional]="true"
              hint="What Upwork charges you to send a proposal."
            >
              <input
                jbInput
                id="gig-connects"
                type="text"
                inputmode="numeric"
                formControlName="connects"
              />
            </jb-field>
            <jb-field label="Experience level" [optional]="true">
              <select jbInput id="gig-level" formControlName="experienceLevel">
                <option value="">Not stated</option>
                <option value="entry">Entry level</option>
                <option value="intermediate">Intermediate</option>
                <option value="expert">Expert</option>
              </select>
            </jb-field>
            <jb-field label="Project length" [optional]="true">
              <input
                jbInput
                id="gig-duration"
                type="text"
                formControlName="duration"
                placeholder="1 to 3 months"
              />
            </jb-field>
          </div>

          <div class="grid gap-5 md:grid-cols-2">
            <jb-field label="Client's country" [optional]="true">
              <input
                jbInput
                id="gig-country"
                type="text"
                formControlName="clientCountry"
              />
            </jb-field>
            <jb-field
              label="Client's payment verified"
              hint="A verified client has a working payment method on Upwork."
            >
              <select
                jbInput
                id="gig-verified"
                formControlName="paymentVerified"
              >
                <option value="">Not stated</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </jb-field>
          </div>

          <jb-field
            label="Skills"
            [optional]="true"
            hint="Separate with commas."
          >
            <input
              jbInput
              id="gig-skills"
              type="text"
              formControlName="skills"
            />
          </jb-field>
          <jb-field
            label="Questions the client asks"
            [optional]="true"
            hint="One question on each line. Jobbotix helps you answer them on the job's page."
          >
            <textarea
              jbInput
              [autogrow]="true"
              id="gig-questions"
              rows="2"
              formControlName="questions"
            ></textarea>
          </jb-field>

          @if (error()) {
            <p
              class="flex items-start gap-2.5 rounded-control bg-bad-tint px-3.5 py-3 text-sm text-bad"
              role="alert"
            >
              <jb-icon name="circle-x" [size]="18" class="mt-px" />
              {{ error() }}
            </p>
          }

          <div
            class="flex flex-col-reverse gap-3 border-t border-line pt-5 md:flex-row md:items-center md:justify-between"
          >
            <button
              type="button"
              jbButton="ghost"
              [disabled]="busy()"
              (click)="back()"
            >
              Back
            </button>
            <button
              type="submit"
              jbButton="primary"
              size="lg"
              [busy]="busy()"
              [disabled]="busy()"
            >
              <jb-icon name="plus" /> Save to my jobs
            </button>
          </div>
        </form>
      }
    </div>
  `,
})
export class AddGig {
  private readonly repo = inject(RolesRepo);
  private readonly profiles = inject(SearchProfileRepo);
  private readonly router = inject(Router);
  private readonly toast = inject(Toast);

  /** Off on the live site until the database and the function are deployed. */
  protected readonly enabled = environment.upworkGigs;

  /** The words sent to Upwork's search; starts as the user's first job title. */
  readonly searchWords = signal('');
  private searchEdited = false;
  readonly searchLink = computed(() => upworkSearchUrl(this.searchWords()));

  readonly draft = signal<GigDraft | null>(null);
  readonly method = signal<'ai' | 'heuristic'>('heuristic');
  readonly busy = signal(false);
  readonly error = signal('');
  readonly linkTouched = signal(false);
  readonly textTouched = signal(false);
  readonly titleTouched = signal(false);

  readonly paste = new FormGroup({
    url: new FormControl('', { nonNullable: true }),
    text: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(GIG_TEXT_MIN)],
    }),
  });

  readonly review = new FormGroup({
    title: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(4)],
    }),
    budgetType: new FormControl<'' | 'hourly' | 'fixed'>('', {
      nonNullable: true,
    }),
    rateMin: new FormControl('', { nonNullable: true }),
    rateMax: new FormControl('', { nonNullable: true }),
    budget: new FormControl('', { nonNullable: true }),
    connects: new FormControl('', { nonNullable: true }),
    experienceLevel: new FormControl<'' | 'entry' | 'intermediate' | 'expert'>(
      '',
      { nonNullable: true },
    ),
    duration: new FormControl('', { nonNullable: true }),
    clientCountry: new FormControl('', { nonNullable: true }),
    paymentVerified: new FormControl<'' | 'yes' | 'no'>('', {
      nonNullable: true,
    }),
    skills: new FormControl('', { nonNullable: true }),
    questions: new FormControl('', { nonNullable: true }),
  });

  constructor() {
    const url = inject(ActivatedRoute).snapshot.queryParamMap.get('url');
    if (url) this.paste.controls.url.setValue(url);
    if (!this.profiles.loaded()) void this.profiles.load();
    // Offer the user's own first job title as the search, until they type one.
    effect(() => {
      const p = this.profiles.profile();
      const first = p?.target_roles[0] ?? p?.stacks.slice(0, 2).join(' ') ?? '';
      untracked(() => {
        if (!this.searchEdited && !this.searchWords() && first)
          this.searchWords.set(first);
      });
    });
    effect(() => {
      if (this.searchWords()) this.searchEdited = true;
    });
  }

  linkError(): string | null {
    const v = this.paste.controls.url.value.trim();
    if (!this.linkTouched() || upworkJobUrl(v)) return null;
    return v
      ? 'This is not the link of a job on Upwork. Open the job itself and copy its address.'
      : 'Paste the link to the job on Upwork';
  }

  textError(): string | null {
    const c = this.paste.controls.text;
    if (!this.textTouched() || c.valid) return null;
    return 'Paste the full text of the job post';
  }

  titleError(): string | null {
    return this.titleTouched() && this.review.controls.title.invalid
      ? 'Give the job a title'
      : null;
  }

  async read() {
    this.linkTouched.set(true);
    this.textTouched.set(true);
    const { url, text } = this.paste.getRawValue();
    if (this.busy() || !upworkJobUrl(url) || this.paste.invalid) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const result = await this.repo.readGig(url.trim(), text.trim());
      if ('id' in result) {
        this.toast.show('Already in your jobs');
        await this.router.navigate(['/jobs', result.id]);
        return;
      }
      const d = result.draft;
      this.review.setValue({
        title: d.title,
        budgetType: d.budgetType,
        rateMin: d.rateMin === null ? '' : String(d.rateMin),
        rateMax: d.rateMax === null ? '' : String(d.rateMax),
        budget: d.budget === null ? '' : String(d.budget),
        connects: d.connects === null ? '' : String(d.connects),
        experienceLevel: d.experienceLevel,
        duration: d.duration,
        clientCountry: d.clientCountry,
        paymentVerified:
          d.paymentVerified === null ? '' : d.paymentVerified ? 'yes' : 'no',
        skills: d.skills.join(', '),
        questions: d.questions.join('\n'),
      });
      this.titleTouched.set(false);
      this.method.set(result.method);
      this.draft.set(d);
    } catch (e) {
      this.error.set((e as Error).message || 'Could not read the job post');
    } finally {
      this.busy.set(false);
    }
  }

  back() {
    this.error.set('');
    this.draft.set(null);
  }

  async save() {
    this.titleTouched.set(true);
    const base = this.draft();
    if (!base || this.busy() || this.review.invalid) return;
    const v = this.review.getRawValue();
    const connects = Number(v.connects);
    const draft: GigDraft = {
      url: base.url,
      postingText: base.postingText,
      title: v.title.trim(),
      budgetType: v.budgetType,
      rateMin: v.budgetType === 'fixed' ? null : amount(v.rateMin),
      rateMax: v.budgetType === 'fixed' ? null : amount(v.rateMax),
      budget: v.budgetType === 'fixed' ? amount(v.budget) : null,
      connects:
        v.connects.trim() && Number.isInteger(connects) && connects >= 0
          ? connects
          : null,
      experienceLevel: v.experienceLevel,
      duration: v.duration.trim(),
      clientCountry: v.clientCountry.trim(),
      paymentVerified:
        v.paymentVerified === '' ? null : v.paymentVerified === 'yes',
      skills: lines(v.skills, /,/),
      questions: lines(v.questions, /\n/),
    };
    this.busy.set(true);
    this.error.set('');
    try {
      const result = await this.repo.saveGig(draft);
      if (result.existed) this.toast.show('Already in your jobs');
      else this.toast.success('Saved to your jobs');
      await this.router.navigate(['/jobs', result.id]);
    } catch (e) {
      this.error.set((e as Error).message || 'Could not save the job');
    } finally {
      this.busy.set(false);
    }
  }
}
