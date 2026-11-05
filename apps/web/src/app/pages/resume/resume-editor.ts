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
  emptyResume,
  normaliseResume,
  resumeWordCount,
  type EducationEntry,
  type ExperienceEntry,
  type ProjectEntry,
  type ResumeSections,
  type SkillGroup,
} from '@jobbotix/shared-types';
import { ResumesRepo } from '../../core/data/repos';
import { RelativeDayPipe } from '../../shared/format';
import { ResumePreview } from '../../shared/resume-preview';
import { ResumeImportPanel } from './resume-import';
import { downloadResumePdf, resumeFilename } from '../../shared/resume-pdf';
import { Toast } from '../../shared/toast';
import {
  Button,
  Confirm,
  FieldControl,
  Icon,
  PageHeader,
  ScaledPage,
  Tabs,
  type TabItem,
} from '../../ui';

type Pane = 'edit' | 'preview';

const lines = (s: string) =>
  s
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
const csv = (s: string) =>
  s
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * Master resume: structured sections on the left, the page on the right.
 * Edits live in a draft signal; Save writes a new version and makes it master.
 */
@Component({
  selector: 'jb-resume-editor',
  imports: [
    Button,
    FieldControl,
    Icon,
    PageHeader,
    RelativeDayPipe,
    ResumeImportPanel,
    ResumePreview,
    ScaledPage,
    Tabs,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(window:beforeprint)': 'printing.set(true)',
    '(window:afterprint)': 'printing.set(false)',
    '(window:beforeunload)': 'onBeforeUnload($event)',
  },
  template: `
    <section class="flex flex-col gap-4 print:hidden">
      <jb-page-header title="Master resume">
        <p lead class="mt-2 max-w-[var(--reading-max)] text-ink-muted">
          The source every tailored variant starts from.
          <span class="whitespace-nowrap" [class.text-warn]="words() > 650"
            >{{ words() }} words</span
          >
          @if (words() > 650) {
            <span class="text-warn"
              >, over one page for most layouts; aim under 650.</span
            >
          }
        </p>
        <div actions class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            jbButton
            [attr.aria-expanded]="importing()"
            (click)="importing.set(!importing())"
          >
            <jb-icon name="upload" /> Import
          </button>
          <button
            type="button"
            jbButton
            [busy]="exporting()"
            [disabled]="exporting()"
            title="Text PDF, readable by ATS parsers"
            (click)="downloadPdf()"
          >
            <jb-icon name="download" /> PDF
          </button>
          <button
            type="button"
            jbButton="ghost"
            iconOnly
            aria-label="Print"
            title="Browser print dialog (choose Save as PDF)"
            (click)="printPdf()"
          >
            <jb-icon name="printer" />
          </button>
          <button
            type="button"
            jbButton="primary"
            class="hidden md:inline-flex"
            [busy]="saving()"
            [disabled]="!dirty() || saving()"
            (click)="save()"
          >
            Save version
          </button>
        </div>
      </jb-page-header>

      <div class="flex items-center justify-between gap-3 md:hidden">
        <jb-tabs
          variant="segmented"
          prefix="resume-pane"
          [controls]="false"
          label="Show"
          [tabs]="panes"
          [value]="pane()"
          (valueChange)="pane.set($any($event))"
        />
        @if (dirty()) {
          <span class="text-xs text-warn">Unsaved changes</span>
        }
      </div>
      @if (dirty()) {
        <p class="hidden text-sm text-warn md:block" role="status">
          You have unsaved changes.
        </p>
      }

      @if (importing()) {
        <jb-resume-import
          (imported)="applyImport($event)"
          (closed)="importing.set(false)"
        />
      }

      <div
        class="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
      >
        <div
          class="flex min-w-0 flex-col gap-6"
          [class.hidden]="pane() !== 'edit'"
          [class.md:flex]="true"
        >
          <!-- Contact -->
          <fieldset class="jb-fieldset">
            <legend class="jb-legend">Contact</legend>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label class="jb-field"
                ><span>Name</span
                ><input
                  id="rc-name"
                  jbInput
                  class="jb-input"
                  [value]="d().contact.name"
                  (input)="setContact('name', $any($event.target).value)"
              /></label>
              <label class="jb-field"
                ><span>Headline</span
                ><input
                  id="rc-headline"
                  jbInput
                  class="jb-input"
                  [value]="d().contact.headline"
                  (input)="setContact('headline', $any($event.target).value)"
              /></label>
              <label class="jb-field"
                ><span>Email</span
                ><input
                  id="rc-email"
                  jbInput
                  class="jb-input"
                  type="email"
                  [value]="d().contact.email"
                  (input)="setContact('email', $any($event.target).value)"
              /></label>
              <label class="jb-field"
                ><span>Phone</span
                ><input
                  id="rc-phone"
                  jbInput
                  class="jb-input"
                  [value]="d().contact.phone"
                  (input)="setContact('phone', $any($event.target).value)"
              /></label>
              <label class="jb-field"
                ><span>Location</span
                ><input
                  id="rc-location"
                  jbInput
                  class="jb-input"
                  [value]="d().contact.location"
                  (input)="setContact('location', $any($event.target).value)"
              /></label>
              <label class="jb-field"
                ><span>Website</span
                ><input
                  id="rc-website"
                  jbInput
                  class="jb-input"
                  type="url"
                  [value]="d().contact.website"
                  (input)="setContact('website', $any($event.target).value)"
              /></label>
            </div>
            <label class="jb-field mt-3">
              <span
                >Links
                <span class="font-normal text-ink-muted"
                  >(one per line: Label | https://…)</span
                ></span
              >
              <textarea
                id="rc-links"
                jbInput
                class="jb-input min-h-16"
                [value]="linksText()"
                (change)="setLinks($any($event.target).value)"
              ></textarea>
            </label>
          </fieldset>

          <!-- Summary -->
          <fieldset class="jb-fieldset">
            <legend class="jb-legend">Summary</legend>
            <textarea
              id="r-summary"
              aria-label="Summary"
              jbInput
              class="jb-input min-h-28"
              [value]="d().summary"
              (input)="patch({ summary: $any($event.target).value })"
            ></textarea>
            <p class="mt-1.5 text-xs text-ink-muted">
              Three sentences: what you are, what you are best at, how you work.
            </p>
          </fieldset>

          <!-- Skills -->
          <fieldset class="jb-fieldset">
            <legend class="jb-legend">Skills</legend>
            @for (g of d().skills; track $index; let i = $index) {
              <div
                class="grid gap-2 sm:grid-cols-[10rem_1fr_auto] items-start"
                [class.mt-2]="i > 0"
              >
                <input
                  jbInput
                  class="jb-input"
                  [id]="'r-skill-name-' + i"
                  placeholder="Group"
                  aria-label="Group"
                  [value]="g.name"
                  (input)="setSkill(i, 'name', $any($event.target).value)"
                />
                <input
                  jbInput
                  class="jb-input"
                  [id]="'r-skill-items-' + i"
                  placeholder="Comma-separated"
                  aria-label="Comma-separated"
                  [value]="g.items.join(', ')"
                  (change)="setSkill(i, 'items', $any($event.target).value)"
                />
                <button
                  type="button"
                  jbButton="ghost"
                  iconOnly
                  aria-label="Remove skill group"
                  title="Remove skill group"
                  (click)="removeAt('skills', i)"
                >
                  <jb-icon name="trash" />
                </button>
              </div>
            }
            <button
              type="button"
              jbButton="ghost"
              size="sm"
              class="mt-3"
              (click)="addSkill()"
            >
              <jb-icon name="plus" /> Add group
            </button>
          </fieldset>

          <!-- Experience -->
          <fieldset class="jb-fieldset">
            <legend class="jb-legend">Experience</legend>
            @for (e of d().experience; track $index; let i = $index) {
              <div class="jb-card p-3" [class.mt-3]="i > 0">
                <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    jbInput
                    class="jb-input"
                    placeholder="Title"
                    aria-label="Title"
                    [id]="'r-exp-title-' + i"
                    [value]="e.title"
                    (input)="setExp(i, 'title', $any($event.target).value)"
                  />
                  <input
                    jbInput
                    class="jb-input"
                    placeholder="Company"
                    aria-label="Company"
                    [id]="'r-exp-company-' + i"
                    [value]="e.company"
                    (input)="setExp(i, 'company', $any($event.target).value)"
                  />
                  <input
                    jbInput
                    class="jb-input"
                    placeholder="Location"
                    aria-label="Location"
                    [id]="'r-exp-location-' + i"
                    [value]="e.location"
                    (input)="setExp(i, 'location', $any($event.target).value)"
                  />
                  <div class="flex min-w-0 flex-col gap-2 sm:flex-row">
                    <input
                      jbInput
                      class="jb-input"
                      type="month"
                      [id]="'r-exp-start-' + i"
                      aria-label="Start"
                      [value]="e.start"
                      (input)="setExp(i, 'start', $any($event.target).value)"
                    />
                    <input
                      jbInput
                      class="jb-input"
                      type="month"
                      [id]="'r-exp-end-' + i"
                      aria-label="End (blank = present)"
                      [value]="e.end"
                      (input)="setExp(i, 'end', $any($event.target).value)"
                    />
                  </div>
                </div>
                <label class="jb-field mt-2">
                  <span
                    >Bullets
                    <span class="font-normal text-ink-muted"
                      >(one per line; lead with the result)</span
                    ></span
                  >
                  <textarea
                    jbInput
                    class="jb-input min-h-24"
                    [id]="'r-exp-bullets-' + i"
                    [value]="e.bullets.join('\\n')"
                    (change)="setExp(i, 'bullets', $any($event.target).value)"
                  ></textarea>
                </label>
                <div class="mt-2 flex gap-2">
                  <button
                    type="button"
                    jbButton="ghost"
                    iconOnly
                    aria-label="Move up"
                    title="Move up"
                    [disabled]="i === 0"
                    (click)="move('experience', i, -1)"
                  >
                    <jb-icon name="chevron-up" />
                  </button>
                  <button
                    type="button"
                    jbButton="ghost"
                    iconOnly
                    aria-label="Move down"
                    title="Move down"
                    [disabled]="i === d().experience.length - 1"
                    (click)="move('experience', i, 1)"
                  >
                    <jb-icon name="chevron-down" />
                  </button>
                  <button
                    type="button"
                    jbButton="ghost"
                    class="ml-auto text-bad"
                    (click)="confirmRemove('experience', i)"
                  >
                    <jb-icon name="trash" /> Remove
                  </button>
                </div>
              </div>
            }
            <button
              type="button"
              jbButton="ghost"
              size="sm"
              class="mt-3"
              (click)="addExp()"
            >
              <jb-icon name="plus" /> Add position
            </button>
          </fieldset>

          <!-- Projects -->
          <fieldset class="jb-fieldset">
            <legend class="jb-legend">Projects</legend>
            @for (p of d().projects; track $index; let i = $index) {
              <div class="jb-card p-3" [class.mt-3]="i > 0">
                <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    jbInput
                    class="jb-input"
                    placeholder="Name"
                    aria-label="Name"
                    [id]="'r-proj-name-' + i"
                    [value]="p.name"
                    (input)="setProj(i, 'name', $any($event.target).value)"
                  />
                  <input
                    jbInput
                    class="jb-input"
                    placeholder="https://…"
                    aria-label="Project link"
                    type="url"
                    [id]="'r-proj-url-' + i"
                    [value]="p.url"
                    (input)="setProj(i, 'url', $any($event.target).value)"
                  />
                </div>
                <input
                  jbInput
                  class="jb-input mt-2"
                  placeholder="One sentence on what it is"
                  aria-label="One sentence on what it is"
                  [id]="'r-proj-desc-' + i"
                  [value]="p.description"
                  (input)="setProj(i, 'description', $any($event.target).value)"
                />
                <input
                  jbInput
                  class="jb-input mt-2"
                  placeholder="Stack, comma-separated"
                  aria-label="Stack, comma-separated"
                  [id]="'r-proj-stack-' + i"
                  [value]="p.stack.join(', ')"
                  (change)="setProj(i, 'stack', $any($event.target).value)"
                />
                <div class="mt-2 flex gap-2">
                  <button
                    type="button"
                    jbButton="ghost"
                    class="ml-auto text-bad"
                    (click)="confirmRemove('projects', i)"
                  >
                    <jb-icon name="trash" /> Remove
                  </button>
                </div>
              </div>
            }
            <button
              type="button"
              jbButton="ghost"
              size="sm"
              class="mt-3"
              (click)="addProj()"
            >
              <jb-icon name="plus" /> Add project
            </button>
          </fieldset>

          <!-- AI toolkit, education, certifications -->
          <fieldset class="jb-fieldset">
            <legend class="jb-legend">AI toolkit</legend>
            <input
              id="r-ai"
              jbInput
              class="jb-input"
              placeholder="Comma-separated"
              aria-label="Comma-separated"
              [value]="d().aiToolkit.join(', ')"
              (change)="patch({ aiToolkit: csv($any($event.target).value) })"
            />
            <p class="mt-1.5 text-xs text-ink-muted">
              The tools and practices you actually use. Recruiters searching for
              "AI-assisted" land on this line.
            </p>
          </fieldset>

          <fieldset class="jb-fieldset">
            <legend class="jb-legend">Education</legend>
            @for (e of d().education; track $index; let i = $index) {
              <div
                class="grid gap-2 sm:grid-cols-[1fr_1fr_6rem_auto]"
                [class.mt-2]="i > 0"
              >
                <input
                  jbInput
                  class="jb-input"
                  placeholder="Degree"
                  aria-label="Degree"
                  [id]="'r-edu-degree-' + i"
                  [value]="e.degree"
                  (input)="setEdu(i, 'degree', $any($event.target).value)"
                />
                <input
                  jbInput
                  class="jb-input"
                  placeholder="Institution"
                  aria-label="Institution"
                  [id]="'r-edu-inst-' + i"
                  [value]="e.institution"
                  (input)="setEdu(i, 'institution', $any($event.target).value)"
                />
                <input
                  jbInput
                  class="jb-input"
                  placeholder="Year"
                  aria-label="Year"
                  [id]="'r-edu-year-' + i"
                  [value]="e.year"
                  (input)="setEdu(i, 'year', $any($event.target).value)"
                />
                <button
                  type="button"
                  jbButton="ghost"
                  iconOnly
                  aria-label="Remove education"
                  title="Remove education"
                  (click)="removeAt('education', i)"
                >
                  <jb-icon name="trash" />
                </button>
              </div>
            }
            <button
              type="button"
              jbButton="ghost"
              size="sm"
              class="mt-3"
              (click)="addEdu()"
            >
              <jb-icon name="plus" /> Add education
            </button>
            <label class="jb-field mt-3">
              <span
                >Certifications
                <span class="font-normal text-ink-muted"
                  >(comma-separated)</span
                ></span
              >
              <input
                id="r-certs"
                jbInput
                class="jb-input"
                [value]="d().certifications.join(', ')"
                (change)="
                  patch({ certifications: csv($any($event.target).value) })
                "
              />
            </label>
          </fieldset>

          <!-- Versions -->
          @if (repo.resumes().length > 1) {
            <section class="jb-card p-5">
              <h2 class="jb-legend">Versions</h2>
              <ul class="mt-2 divide-y divide-line text-sm">
                @for (v of repo.resumes(); track v.id) {
                  <li class="flex items-center justify-between gap-3 py-2">
                    <span
                      >{{ v.name }} · {{ v.created_at | relativeDay }}
                      @if (v.is_master) {
                        <span class="jb-tag jb-tag-ai ml-1">current</span>
                      }
                    </span>
                    @if (!v.is_master) {
                      <span class="flex gap-2">
                        <button
                          type="button"
                          jbButton
                          size="sm"
                          (click)="restore(v.id)"
                        >
                          Restore
                        </button>
                        <button
                          type="button"
                          jbButton="ghost"
                          size="sm"
                          iconOnly
                          [attr.aria-label]="'Delete version ' + v.name"
                          (click)="deleteVersion(v.id, v.name)"
                        >
                          <jb-icon name="trash" />
                        </button>
                      </span>
                    }
                  </li>
                }
              </ul>
            </section>
          }
        </div>

        <div
          class="min-w-0"
          [class.hidden]="pane() !== 'preview'"
          [class.md:block]="true"
        >
          <div
            class="sticky top-8 max-h-[calc(100dvh-4rem)] overflow-auto rounded-card bg-sunken p-3 md:p-4"
          >
            <jb-scaled-page>
              <jb-resume-preview [r]="d()" />
            </jb-scaled-page>
          </div>
        </div>
      </div>

      <p class="text-xs text-ink-muted">
        Tailored variants on each role start from whatever is saved here.
      </p>

      @if (dirty()) {
        <div class="md:hidden">
          <div class="jb-savebar" role="status">
            <span class="text-sm font-medium text-ink">Unsaved changes</span>
            <button
              type="button"
              jbButton="primary"
              [busy]="saving()"
              [disabled]="saving()"
              (click)="save()"
            >
              Save version
            </button>
          </div>
        </div>
      }
    </section>

    <!-- Print: only the page -->
    <div class="hidden print:block">
      <jb-resume-preview [r]="d()" [print]="true" />
    </div>
  `,
  styles: `
    .jb-fieldset {
      min-width: 0;
      margin: 0;
      padding: 1.25rem;
      border: 1px solid var(--line);
      border-radius: var(--r-card);
      background: var(--surface);
    }
    .jb-legend {
      float: left;
      width: 100%;
      margin: 0 0 0.85rem;
      padding: 0;
      color: var(--ink);
      font-size: 1.0625rem;
      font-weight: 600;
    }
    .jb-legend + * {
      clear: both;
    }
    .jb-savebar {
      position: fixed;
      left: var(--gutter);
      right: var(--gutter);
      bottom: calc(
        var(--tabbar-h) + env(safe-area-inset-bottom, 0px) + 0.75rem
      );
      z-index: 25;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.6rem 0.6rem 0.6rem 1rem;
      border: 1px solid var(--line);
      border-radius: var(--r-card);
      background: var(--surface-raised);
      box-shadow: var(--elev-overlay);
    }
    .jb-field {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
      font-size: 0.875rem;
      font-weight: 500;
    }
    @media print {
      :host {
        display: block;
      }
      @page {
        size: A4;
        margin: 14mm 16mm;
      }
    }
  `,
})
export class ResumeEditor {
  protected readonly repo = inject(ResumesRepo);
  private readonly toast = inject(Toast);

  readonly d = signal<ResumeSections>(emptyResume());
  readonly saved = signal<string>(JSON.stringify(emptyResume()));
  readonly dirty = computed(() => JSON.stringify(this.d()) !== this.saved());
  readonly words = computed(() => resumeWordCount(this.d()));
  readonly saving = signal(false);
  readonly pane = signal<Pane>('edit');
  readonly importing = signal(false);
  readonly exporting = signal(false);
  readonly printing = signal(false);
  readonly linksText = computed(() =>
    this.d()
      .contact.links.map((l) => `${l.label} | ${l.url}`)
      .join('\n'),
  );
  readonly csv = csv;

  constructor() {
    void this.repo.load();
    effect(() => {
      const m = this.repo.master();
      untracked(() => {
        if (m && !this.dirty()) {
          const sections = normaliseResume(m.sections);
          this.d.set(sections);
          this.saved.set(JSON.stringify(sections));
        }
      });
    });
  }

  applyImport(e: { sections: ResumeSections; mode: 'replace' | 'fill' }) {
    const incoming = normaliseResume(e.sections);
    if (e.mode === 'replace') {
      this.d.set(incoming);
    } else {
      this.d.update((cur) => fillEmpty(cur, incoming));
    }
    this.importing.set(false);
    this.pane.set('edit');
    this.toast.show('Imported. Review the fields, then Save version.');
  }

  patch(p: Partial<ResumeSections>) {
    this.d.update((r) => ({ ...r, ...p }));
  }

  setContact(
    key: keyof Omit<ResumeSections['contact'], 'links'>,
    value: string,
  ) {
    this.d.update((r) => ({ ...r, contact: { ...r.contact, [key]: value } }));
  }

  setLinks(text: string) {
    const links = lines(text).map((l) => {
      const [label, url] = l.split('|').map((x) => x.trim());
      return url ? { label, url } : { label: '', url: label };
    });
    this.d.update((r) => ({ ...r, contact: { ...r.contact, links } }));
  }

  setSkill(i: number, key: keyof SkillGroup, value: string) {
    this.d.update((r) => {
      const skills = r.skills.map((g, j) =>
        j === i ? { ...g, [key]: key === 'items' ? csv(value) : value } : g,
      );
      return { ...r, skills };
    });
  }
  addSkill() {
    this.d.update((r) => ({
      ...r,
      skills: [...r.skills, { name: '', items: [] }],
    }));
  }

  setExp(i: number, key: keyof ExperienceEntry, value: string) {
    this.d.update((r) => ({
      ...r,
      experience: r.experience.map((e, j) =>
        j === i ? { ...e, [key]: key === 'bullets' ? lines(value) : value } : e,
      ),
    }));
  }
  addExp() {
    this.d.update((r) => ({
      ...r,
      experience: [
        ...r.experience,
        {
          company: '',
          title: '',
          location: '',
          start: '',
          end: '',
          bullets: [],
        },
      ],
    }));
  }

  setProj(i: number, key: keyof ProjectEntry, value: string) {
    this.d.update((r) => ({
      ...r,
      projects: r.projects.map((p, j) =>
        j === i ? { ...p, [key]: key === 'stack' ? csv(value) : value } : p,
      ),
    }));
  }
  addProj() {
    this.d.update((r) => ({
      ...r,
      projects: [
        ...r.projects,
        { name: '', url: '', description: '', stack: [] },
      ],
    }));
  }

  setEdu(i: number, key: keyof EducationEntry, value: string) {
    this.d.update((r) => ({
      ...r,
      education: r.education.map((e, j) =>
        j === i ? { ...e, [key]: value } : e,
      ),
    }));
  }
  addEdu() {
    this.d.update((r) => ({
      ...r,
      education: [...r.education, { institution: '', degree: '', year: '' }],
    }));
  }

  removeAt(
    list: 'skills' | 'experience' | 'projects' | 'education',
    i: number,
  ) {
    this.d.update((r) => ({
      ...r,
      [list]: (r[list] as unknown[]).filter((_, j) => j !== i),
    }));
  }

  move(list: 'experience' | 'projects', i: number, delta: number) {
    this.d.update((r) => {
      const arr = [...(r[list] as unknown[])];
      const j = i + delta;
      if (j < 0 || j >= arr.length) return r;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return { ...r, [list]: arr };
    });
  }

  async save() {
    if (!this.dirty() || this.saving()) return;
    this.saving.set(true);
    try {
      await this.repo.saveMaster(this.d());
      this.saved.set(JSON.stringify(this.d()));
      this.toast.success('Saved as the current master');
    } catch (e) {
      this.toast.show((e as Error).message || 'Could not save');
    } finally {
      this.saving.set(false);
    }
  }

  /** The browser's own "leave site?" prompt while edits are unsaved. */
  onBeforeUnload(e: BeforeUnloadEvent) {
    if (this.dirty()) e.preventDefault();
  }

  readonly panes: TabItem<'edit' | 'preview'>[] = [
    { id: 'edit', label: 'Edit', icon: 'pencil' },
    { id: 'preview', label: 'Preview', icon: 'eye' },
  ];
  private readonly confirm = inject(Confirm);

  async confirmRemove(list: 'experience' | 'projects', i: number) {
    const what = list === 'experience' ? 'position' : 'project';
    const ok = await this.confirm.ask({
      title: `Remove this ${what}?`,
      body: 'It leaves the draft now; your saved versions keep it until you save again.',
      action: `Remove ${what}`,
      danger: true,
    });
    if (ok) this.removeAt(list, i);
  }

  async deleteVersion(id: string, name: string) {
    const ok = await this.confirm.ask({
      title: `Delete the version “${name}”?`,
      body: 'The saved version is removed for good. Your current resume is not affected.',
      action: 'Delete version',
      danger: true,
    });
    if (!ok) return;
    try {
      await this.repo.remove(id);
      this.toast.show('Version deleted');
    } catch {
      this.toast.error('Could not delete the version');
    }
  }

  async restore(id: string) {
    await this.repo.restore(id);
    const m = this.repo.master();
    if (m) {
      const sections = normaliseResume(m.sections);
      this.d.set(sections);
      this.saved.set(JSON.stringify(sections));
    }
    this.toast.show('Restored');
  }

  async downloadPdf() {
    this.exporting.set(true);
    try {
      await downloadResumePdf(this.d(), resumeFilename(this.d()));
    } catch (e) {
      this.toast.show((e as Error).message || 'Could not build the PDF');
    } finally {
      this.exporting.set(false);
    }
  }

  printPdf() {
    window.print();
  }
}

/** Takes each top-level section from `incoming` only where `cur` has nothing. */
function fillEmpty(
  cur: ResumeSections,
  incoming: ResumeSections,
): ResumeSections {
  const contact = { ...cur.contact };
  for (const k of Object.keys(contact) as (keyof ResumeSections['contact'])[]) {
    const v = contact[k];
    const empty = Array.isArray(v) ? v.length === 0 : !v;
    if (empty) (contact as Record<string, unknown>)[k] = incoming.contact[k];
  }
  return {
    contact,
    summary: cur.summary || incoming.summary,
    skills: cur.skills.length ? cur.skills : incoming.skills,
    experience: cur.experience.length ? cur.experience : incoming.experience,
    projects: cur.projects.length ? cur.projects : incoming.projects,
    aiToolkit: cur.aiToolkit.length ? cur.aiToolkit : incoming.aiToolkit,
    education: cur.education.length ? cur.education : incoming.education,
    certifications: cur.certifications.length
      ? cur.certifications
      : incoming.certifications,
  };
}
