import {
  ChangeDetectionStrategy,
  Component,
  computed,
  output,
  signal,
} from '@angular/core';
import {
  parseResumeText,
  type ResumeImport,
  type ResumeSections,
} from '@jobbotix/shared-types';

/** Reads a resume from pasted text, a .docx, a PDF or a text file and parses it. */
@Component({
  selector: 'jb-resume-import',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="jb-card flex flex-col gap-4 p-4">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 class="jb-section-title">Import a resume</h2>
          <p class="mt-1 text-sm text-ink-muted">
            Paste the text or pick a .docx, PDF or .txt. Nothing leaves your
            browser: the file is read and parsed here, and you review the result
            before it touches the master.
          </p>
        </div>
        <button type="button" class="jb-btn" (click)="closed.emit()">
          Close
        </button>
      </div>

      <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <textarea
          id="ri-text"
          class="jb-input min-h-40 font-mono text-xs"
          placeholder="Paste your resume text here…"
          [value]="text()"
          (input)="text.set($any($event.target).value)"
        ></textarea>
        <div class="flex flex-col gap-2">
          <label class="jb-btn cursor-pointer text-center">
            Choose file…
            <input
              id="ri-file"
              type="file"
              class="sr-only"
              accept=".docx,.pdf,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
              (change)="onFile($any($event.target).files?.[0])"
            />
          </label>
          <button
            type="button"
            class="jb-btn-primary"
            (click)="parse()"
            [disabled]="!text().trim() || busy()"
          >
            {{ busy() ? 'Reading…' : 'Parse' }}
          </button>
          @if (fileName()) {
            <span class="text-xs text-ink-muted">{{ fileName() }}</span>
          }
        </div>
      </div>

      @if (error()) {
        <p class="text-sm text-bad" role="alert">
          {{ error() }}
        </p>
      }

      @if (result(); as res) {
        <div class="flex flex-col gap-3 border-t border-line pt-3">
          <p class="text-sm">
            Found
            <b>{{ res.resume.contact.name || 'no name' }}</b>
            · {{ res.resume.skills.length }} skill groups ·
            {{ res.resume.experience.length }} roles ·
            {{ res.resume.projects.length }} projects ·
            {{ res.resume.education.length }} education entries ·
            {{ res.resume.certifications.length }} certifications
          </p>
          @if (res.warnings.length) {
            <ul class="list-disc pl-5 text-sm text-warn">
              @for (w of res.warnings; track w) {
                <li>{{ w }}</li>
              }
            </ul>
          }
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
  const name = file.name.toLowerCase();
  if (name.endsWith('.docx')) return readDocx(file);
  if (name.endsWith('.pdf') || file.type === 'application/pdf')
    return readPdf(file);
  if (name.endsWith('.doc'))
    throw new Error(
      'Old .doc files are not supported; save it as .docx or PDF first.',
    );
  return file.text();
}

async function readDocx(file: File): Promise<string> {
  // mammoth ships CommonJS; the bundler hands it over as the default export.
  const mod = (await import('mammoth')) as unknown as {
    default?: typeof import('mammoth');
  } & typeof import('mammoth');
  const mammoth = mod.default ?? mod;
  const { value } = await mammoth.extractRawText({
    arrayBuffer: await file.arrayBuffer(),
  });
  return value;
}

async function readPdf(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() })
    .promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // Rebuild lines from glyph runs: a new line when the baseline moves.
    let lastY: number | null = null;
    let line = '';
    const lines: string[] = [];
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const y = Math.round(item.transform[5]);
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        lines.push(line);
        line = '';
      }
      line += (line && !line.endsWith(' ') && item.str ? ' ' : '') + item.str;
      lastY = y;
    }
    if (line) lines.push(line);
    pages.push(lines.join('\n'));
  }
  const text = pages.join('\n\n').trim();
  if (!text)
    throw new Error(
      'That PDF has no selectable text (probably a scan). Paste the text instead.',
    );
  return text;
}
