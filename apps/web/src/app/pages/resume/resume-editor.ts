import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
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
import { Toast } from '../../shared/toast';

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
  imports: [RouterLink, ResumePreview, RelativeDayPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(window:beforeprint)': 'printing.set(true)',
    '(window:afterprint)': 'printing.set(false)',
  },
  template: `
    <section class="flex flex-col gap-4 print:hidden">
      <header class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight">Master resume</h1>
          <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
            The source every tailored variant starts from. {{ words() }} words
            @if (words() > 650) {
              <span class="text-amber-700 dark:text-amber-300"
                >(over one page for most layouts; aim under 650)</span
              >
            }
            @if (dirty()) {
              <span class="text-neutral-500">· unsaved changes</span>
            }
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <div
            class="inline-flex rounded-md border border-neutral-300 dark:border-neutral-700 md:hidden"
            role="tablist"
          >
            <button
              type="button"
              role="tab"
              class="px-3 py-1.5 text-sm"
              [class.font-semibold]="pane() === 'edit'"
              [attr.aria-selected]="pane() === 'edit'"
              (click)="pane.set('edit')"
            >
              Edit
            </button>
            <button
              type="button"
              role="tab"
              class="px-3 py-1.5 text-sm"
              [class.font-semibold]="pane() === 'preview'"
              [attr.aria-selected]="pane() === 'preview'"
              (click)="pane.set('preview')"
            >
              Preview
            </button>
          </div>
          <button type="button" class="jb-btn" (click)="printPdf()">
            Save as PDF
          </button>
          <button
            type="button"
            class="jb-btn-primary"
            (click)="save()"
            [disabled]="!dirty() || saving()"
          >
            {{ saving() ? 'Saving…' : 'Save version' }}
          </button>
        </div>
      </header>

      <div class="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div
          class="flex flex-col gap-6"
          [class.hidden]="pane() !== 'edit'"
          [class.md:flex]="true"
        >
          <!-- Contact -->
          <fieldset class="jb-fieldset">
            <legend class="jb-section-title">Contact</legend>
            <div class="grid gap-3 sm:grid-cols-2">
              <label class="jb-field"
                ><span>Name</span
                ><input
                  id="rc-name"
                  class="jb-input"
                  [value]="d().contact.name"
                  (input)="setContact('name', $any($event.target).value)"
              /></label>
              <label class="jb-field"
                ><span>Headline</span
                ><input
                  id="rc-headline"
                  class="jb-input"
                  [value]="d().contact.headline"
                  (input)="setContact('headline', $any($event.target).value)"
              /></label>
              <label class="jb-field"
                ><span>Email</span
                ><input
                  id="rc-email"
                  class="jb-input"
                  type="email"
                  [value]="d().contact.email"
                  (input)="setContact('email', $any($event.target).value)"
              /></label>
              <label class="jb-field"
                ><span>Phone</span
                ><input
                  id="rc-phone"
                  class="jb-input"
                  [value]="d().contact.phone"
                  (input)="setContact('phone', $any($event.target).value)"
              /></label>
              <label class="jb-field"
                ><span>Location</span
                ><input
                  id="rc-location"
                  class="jb-input"
                  [value]="d().contact.location"
                  (input)="setContact('location', $any($event.target).value)"
              /></label>
              <label class="jb-field"
                ><span>Website</span
                ><input
                  id="rc-website"
                  class="jb-input"
                  type="url"
                  [value]="d().contact.website"
                  (input)="setContact('website', $any($event.target).value)"
              /></label>
            </div>
            <label class="jb-field mt-3">
              <span
                >Links
                <span class="text-neutral-500"
                  >(one per line: Label | https://…)</span
                ></span
              >
              <textarea
                id="rc-links"
                class="jb-input min-h-16"
                [value]="linksText()"
                (change)="setLinks($any($event.target).value)"
              ></textarea>
            </label>
          </fieldset>

          <!-- Summary -->
          <fieldset class="jb-fieldset">
            <legend class="jb-section-title">Summary</legend>
            <textarea
              id="r-summary"
              class="jb-input min-h-28"
              [value]="d().summary"
              (input)="patch({ summary: $any($event.target).value })"
            ></textarea>
            <p class="mt-1 text-xs text-neutral-500">
              Three sentences: what you are, what you are best at, how you work.
            </p>
          </fieldset>

          <!-- Skills -->
          <fieldset class="jb-fieldset">
            <legend class="jb-section-title">Skills</legend>
            @for (g of d().skills; track $index; let i = $index) {
              <div
                class="grid gap-2 sm:grid-cols-[10rem_1fr_auto] items-start"
                [class.mt-2]="i > 0"
              >
                <input
                  class="jb-input"
                  [id]="'r-skill-name-' + i"
                  placeholder="Group"
                  [value]="g.name"
                  (input)="setSkill(i, 'name', $any($event.target).value)"
                />
                <input
                  class="jb-input"
                  [id]="'r-skill-items-' + i"
                  placeholder="Comma-separated"
                  [value]="g.items.join(', ')"
                  (change)="setSkill(i, 'items', $any($event.target).value)"
                />
                <button
                  type="button"
                  class="jb-btn"
                  (click)="removeAt('skills', i)"
                  aria-label="Remove skill group"
                >
                  ×
                </button>
              </div>
            }
            <button type="button" class="jb-btn mt-3" (click)="addSkill()">
              Add group
            </button>
          </fieldset>

          <!-- Experience -->
          <fieldset class="jb-fieldset">
            <legend class="jb-section-title">Experience</legend>
            @for (e of d().experience; track $index; let i = $index) {
              <div class="jb-card p-3" [class.mt-3]="i > 0">
                <div class="grid gap-2 sm:grid-cols-2">
                  <input
                    class="jb-input"
                    placeholder="Title"
                    [id]="'r-exp-title-' + i"
                    [value]="e.title"
                    (input)="setExp(i, 'title', $any($event.target).value)"
                  />
                  <input
                    class="jb-input"
                    placeholder="Company"
                    [id]="'r-exp-company-' + i"
                    [value]="e.company"
                    (input)="setExp(i, 'company', $any($event.target).value)"
                  />
                  <input
                    class="jb-input"
                    placeholder="Location"
                    [id]="'r-exp-location-' + i"
                    [value]="e.location"
                    (input)="setExp(i, 'location', $any($event.target).value)"
                  />
                  <div class="flex gap-2">
                    <input
                      class="jb-input"
                      type="month"
                      [id]="'r-exp-start-' + i"
                      aria-label="Start"
                      [value]="e.start"
                      (input)="setExp(i, 'start', $any($event.target).value)"
                    />
                    <input
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
                    <span class="text-neutral-500"
                      >(one per line; lead with the result)</span
                    ></span
                  >
                  <textarea
                    class="jb-input min-h-24"
                    [id]="'r-exp-bullets-' + i"
                    [value]="e.bullets.join('\\n')"
                    (change)="setExp(i, 'bullets', $any($event.target).value)"
                  ></textarea>
                </label>
                <div class="mt-2 flex gap-2">
                  <button
                    type="button"
                    class="jb-btn"
                    (click)="move('experience', i, -1)"
                    [disabled]="i === 0"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    class="jb-btn"
                    (click)="move('experience', i, 1)"
                    [disabled]="i === d().experience.length - 1"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    class="jb-btn"
                    (click)="removeAt('experience', i)"
                  >
                    Remove
                  </button>
                </div>
              </div>
            }
            <button type="button" class="jb-btn mt-3" (click)="addExp()">
              Add position
            </button>
          </fieldset>

          <!-- Projects -->
          <fieldset class="jb-fieldset">
            <legend class="jb-section-title">Projects</legend>
            @for (p of d().projects; track $index; let i = $index) {
              <div class="jb-card p-3" [class.mt-3]="i > 0">
                <div class="grid gap-2 sm:grid-cols-2">
                  <input
                    class="jb-input"
                    placeholder="Name"
                    [id]="'r-proj-name-' + i"
                    [value]="p.name"
                    (input)="setProj(i, 'name', $any($event.target).value)"
                  />
                  <input
                    class="jb-input"
                    placeholder="https://…"
                    type="url"
                    [id]="'r-proj-url-' + i"
                    [value]="p.url"
                    (input)="setProj(i, 'url', $any($event.target).value)"
                  />
                </div>
                <input
                  class="jb-input mt-2"
                  placeholder="One sentence on what it is"
                  [id]="'r-proj-desc-' + i"
                  [value]="p.description"
                  (input)="setProj(i, 'description', $any($event.target).value)"
                />
                <input
                  class="jb-input mt-2"
                  placeholder="Stack, comma-separated"
                  [id]="'r-proj-stack-' + i"
                  [value]="p.stack.join(', ')"
                  (change)="setProj(i, 'stack', $any($event.target).value)"
                />
                <div class="mt-2 flex gap-2">
                  <button
                    type="button"
                    class="jb-btn"
                    (click)="removeAt('projects', i)"
                  >
                    Remove
                  </button>
                </div>
              </div>
            }
            <button type="button" class="jb-btn mt-3" (click)="addProj()">
              Add project
            </button>
          </fieldset>

          <!-- AI toolkit, education, certifications -->
          <fieldset class="jb-fieldset">
            <legend class="jb-section-title">AI toolkit</legend>
            <input
              id="r-ai"
              class="jb-input"
              placeholder="Comma-separated"
              [value]="d().aiToolkit.join(', ')"
              (change)="patch({ aiToolkit: csv($any($event.target).value) })"
            />
            <p class="mt-1 text-xs text-neutral-500">
              The tools and practices you actually use. Recruiters searching for
              "AI-assisted" land on this line.
            </p>
          </fieldset>

          <fieldset class="jb-fieldset">
            <legend class="jb-section-title">Education</legend>
            @for (e of d().education; track $index; let i = $index) {
              <div
                class="grid gap-2 sm:grid-cols-[1fr_1fr_6rem_auto]"
                [class.mt-2]="i > 0"
              >
                <input
                  class="jb-input"
                  placeholder="Degree"
                  [id]="'r-edu-degree-' + i"
                  [value]="e.degree"
                  (input)="setEdu(i, 'degree', $any($event.target).value)"
                />
                <input
                  class="jb-input"
                  placeholder="Institution"
                  [id]="'r-edu-inst-' + i"
                  [value]="e.institution"
                  (input)="setEdu(i, 'institution', $any($event.target).value)"
                />
                <input
                  class="jb-input"
                  placeholder="Year"
                  [id]="'r-edu-year-' + i"
                  [value]="e.year"
                  (input)="setEdu(i, 'year', $any($event.target).value)"
                />
                <button
                  type="button"
                  class="jb-btn"
                  (click)="removeAt('education', i)"
                  aria-label="Remove education"
                >
                  ×
                </button>
              </div>
            }
            <button type="button" class="jb-btn mt-3" (click)="addEdu()">
              Add education
            </button>
            <label class="jb-field mt-3">
              <span
                >Certifications
                <span class="text-neutral-500">(comma-separated)</span></span
              >
              <input
                id="r-certs"
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
            <section>
              <h2 class="jb-section-title">Versions</h2>
              <ul
                class="mt-2 divide-y divide-neutral-200 text-sm dark:divide-neutral-800"
              >
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
                          class="jb-btn"
                          (click)="restore(v.id)"
                        >
                          Restore
                        </button>
                        <button
                          type="button"
                          class="jb-btn"
                          (click)="repo.remove(v.id)"
                        >
                          Delete
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
            class="sticky top-4 max-h-[calc(100vh-2rem)] overflow-auto rounded-lg bg-neutral-200/60 p-4 dark:bg-neutral-900"
          >
            <jb-resume-preview [r]="d()" />
          </div>
        </div>
      </div>

      <p class="text-xs text-neutral-500">
        Tailored variants per role come next; they start from whatever is saved
        here. <a routerLink="/roles" class="underline">Back to Roles</a>
      </p>
    </section>

    <!-- Print: only the page -->
    <div class="hidden print:block">
      <jb-resume-preview [r]="d()" [print]="true" />
    </div>
  `,
  styles: `
    .jb-fieldset {
      border: 0;
      padding: 0;
      margin: 0;
      min-width: 0;
    }
    .jb-fieldset > legend {
      margin-bottom: 0.5rem;
    }
    .jb-field {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      font-size: 0.875rem;
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
      this.toast.show('Saved as the current master');
    } catch (e) {
      this.toast.show((e as Error).message || 'Could not save');
    } finally {
      this.saving.set(false);
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

  printPdf() {
    window.print();
  }
}
