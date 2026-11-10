import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
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
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-2xl">
      <jb-back-link
        class="mb-4 hidden md:inline-block"
        link="/roles"
        label="Roles"
      />
      <jb-page-header
        title="Add a role"
        lead="Paste the posting's link. Jobbotix reads the page, fills in company, title, stack and pay, and scores it against your search profile. You can fix anything on the role's page afterwards."
      />

      <form
        [formGroup]="form"
        (ngSubmit)="submit()"
        class="jb-card mt-6 flex flex-col gap-5 p-5 md:mt-8 md:p-7"
        novalidate
      >
        <jb-field label="Posting URL" [error]="urlError()">
          <input
            jbInput
            id="add-url"
            type="url"
            inputmode="url"
            formControlName="url"
            placeholder="https://company.com/careers/senior-angular-engineer"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            (blur)="urlTouched.set(true)"
          />
        </jb-field>
        <jb-field
          label="Posting text"
          [optional]="!demo"
          [hint]="
            demo
              ? 'Demo mode cannot fetch pages, so paste the posting here (80 characters or more).'
              : 'Paste it if the page blocks automated reading: select all on the posting, copy, paste.'
          "
        >
          <textarea
            jbInput
            [autogrow]="true"
            id="add-text"
            rows="6"
            formControlName="text"
            class="max-h-[60dvh]"
            placeholder="The full posting text"
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
            Reading and scoring the posting. This can take up to 30 seconds.
          </p>
        }

        <div
          class="flex flex-col-reverse gap-3 border-t border-line pt-5 md:flex-row md:items-center md:justify-between"
        >
          <p class="text-xs text-ink-muted">
            Scored the same way as the roles the morning run finds.
          </p>
          <button
            type="submit"
            jbButton="primary"
            size="lg"
            [busy]="busy()"
            [disabled]="form.invalid || busy()"
          >
            <jb-icon name="plus" /> Add role
          </button>
        </div>
      </form>

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
              Drag this button to your bookmarks bar. On any posting, click it:
              the page's link and text come here and the role is added. It works
              on pages behind a sign-in, such as LinkedIn.
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
              tap Share on any posting and pick Jobbotix: the role is added in
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
  readonly waiting = signal(false);
  readonly bookmarklet = inject(DomSanitizer).bypassSecurityTrustUrl(
    bookmarklet(typeof location === 'undefined' ? '' : location.origin),
  );

  constructor() {
    const q = inject(ActivatedRoute).snapshot.queryParamMap;
    if (q.get('via') === 'bookmarklet') {
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
    // shared from the phone: add it straight away
    if (this.form.valid) queueMicrotask(() => void this.submit());
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
      : 'Paste the link to the posting';
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
    this.busy.set(true);
    this.error.set('');
    try {
      const { url, text } = this.form.getRawValue();
      const result = await this.repo.addFromUrl(url.trim(), text.trim());
      if (result.existed) this.toast.show('Already in your roles');
      else this.toast.success('Role added');
      await this.router.navigate(['/roles', result.id]);
    } catch (e) {
      this.error.set((e as Error).message || 'Could not add the role');
    } finally {
      this.busy.set(false);
    }
  }
}
