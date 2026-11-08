import {
  ChangeDetectionStrategy,
  Component,
  computed,
  output,
  signal,
} from '@angular/core';
import { formatResumeDate, type ResumeSections } from '@jobbotix/shared-types';
import {
  htmlToResumeText,
  parseResumeText,
  pdfPagesToText,
  type PdfTextPage,
  type ResumeImport,
} from '@jobbotix/shared-types/resume-import';

import { Icon } from '../../ui';

const MAX_BYTES = 10 * 1024 * 1024;

/** Reads a resume from pasted text, a .docx, a PDF or a text file and parses it. */
@Component({
  selector: 'jb-resume-import',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="jb-card flex flex-col gap-4 p-5 md:p-6">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <h2 class="jb-section-title">Import a resume</h2>
          <p class="mt-1 text-sm text-ink-muted">
            Paste the text or pick a .docx, PDF or .txt. Nothing leaves your
            browser: the file is read and parsed here, and you review the result
            before it touches the master.
          </p>
        </div>
        <button
          type="button"
          class="jb-btn jb-btn-ghost jb-btn-icon"
          aria-label="Close import"
          (click)="closed.emit()"
        >
          <jb-icon name="x" />
        </button>
      </div>

      <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <textarea
          id="ri-text"
          class="jb-input min-h-40 font-mono text-xs"
          aria-label="Resume text"
          placeholder="Paste your resume text here…"
          [value]="text()"
          (input)="text.set($any($event.target).value)"
        ></textarea>
        <div class="flex flex-col gap-2">
          <label
            class="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-card border border-dashed border-line-strong px-4 py-4 text-center text-sm text-ink-muted transition-colors hover:border-brand hover:text-ink sm:w-52"
            [class.border-brand]="dragging()"
            [class.bg-brand-tint]="dragging()"
            (dragover)="$event.preventDefault(); dragging.set(true)"
            (dragleave)="dragging.set(false)"
            (drop)="
              $event.preventDefault();
              dragging.set(false);
              onFile($any($event).dataTransfer?.files?.[0])
            "
          >
            @if (busy()) {
              <jb-icon
                name="loader-circle"
                [size]="22"
                class="animate-spin text-brand"
              />
              <span class="font-medium text-ink">Reading…</span>
            } @else {
              <jb-icon name="upload" [size]="22" class="text-brand" />
              <span class="font-medium text-ink">Choose a file</span>
              <span class="text-xs">or drop .docx, PDF or .txt here</span>
            }
            <input
              id="ri-file"
              type="file"
              class="sr-only"
              accept=".docx,.pdf,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
              (change)="
                onFile($any($event.target).files?.[0]);
                $any($event.target).value = ''
              "
            />
          </label>
          <button
            type="button"
            class="jb-btn-primary"
            [attr.aria-busy]="busy() ? 'true' : null"
            (click)="parse()"
            [disabled]="!text().trim() || busy()"
          >
            {{ result() ? 'Parse again' : 'Parse' }}
          </button>
          @if (fileName()) {
            <span class="break-all text-xs text-ink-muted">{{
              fileName()
            }}</span>
          }
        </div>
      </div>

      @if (error()) {
        <p class="text-sm text-bad" role="alert">
          {{ error() }}
        </p>
      }

      @if (result(); as res) {
        <div
          class="flex flex-col gap-3 border-t border-line pt-3"
          aria-live="polite"
        >
          <p class="text-sm">
            Found
            <b>{{ res.resume.contact.name || 'no name' }}</b>
            · {{ res.resume.experience.length }} roles ·
            {{ skillCount() }} skills ·
            {{ res.resume.education.length }} education ·
            {{ res.resume.projects.length }} projects
          </p>

          <dl
            class="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]"
          >
            <dt class="text-ink-muted">Contact</dt>
            <dd class="min-w-0 break-words">
              {{ contactLine() || '—' }}
            </dd>
            <dt class="text-ink-muted">Headline</dt>
            <dd class="min-w-0 break-words">
              {{ res.resume.contact.headline || '—' }}
            </dd>
            <dt class="text-ink-muted">Experience</dt>
            <dd class="min-w-0">
              @for (e of res.resume.experience; track $index) {
                <div class="break-words">
                  <b>{{ e.title || 'No title' }}</b>
                  · {{ e.company || 'no company' }}
                  <span class="text-ink-muted">
                    · {{ e.start ? fmt(e.start) : '?' }} – {{ fmt(e.end) }} ·
                    {{ e.bullets.length }} bullets</span
                  >
                </div>
              } @empty {
                <span class="text-warn">None found</span>
              }
            </dd>
            <dt class="text-ink-muted">Skills</dt>
            <dd class="min-w-0 break-words">
              @for (g of res.resume.skills; track $index) {
                <div>
                  <span class="text-ink-muted">{{ g.name }}:</span>
                  {{ g.items.join(', ') }}
                </div>
              } @empty {
                <span class="text-warn">None found</span>
              }
            </dd>
            <dt class="text-ink-muted">Education</dt>
            <dd class="min-w-0">
              @for (e of res.resume.education; track $index) {
                <div class="break-words">
                  {{ e.degree || 'No degree' }}
                  <span class="text-ink-muted"
                    >· {{ e.institution || 'no institution' }}
                    {{ e.year ? '· ' + e.year : '' }}</span
                  >
                </div>
              } @empty {
                <span class="text-ink-muted">—</span>
              }
            </dd>
            @if (res.resume.projects.length) {
              <dt class="text-ink-muted">Projects</dt>
              <dd class="min-w-0 break-words">
                {{ projectNames() }}
              </dd>
            }
            @if (res.resume.certifications.length) {
              <dt class="text-ink-muted">Certifications</dt>
              <dd class="min-w-0 break-words">
                {{ res.resume.certifications.join(' · ') }}
              </dd>
            }
          </dl>

          @if (res.warnings.length) {
            <ul class="list-disc pl-5 text-sm text-warn">
              @for (w of res.warnings; track w) {
                <li>{{ w }}</li>
              }
            </ul>
          }
          <p class="text-xs text-ink-muted">
            Something wrong? Fix the text above and press Parse again, or
            correct it in the editor after importing.
          </p>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="jb-btn-primary"
              (click)="imported.emit({ sections: res.resume, mode: 'replace' })"
            >
              Replace master with this
            </button>
            <button
              type="button"
              class="jb-btn"
              (click)="imported.emit({ sections: res.resume, mode: 'fill' })"
            >
              Fill only the empty sections
            </button>
          </div>
          <p class="text-xs text-ink-muted">
            Either way nothing is saved until you press Save version.
          </p>
        </div>
      }
    </div>
  `,
})
export class ResumeImportPanel {
  readonly dragging = signal(false);
  readonly imported = output<{
    sections: ResumeSections;
    mode: 'replace' | 'fill';
  }>();
  readonly closed = output<void>();

  readonly text = signal('');
  readonly fileName = signal('');
  readonly busy = signal(false);
  readonly error = signal('');
  readonly result = signal<ResumeImport | null>(null);
  readonly hasResult = computed(() => this.result() !== null);
  readonly skillCount = computed(
    () =>
      this.result()?.resume.skills.reduce((n, g) => n + g.items.length, 0) ?? 0,
  );
  readonly contactLine = computed(() => {
    const c = this.result()?.resume.contact;
    if (!c) return '';
    return [
      c.email,
      c.phone,
      c.location,
      c.website,
      ...c.links.map((l) => l.url),
    ]
      .filter(Boolean)
      .join(' · ');
  });
  readonly projectNames = computed(
    () =>
      this.result()
        ?.resume.projects.map((p) => p.name || p.url)
        .join(' · ') ?? '',
  );

  fmt(value: string): string {
    return formatResumeDate(value);
  }

  async onFile(file: File | undefined) {
    if (!file) return;
    this.error.set('');
    this.result.set(null);
    this.fileName.set(file.name);
    this.busy.set(true);
    try {
      this.text.set(await readFile(file));
      this.parse();
    } catch (e) {
      this.error.set((e as Error).message || 'Could not read that file.');
    } finally {
      this.busy.set(false);
    }
  }

  parse() {
    const t = this.text().trim();
    if (!t) return;
    this.error.set('');
    this.result.set(parseResumeText(t));
  }
}

async function readFile(file: File): Promise<string> {
  if (file.size > MAX_BYTES)
    throw new Error('That file is over 10 MB; a resume should be far smaller.');
  const name = file.name.toLowerCase();
  if (name.endsWith('.docx')) return readDocx(file);
  if (name.endsWith('.pdf') || file.type === 'application/pdf')
    return readPdf(file);
  if (name.endsWith('.doc'))
    throw new Error(
      'Old .doc files are not supported; save it as .docx or PDF first.',
    );
  if (/\.(pages|odt|rtf)$/.test(name))
    throw new Error(
      'That format is not supported; export it as .docx or PDF first.',
    );
  if (/^image\//.test(file.type))
    throw new Error(
      'That is an image, so there is no text to read. Export your resume as PDF or .docx, or paste the text.',
    );
  const text = await file.text();
  // A binary file picked by mistake reads as mojibake; say so instead.
  if (looksBinary(text.slice(0, 2000)))
    throw new Error('That file is not plain text. Pick a .docx, PDF or .txt.');
  return text;
}

function looksBinary(sample: string): boolean {
  let odd = 0;
  for (const ch of sample) {
    const c = ch.charCodeAt(0);
    if (c < 9 || (c > 13 && c < 32) || c === 0xfffd) odd++;
  }
  return odd > sample.length * 0.02;
}

async function readDocx(file: File): Promise<string> {
  // mammoth ships CommonJS; the bundler hands it over as the default export.
  const mod = (await import('mammoth')) as unknown as {
    default?: typeof import('mammoth');
  } & typeof import('mammoth');
  const mammoth = mod.default ?? mod;
  const arrayBuffer = await file.arrayBuffer();
  try {
    // HTML keeps headings, bullets and table cells that raw text flattens.
    const { value } = await mammoth.convertToHtml({ arrayBuffer });
    const text = htmlToResumeText(value);
    if (text.trim()) return text;
  } catch {
    /* fall back to raw text below */
  }
  const { value } = await mammoth.extractRawText({ arrayBuffer });
  if (!value.trim())
    throw new Error(
      'That .docx has no text in it (it may hold only images). Paste the text instead.',
    );
  return value;
}

async function readPdf(file: File): Promise<string> {
  // The legacy build carries polyfills; the modern one calls JavaScript
  // methods (Promise.try, Math.sumPrecise, Map#getOrInsertComputed) that
  // many browsers do not ship yet and fails before reading a word.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  let doc;
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      verbosity: 0,
    }).promise;
  } catch (e) {
    const kind = (e as { name?: string }).name;
    if (kind === 'PasswordException')
      throw new Error(
        'That PDF is password-protected. Save an unlocked copy, or paste the text.',
      );
    if (kind === 'InvalidPDFException')
      throw new Error('That file is not a valid PDF.');
    throw new Error('Could not open that PDF. Try .docx, or paste the text.');
  }
  const pages: PdfTextPage[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    pages.push({
      width: viewport.width,
      height: viewport.height,
      items: content.items.flatMap((item) =>
        'str' in item
          ? [
              {
                str: item.str,
                x: item.transform[4],
                y: item.transform[5],
                width: item.width,
                height:
                  item.height ||
                  Math.hypot(item.transform[2], item.transform[3]),
              },
            ]
          : [],
      ),
    });
  }
  await doc.destroy();
  const text = pdfPagesToText(pages);
  if (text.replace(/\s/g, '').length < 40)
    throw new Error(
      'That PDF has no selectable text (probably a scan or an image export). Export it again as text, or paste the text instead.',
    );
  return text;
}
