import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DomSanitizer } from '@angular/platform-browser';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  isLinkedInUrl,
  jobLinkToKeep,
  isUpworkUrl,
  LINKEDIN_PASTE_MESSAGE,
  LINKEDIN_TEXT_MIN,
} from '@jobbotix/shared-types';
import { RolesRepo } from '../../core/data/repos';
import { Toast } from '../../shared/toast';
import { acceptPosting, bookmarklet, readShared } from '../../shared/capture';
import {
  BackLink,
  Button,
  Field,
  FieldControl,
  Icon,
  PageHeader,
} from '../../ui';
import { environment } from '../../../environments/environment';

const URL_PATTERN = /^https?:\/\/\S+$/i;

/** Add a posting the daily run did not find. */
@Component({
  selector: 'jb-add-role',
  imports: [
    BackLink,
    Button,
    Field,
    FieldControl,
    Icon,
    PageHeader,
    ReactiveFormsModule,
    RouterLink,
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
        title="Add a job"
        lead="Paste the link to the job post. Jobbotix reads the page, fills in company, title, skills and pay, and gives it a match score from your job preferences. You can fix anything on the job's page afterwards."
      />

      <form
        [formGroup]="form"
        (ngSubmit)="submit()"
        class="jb-card mt-6 flex flex-col gap-5 p-5 md:mt-8 md:p-7"
        novalidate
      >
        <jb-field label="Link to the job post" [error]="urlError()">
          <input
            jbInput
            id="add-url"
            type="url"
            inputmode="url"
            formControlName="url"
            placeholder="https://company.com/careers/job-title"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            (blur)="urlTouched.set(true)"
          />
        </jb-field>
        @if (linkedIn()) {
          <p
            id="add-linkedin"
            class="flex items-start gap-2.5 rounded-control bg-sunken px-3.5 py-3 text-sm text-ink"
            role="status"
          >
            <jb-icon name="info" [size]="18" class="mt-px shrink-0" />
            <span>
              This link is on LinkedIn. Jobbotix does not open LinkedIn pages,
              because LinkedIn does not allow it. Open the job on LinkedIn,
              select the text of the post, copy it and paste it below. The link
              stays on the job.
              @if (oldButton()) {
                <span id="add-old-button" class="mt-1.5 block text-ink-muted">
                  Your "Add to Jobbotix" bookmark is an older version. Drag the
                  button at the bottom of this page to your bookmarks bar and
                  delete the old one.
                </span>
              }
            </span>
          </p>
        }
        <jb-field
          label="Text of the job post"
          [optional]="!demo && !linkedIn()"
          [hint]="
            demo
              ? 'Demo mode cannot fetch pages, so paste the job post here (80 characters or more).'
              : linkedIn()
                ? 'Needed for a LinkedIn link: paste the whole post (80 characters or more).'
                : 'Paste it if Jobbotix cannot read the page: select everything on the job post, copy, paste.'
          "
        >
          <textarea
            jbInput
            [autogrow]="true"
            id="add-text"
            rows="6"
            formControlName="text"
            class="max-h-[60dvh]"
            placeholder="The full text of the job post"
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
        @if (waiting()) {
          <p
            class="flex items-center gap-2.5 text-sm text-ink-muted"
            role="status"
          >
            <jb-icon
              name="loader-circle"
              [size]="18"
              class="animate-spin text-brand"
            />
            Receiving the page from your other tab…
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
            Reading the job post and working out its match score. This can take
            up to 30 seconds.
          </p>
        }

        <div
          class="flex flex-col-reverse gap-3 border-t border-line pt-5 md:flex-row md:items-center md:justify-between"
        >
          <p class="text-xs text-ink-muted">
            Scored the same way as the jobs the daily search finds.
          </p>
          <button
            type="submit"
            jbButton="primary"
            size="lg"
            [busy]="busy()"
            [disabled]="form.invalid || busy()"
          >
            <jb-icon name="plus" /> Add job
          </button>
        </div>
      </form>

      @if (upworkGigs) {
        <section
          class="jb-card mt-6 flex flex-col gap-3 p-5 text-sm md:flex-row md:items-center md:justify-between md:p-7"
          aria-labelledby="upwork-h"
        >
          <div class="min-w-0">
            <h2 id="upwork-h" class="font-semibold text-ink">
              Found it on Upwork?
            </h2>
            <p class="mt-1 text-ink-muted">
              Freelance jobs from Upwork are added a little differently: you
              paste the job post, and Jobbotix helps you write the proposal.
            </p>
          </div>
          <a jbButton class="shrink-0" routerLink="/jobs/upwork">
            Add from Upwork
          </a>
        </section>
      }

      <section
        class="jb-card mt-6 p-5 text-sm md:p-7"
        aria-labelledby="anywhere-h"
      >
        <h2 id="anywhere-h" class="font-semibold text-ink">
          Add from anywhere
        </h2>
        <div class="mt-3 grid gap-5 md:grid-cols-2">
          <div>
            <h3 class="font-medium text-ink">On a computer</h3>
            <p class="mt-1 text-ink-muted">
              Drag this button to your bookmarks bar. On any job post, click it:
              the page's link and text come here and the job is added. On
              LinkedIn and Upwork it brings the link only, and you paste the
              text of the post yourself, because those sites do not allow a tool
              to read their pages.
            </p>
            <a
              class="mt-3 inline-flex items-center gap-2 rounded-control border border-line bg-sunken px-3 py-2 font-medium text-ink no-underline"
              [href]="bookmarklet"
              (click)="
                $event.preventDefault();
                toast.show('Drag it to your bookmarks bar')
              "
              title="Drag to your bookmarks bar"
              ><jb-icon name="bookmark" [size]="16" /> Add to Jobbotix</a
            >
          </div>
          <div>
            <h3 class="font-medium text-ink">On a phone</h3>
            <p class="mt-1 text-ink-muted">
              Install Jobbotix from your browser menu (Add to Home screen). Then
              tap Share on any job post and pick Jobbotix: the job is added in
              one step. Share-to-app works on Android; on iPhone, copy the link
              and paste it here.
            </p>
          </div>
        </div>
      </section>
    </div>
  `,
})
export class AddRole {
  private readonly repo = inject(RolesRepo);
  private readonly router = inject(Router);
  protected readonly toast = inject(Toast);
  readonly demo = environment.demo;
  readonly upworkGigs = environment.upworkGigs;
  readonly waiting = signal(false);
  readonly bookmarklet = inject(DomSanitizer).bypassSecurityTrustUrl(
    bookmarklet(typeof location === 'undefined' ? '' : location.origin),
  );

  /** The link in the box is on LinkedIn: the post's text has to be pasted. */
  readonly linkedIn = signal(false);
  /** A bookmark saved before LinkedIn was handled apart was used on LinkedIn. */
  readonly oldButton = signal(false);

  constructor() {
    this.form.controls.url.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((url) => this.linkedIn.set(isLinkedInUrl(url)));
    const q = inject(ActivatedRoute).snapshot.queryParamMap;
    // A bookmarklet saved before LinkedIn was handled apart still offers the
    // page's text. It is never listened for: LinkedIn pages are never read.
    // The user is asked to swap the bookmark for the current one.
    const viaButton = q.get('via') === 'bookmarklet';
    const onLinkedIn = isLinkedInUrl(q.get('url') ?? '');
    this.oldButton.set(viaButton && onLinkedIn);
    if (viaButton && !onLinkedIn) {
      this.form.controls.url.setValue(q.get('url') ?? '');
      this.receiveFromOpener();
      return;
    }
    const shared = readShared({
      url: q.get('url'),
      text: q.get('text'),
      title: q.get('title'),
    });
    if (!shared.url) return;
    this.form.setValue({ url: shared.url, text: shared.text });
    // A LinkedIn link without the post's text waits for the user to paste it.
    if (this.needsLinkedInText(shared.url, shared.text)) return;
    // shared from the phone: add it straight away
    if (this.form.valid) queueMicrotask(() => void this.submit());
  }

  /** A LinkedIn link whose post has not been pasted in yet. */
  private needsLinkedInText(url: string, text: string): boolean {
    return isLinkedInUrl(url.trim()) && text.trim().length < LINKEDIN_TEXT_MIN;
  }

  /** Waits up to 5 seconds for the bookmarklet's page text, then adds the role. */
  private receiveFromOpener() {
    const opener = typeof window === 'undefined' ? null : window.opener;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      this.waiting.set(false);
      window.removeEventListener('message', onMessage);
      if (this.form.valid) void this.submit();
    };
    const onMessage = (e: MessageEvent) => {
      if (opener && e.source !== opener) return;
      const m = acceptPosting(e.data, e.origin);
      if (!m) return;
      // A bookmarklet saved before Upwork was handled apart still sends the
      // page's text. It is dropped unread: Upwork pages are never read.
      if (isUpworkUrl(m.url)) {
        done = true;
        this.waiting.set(false);
        window.removeEventListener('message', onMessage);
        this.form.setValue({ url: m.url, text: '' });
        void this.submit();
        return;
      }
      // The same for LinkedIn (a page that moved there after the click): the
      // text is dropped unread and the user is asked to paste the post.
      if (isLinkedInUrl(m.url)) {
        done = true;
        this.waiting.set(false);
        window.removeEventListener('message', onMessage);
        this.form.setValue({ url: m.url, text: '' });
        return;
      }
      const body = m.text.trim();
      this.form.setValue({
        url: m.url,
        // the tab title usually carries the job title and company
        text:
          body.length >= 200
            ? `${m.title.trim() ? `${m.title.trim()}\n\n` : ''}${body}`
            : '',
      });
      finish();
    };
    if (!opener) return;
    this.waiting.set(true);
    window.addEventListener('message', onMessage);
    const timer = setTimeout(finish, 5000);
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(timer);
      done = true;
      window.removeEventListener('message', onMessage);
    });
  }
  readonly busy = signal(false);
  readonly error = signal('');
  readonly urlTouched = signal(false);

  urlError(): string | null {
    const c = this.form.controls.url;
    if (!this.urlTouched() || c.valid) return null;
    return c.value
      ? 'Use the full link, starting with https://'
      : 'Paste the link to the job post';
  }

  readonly form = new FormGroup({
    url: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(URL_PATTERN)],
    }),
    text: new FormControl('', {
      nonNullable: true,
      validators: environment.demo
        ? [Validators.required, Validators.minLength(80)]
        : [],
    }),
  });

  async submit() {
    if (this.form.invalid || this.busy()) return;
    // LinkedIn pages are never opened, so a LinkedIn link goes nowhere until
    // the post's text is pasted in. Nothing is sent before that.
    {
      const { url, text } = this.form.getRawValue();
      if (this.needsLinkedInText(url, text)) {
        this.error.set(LINKEDIN_PASTE_MESSAGE);
        if (typeof document !== 'undefined')
          document.getElementById('add-text')?.focus();
        return;
      }
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const { url, text } = this.form.getRawValue();
      // Upwork jobs never go through the page reader: Jobbotix must not open
      // an Upwork page. They are added from text the user pastes.
      if (isUpworkUrl(url.trim())) {
        if (this.upworkGigs) {
          await this.router.navigate(['/jobs/upwork'], {
            queryParams: { url: url.trim() },
          });
          return;
        }
        throw new Error(
          'Jobbotix does not read pages on Upwork, because Upwork does not allow it. Adding jobs from Upwork is coming soon.',
        );
      }
      // A LinkedIn job is kept under its own short link, whichever of
      // LinkedIn's long addresses it was copied from.
      const result = await this.repo.addFromUrl(
        jobLinkToKeep(url),
        text.trim(),
      );
      if (result.existed) this.toast.show('Already in your jobs');
      else this.toast.success('Job added');
      await this.router.navigate(['/jobs', result.id]);
    } catch (e) {
      this.error.set((e as Error).message || 'Could not add the job');
    } finally {
      this.busy.set(false);
    }
  }
}
