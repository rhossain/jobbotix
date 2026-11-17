import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  AccountDataRepo,
  LINKEDIN_EXPORT_SOURCE,
  LinkedInRepo,
  RolesRepo,
  type ImportRoleInput,
} from '../../core/data/repos';
import {
  openLinkedInArchive,
  type PickedFile,
} from '../../shared/linkedin-archive';
import {
  linkedInJobId,
  readLinkedInExport,
  type LinkedInExport,
  type LinkedInJob,
} from '../../shared/linkedin-export';
import { Toast } from '../../shared/toast';
import { Button, Confirm, Icon } from '../../ui';

/** Jobs listed one by one in the preview; the rest are counted. */
const SHOWN = 200;

const FILE_LABELS: Record<string, string> = {
  savedJobs: 'jobs you saved',
  applications: 'jobs you applied to',
  connections: 'connections',
  profile: 'profile',
  positions: 'work history',
  education: 'education',
  skills: 'skills',
  certifications: 'certifications',
  emails: 'your email address',
};

const pairOf = (company: string, title: string) =>
  `${company}|${title}`.toLowerCase();

/** Midday UTC on the day, so no time zone moves it to the day before. */
const at = (day: string | null) => (day ? `${day}T12:00:00.000Z` : undefined);

/**
 * Settings → Your data → Import from LinkedIn. The user downloads their own
 * archive from LinkedIn ("Get a copy of your data") and picks it here. It is
 * read in the browser: saved jobs and applications go to the pipeline, and
 * connections are kept so a job can show who the user knows there. Jobbotix
 * never signs in to LinkedIn and never opens one of its pages.
 */
@Component({
  selector: 'jb-linkedin-import',
  imports: [Button, Icon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    <section
      class="jb-card flex flex-col gap-3 p-5 md:p-6"
      aria-labelledby="li-import-h"
    >
      <h2 id="li-import-h" class="jb-section-title">Import from LinkedIn</h2>
      <p class="text-sm text-ink-muted">
        Bring in the jobs you saved and applied to on LinkedIn, and see who you
        know at each company. You download your own data from LinkedIn and pick
        the file here. Jobbotix never signs in to LinkedIn or opens its pages,
        and the file is read in your browser, not uploaded.
      </p>
      <ol class="flex list-decimal flex-col gap-1 pl-5 text-sm text-ink-muted">
        <li>
          On LinkedIn, open Settings &amp; Privacy, then Data privacy, and
          choose "Get a copy of your data".
        </li>
        <li>
          Pick the larger data archive and request it. LinkedIn emails you when
          it is ready, usually within a day.
        </li>
        <li>Download the ZIP file from that email and choose it below.</li>
      </ol>
      <label class="w-fit">
        <span class="jb-btn cursor-pointer"
          ><jb-icon name="upload" /> Choose the LinkedIn file</span
        >
        <input
          id="li-file"
          type="file"
          accept=".zip,application/zip,.csv,text/csv"
          multiple
          class="sr-only"
          (change)="pick($any($event.target))"
        />
      </label>
      @if (reading()) {
        <p
          class="flex items-center gap-2.5 text-sm text-ink-muted"
          role="status"
        >
          <jb-icon
            name="loader-circle"
            [size]="18"
            class="animate-spin text-brand"
          />
          Reading the file in your browser…
        </p>
      }
      @if (problem()) {
        <p
          id="li-problem"
          class="flex items-start gap-2.5 rounded-control bg-bad-tint px-3.5 py-3 text-sm text-bad"
          role="alert"
        >
          <jb-icon name="circle-x" [size]="18" class="mt-px shrink-0" />
          {{ problem() }}
        </p>
      }

      @if (preview(); as p) {
        <div
          id="li-preview"
          class="flex flex-col gap-4 rounded-control border border-line p-4 text-sm"
        >
          <div>
            <p class="font-medium text-ink">
              {{ fresh().length }}
              {{ fresh().length === 1 ? 'job' : 'jobs' }} to add
              @if (p.jobs.length - fresh().length; as n) {
                <span class="font-normal text-ink-muted">
                  · {{ n }} already in your jobs</span
                >
              }
            </p>
            @if (fresh().length) {
              <p class="mt-1 text-ink-muted">
                Jobs you applied to arrive as Applied, jobs you saved as
                Shortlist. Each keeps its link to LinkedIn. They have no post
                text yet, so they are scored once you paste it on the job's
                page. Untick any you do not want.
              </p>
              <ul class="mt-3 flex max-h-72 flex-col gap-1 overflow-auto">
                @for (j of fresh().slice(0, shown); track j.url) {
                  <li>
                    <label class="flex items-start gap-2.5">
                      <input
                        type="checkbox"
                        class="mt-1"
                        [checked]="!unticked().has(j.url)"
                        (change)="tick(j.url, $any($event.target).checked)"
                      />
                      <span class="min-w-0">
                        {{ j.title }}
                        <span class="text-ink-muted"
                          >at {{ j.company }} ·
                          {{ j.status === 'applied' ? 'Applied' : 'Saved'
                          }}{{ j.date ? ' ' + j.date : '' }}</span
                        >
                      </span>
                    </label>
                  </li>
                }
                @if (fresh().length > shown) {
                  <li class="text-ink-muted">
                    and {{ fresh().length - shown }} more, all included
                  </li>
                }
              </ul>
            }
          </div>

          @if (p.connections.length) {
            <div>
              <label class="flex items-start gap-2.5 font-medium text-ink">
                <input
                  id="li-keep"
                  type="checkbox"
                  class="mt-1"
                  [checked]="keep()"
                  (change)="keep.set($any($event.target).checked)"
                />
                <span>
                  Keep my {{ p.connections.length }}
                  {{
                    p.connections.length === 1 ? 'connection' : 'connections'
                  }}
                  so I can see who I know at a company
                </span>
              </label>
              <p class="mt-1 text-ink-muted">
                These are other people's details. Jobbotix keeps each person's
                name, company, job title, profile link and the day you
                connected, and never an email address or a phone number. Only
                you can see them, they are never shared, and you can delete them
                here at any time. A new import takes the place of the old list.
              </p>
            </div>
          }

          @if (p.resume) {
            <p id="li-resume" class="text-ink-muted">
              Your profile and work history are in this file too. To fill your
              resume from them, open
              <a routerLink="/resume" class="text-brand-ink underline">Resume</a
              >, choose Import and pick this same file.
            </p>
          }

          <details class="text-ink-muted">
            <summary class="cursor-pointer">What was read</summary>
            <ul class="mt-1 flex flex-col gap-0.5">
              @for (f of p.files; track f.name) {
                <li>
                  {{ f.name }} ({{ labels[f.kind] }}):
                  @if (f.problem) {
                    {{ f.problem }}
                  } @else {
                    {{ f.rows }} taken{{
                      f.skippedCount ? ', ' + f.skippedCount + ' left out' : ''
                    }}
                    @if (f.skipped.length) {
                      <ul class="ml-4 list-disc">
                        @for (s of f.skipped.slice(0, 10); track $index) {
                          <li>
                            {{ s.row ? 'Row ' + s.row + ': ' : ''
                            }}{{ s.reason }}
                          </li>
                        }
                      </ul>
                    }
                  }
                </li>
              }
              @if (p.ignored) {
                <li>
                  {{ p.ignored }} other
                  {{ p.ignored === 1 ? 'file was' : 'files were' }} in the
                  archive and left unopened.
                </li>
              }
            </ul>
          </details>

          <div class="flex gap-2">
            <button
              id="li-run"
              type="button"
              jbButton="primary"
              [busy]="importing()"
              [disabled]="importing() || !something()"
              (click)="run()"
            >
              Import
            </button>
            <button type="button" jbButton="ghost" (click)="cancel()">
              Cancel
            </button>
          </div>
        </div>
      }

      @if (linkedin.total(); as n) {
        <div
          id="li-kept"
          class="mt-1 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-sm"
        >
          <p class="text-ink-muted">
            {{ n }} LinkedIn {{ n === 1 ? 'connection is' : 'connections are' }}
            kept in your account. Jobs that came from LinkedIn are ordinary jobs
            now; remove them on the Jobs page.
          </p>
          <button
            type="button"
            jbButton="danger"
            [busy]="deleting()"
            [disabled]="deleting()"
            (click)="deleteConnections()"
          >
            <jb-icon name="trash" /> Delete my LinkedIn connections
          </button>
        </div>
      }
    </section>
  `,
})
export class LinkedInImport {
  private readonly data = inject(AccountDataRepo);
  private readonly roles = inject(RolesRepo);
  protected readonly linkedin = inject(LinkedInRepo);
  private readonly toast = inject(Toast);
  private readonly confirm = inject(Confirm);
  readonly labels = FILE_LABELS;
  readonly shown = SHOWN;

  readonly reading = signal(false);
  readonly importing = signal(false);
  readonly deleting = signal(false);
  readonly problem = signal('');
  readonly preview = signal<LinkedInExport | null>(null);
  /** Links of the jobs the user unticked. */
  readonly unticked = signal<ReadonlySet<string>>(new Set());
  readonly keep = signal(true);

  /** What the pipeline holds already, by LinkedIn job number and by title. */
  private readonly have = computed(() => {
    const ids = new Set<string>();
    const pairs = new Set<string>();
    for (const r of this.roles.roles()) {
      const id = linkedInJobId(r.url);
      if (id) ids.add(id);
      pairs.add(pairOf(r.company, r.title));
    }
    return { ids, pairs };
  });

  /** Jobs in the file that are not in the pipeline yet. */
  readonly fresh = computed<LinkedInJob[]>(() => {
    const { ids, pairs } = this.have();
    return (this.preview()?.jobs ?? []).filter(
      (j) =>
        !ids.has(linkedInJobId(j.url) ?? '') &&
        !pairs.has(pairOf(j.company, j.title)),
    );
  });
  readonly chosen = computed(() =>
    this.fresh().filter((j) => !this.unticked().has(j.url)),
  );
  readonly something = computed(
    () =>
      this.chosen().length > 0 ||
      (this.keep() && !!this.preview()?.connections.length),
  );

  constructor() {
    void this.roles.load();
    void this.linkedin.refresh().catch(() => undefined);
  }

  async pick(input: HTMLInputElement) {
    const files = [...(input.files ?? [])];
    input.value = '';
    if (!files.length) return;
    await this.open(
      files.map((f) => ({
        name: f.name,
        size: f.size,
        read: async () => new Uint8Array(await f.arrayBuffer()),
      })),
    );
  }

  /** Reads the picked files in the browser and shows what would be imported. */
  async open(picked: PickedFile[]) {
    this.problem.set('');
    this.preview.set(null);
    this.unticked.set(new Set());
    this.keep.set(true);
    this.reading.set(true);
    try {
      const opened = await openLinkedInArchive(picked);
      if (opened.problem) {
        this.problem.set(opened.problem);
        return;
      }
      const read = readLinkedInExport(opened.files);
      read.ignored += opened.ignored;
      if (!read.jobs.length && !read.connections.length && !read.resume) {
        this.problem.set(
          read.files.find((f) => f.problem)?.problem
            ? 'The files were found, but their columns are not the ones LinkedIn normally uses, so nothing could be read. Please tell support@jobbotix.com which file it was.'
            : 'Those files hold no saved jobs, applications or connections.',
        );
        return;
      }
      this.preview.set(read);
    } catch {
      this.problem.set(
        'That file could not be read. Try downloading it again.',
      );
    } finally {
      this.reading.set(false);
    }
  }

  tick(url: string, on: boolean) {
    const next = new Set(this.unticked());
    if (on) next.delete(url);
    else next.add(url);
    this.unticked.set(next);
  }

  cancel() {
    this.preview.set(null);
    this.problem.set('');
  }

  async run() {
    const p = this.preview();
    if (!p || !this.something() || this.importing()) return;
    this.importing.set(true);
    const said: string[] = [];
    try {
      const jobs: ImportRoleInput[] = this.chosen().map((j) => ({
        company: j.company,
        title: j.title,
        url: j.url,
        status: j.status,
        location: '',
        salary: '',
        notes: '',
        source: LINKEDIN_EXPORT_SOURCE,
        found_at: at(j.date),
        status_changed_at: at(j.date),
      }));
      if (jobs.length) {
        const r = await this.data.importRoles(jobs);
        said.push(`${r.added} ${r.added === 1 ? 'job' : 'jobs'} added`);
        if (r.duplicates) said.push(`${r.duplicates} already there`);
        if (r.failed) said.push(`${r.failed} failed`);
      }
      if (this.keep() && p.connections.length) {
        const c = await this.linkedin.replaceConnections(
          p.connections.map((x) => ({
            name: x.name,
            company: x.company,
            title: x.title,
            profile_url: x.profileUrl,
            connected_on: x.connectedOn,
          })),
        );
        said.push(
          `${c.saved} ${c.saved === 1 ? 'connection' : 'connections'} kept`,
        );
        if (c.failed) said.push(`${c.failed} could not be saved`);
      }
      this.preview.set(null);
      this.toast.show(`LinkedIn import done: ${said.join(', ')}`);
    } catch (e) {
      this.toast.error((e as Error).message || 'Could not import');
    } finally {
      this.importing.set(false);
    }
  }

  async deleteConnections() {
    const ok = await this.confirm.ask({
      title: 'Delete your LinkedIn connections?',
      body: 'Every connection kept from your LinkedIn file is removed from your account. Your jobs and your contacts stay. You can import the file again later.',
      action: 'Delete connections',
      danger: true,
    });
    if (!ok) return;
    this.deleting.set(true);
    try {
      await this.linkedin.deleteConnections();
      this.toast.show('Your LinkedIn connections were deleted');
    } catch (e) {
      this.toast.error((e as Error).message || 'Could not delete them');
    } finally {
      this.deleting.set(false);
    }
  }
}
