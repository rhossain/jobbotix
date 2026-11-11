import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { formatResumeDate, type ResumeSections } from '@jobbotix/shared-types';
import {
  templateClasses,
  templateCssVars,
  templateOf,
} from './resume-templates';

/**
 * The resume on screen, in the template chosen (resume-templates.ts). The
 * same markup is what the browser prints (Save as PDF), so it is plain HTML
 * with its own print stylesheet and no app chrome. Every template is the
 * same single column in the same order; only the styling differs.
 */
@Component({
  selector: 'jb-resume-preview',
  host: { '[style]': 'vars()' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="resume" [class]="classes()" [class.resume-print]="print()">
      <header class="resume-head">
        <h1>{{ r().contact.name || 'Your name' }}</h1>
        @if (r().contact.headline) {
          <p class="resume-headline">{{ r().contact.headline }}</p>
        }
        <p class="resume-contact">
          @for (part of contactParts(); track $index) {
            @if ($index > 0) {
              <span aria-hidden="true"> · </span>
            }
            @if (part.url) {
              <a [href]="part.url">{{ part.text }}</a>
            } @else {
              <span>{{ part.text }}</span>
            }
          }
        </p>
      </header>

      @if (r().summary) {
        <section>
          <h2>Summary</h2>
          <p>{{ r().summary }}</p>
        </section>
      }

      @if (r().skills.length) {
        <section>
          <h2>Skills</h2>
          <dl class="resume-skills">
            @for (g of r().skills; track $index) {
              <div>
                <dt>{{ g.name }}</dt>
                <dd>{{ g.items.join(', ') }}</dd>
              </div>
            }
          </dl>
        </section>
      }

      @if (r().experience.length) {
        <section>
          <h2>Experience</h2>
          @for (e of r().experience; track $index) {
            <div class="resume-entry">
              <div class="resume-entry-head">
                <strong>{{ e.title }}</strong>
                <span class="resume-dates"
                  >{{ fmt(e.start) }} – {{ fmt(e.end) }}</span
                >
              </div>
              <div class="resume-entry-sub">
                {{ e.company }}{{ e.location ? ' · ' + e.location : '' }}
              </div>
              @if (e.bullets.length) {
                <ul>
                  @for (b of e.bullets; track $index) {
                    <li>{{ b }}</li>
                  }
                </ul>
              }
            </div>
          }
        </section>
      }

      @if (r().projects.length) {
        <section>
          <h2>Projects</h2>
          @for (p of r().projects; track $index) {
            <div class="resume-entry">
              <div class="resume-entry-head">
                <strong>
                  @if (p.url) {
                    <a [href]="p.url">{{ p.name }}</a>
                  } @else {
                    {{ p.name }}
                  }
                </strong>
                @if (p.stack.length) {
                  <span class="resume-dates">{{ p.stack.join(', ') }}</span>
                }
              </div>
              @if (p.description) {
                <p>{{ p.description }}</p>
              }
            </div>
          }
        </section>
      }

      @if (r().aiToolkit.length) {
        <section>
          <h2>AI toolkit</h2>
          <p>{{ r().aiToolkit.join(' · ') }}</p>
        </section>
      }

      @if (r().education.length || r().certifications.length) {
        <section>
          <h2>Education</h2>
          @for (e of r().education; track $index) {
            <div class="resume-entry-head">
              <span
                ><strong>{{ e.degree }}</strong
                >{{ e.institution ? ', ' + e.institution : '' }}</span
              >
              <span class="resume-dates">{{ e.year }}</span>
            </div>
          }
          @if (r().certifications.length) {
            <p>{{ r().certifications.join(' · ') }}</p>
          }
        </section>
      }
    </article>
  `,
  styles: `
    :host {
      display: block;
    }
    .resume {
      width: 100%;
      max-width: 210mm;
      margin: 0 auto;
      padding: var(--pad-y) var(--pad-x);
      box-sizing: border-box;
      background: var(--paper);
      color: var(--ink);
      font-family: var(--resume-font);
      font-size: calc(10.5pt * var(--scale));
      line-height: 1.4;
      box-shadow:
        0 1px 2px color-mix(in srgb, var(--ink) 10%, transparent),
        0 12px 32px -12px color-mix(in srgb, var(--ink) 22%, transparent);
    }
    .resume a {
      color: var(--accent);
      text-decoration: none;
    }
    .resume h1 {
      margin: 0;
      font-size: calc(20pt * var(--scale));
      font-weight: 600;
      letter-spacing: -0.01em;
    }
    .resume-headline {
      margin: 2px 0 0;
      color: var(--accent);
      font-weight: 500;
    }
    .resume-contact {
      margin: 4px 0 0;
      color: var(--muted);
      font-size: calc(9.5pt * var(--scale));
    }
    .resume section {
      margin-top: calc(10pt * var(--scale));
    }
    .resume h2 {
      margin: 0 0 4pt;
      padding-bottom: 2pt;
      border-bottom: 1px solid var(--rule);
      font-size: calc(9pt * var(--scale));
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .resume p {
      margin: 0;
    }
    .resume ul {
      margin: 2pt 0 0;
      padding-left: 14pt;
      list-style: disc;
    }
    .resume li {
      margin: 1pt 0;
    }
    .resume-skills {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 2pt 10pt;
      margin: 0;
    }
    .resume-skills div {
      display: contents;
    }
    .resume-skills dt {
      font-weight: 600;
    }
    .resume-skills dd {
      margin: 0;
    }
    .resume-entry {
      margin-top: 6pt;
    }
    .resume-entry:first-of-type {
      margin-top: 0;
    }
    .resume-entry-head {
      display: flex;
      justify-content: space-between;
      gap: 8pt;
      align-items: baseline;
    }
    .resume-entry-sub {
      color: var(--muted);
    }
    .resume-dates {
      color: var(--muted);
      font-size: calc(9.5pt * var(--scale));
      white-space: nowrap;
    }

    /* Header: centred */
    .resume--head-center .resume-head {
      text-align: center;
    }
    .resume--head-center .resume-headline {
      font-style: italic;
      font-weight: 400;
    }
    /* Header: the name on a filled band that runs to the page edges */
    .resume--head-banner .resume-head {
      margin: calc(var(--pad-y) * -1) calc(var(--pad-x) * -1) 0;
      padding: calc(var(--pad-y) * 0.8) var(--pad-x);
      background: var(--accent);
      color: var(--on-banner);
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;
    }
    .resume--head-banner .resume-headline,
    .resume--head-banner .resume-contact,
    .resume--head-banner .resume-contact a {
      color: var(--on-banner-soft);
    }

    /* Headings: accent capitals over a heavier line */
    .resume--h-accent h1 {
      font-weight: 700;
    }
    .resume--h-accent h2 {
      border-bottom: 1.5px solid var(--accent);
      color: var(--accent);
      font-size: calc(9.5pt * var(--scale));
      font-weight: 700;
    }
    .resume--h-accent.resume--head-left h1 {
      color: var(--accent);
    }
    /* Headings: centred capitals */
    .resume--h-center h2 {
      border-bottom: 1px solid var(--rule);
      color: var(--ink);
      font-size: calc(9.5pt * var(--scale));
      letter-spacing: 0.14em;
      text-align: center;
    }
    /* Headings: plain bold capitals, nothing drawn */
    .resume--h-plain h2 {
      margin-bottom: 2pt;
      padding-bottom: 0;
      border-bottom: 0;
      color: var(--ink);
      font-weight: 700;
    }
    .resume--h-plain section {
      margin-top: calc(7pt * var(--scale));
    }

    @media print {
      .resume {
        box-shadow: none;
        max-width: none;
        padding: 0;
      }
      .resume--head-banner .resume-head {
        margin: 0;
        padding: 10pt 12pt;
      }
      .resume section,
      .resume-entry {
        break-inside: avoid;
      }
    }
  `,
})
export class ResumePreview {
  readonly r = input.required<ResumeSections>();
  readonly print = input(false);
  /** The template's name; Classic when missing or unknown. */
  readonly template = input<string | null | undefined>(undefined);
  protected readonly vars = computed(() =>
    templateCssVars(templateOf(this.template())),
  );
  protected readonly classes = computed(() =>
    templateClasses(templateOf(this.template())),
  );

  fmt(v: string) {
    return formatResumeDate(v);
  }

  contactParts() {
    const c = this.r().contact;
    const parts: { text: string; url?: string }[] = [];
    if (c.location) parts.push({ text: c.location });
    if (c.email) parts.push({ text: c.email });
    if (c.phone) parts.push({ text: c.phone });
    if (c.website)
      parts.push({
        text: c.website.replace(/^https?:\/\//, ''),
        url: c.website,
      });
    for (const l of c.links)
      if (l.url)
        parts.push({
          text: l.label || l.url.replace(/^https?:\/\//, ''),
          url: l.url,
        });
    return parts;
  }
}
