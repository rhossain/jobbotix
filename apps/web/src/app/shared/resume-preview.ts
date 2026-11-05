import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { formatResumeDate, type ResumeSections } from '@jobbotix/shared-types';

/**
 * The single-page resume template. The same markup is what the browser
 * prints (Save as PDF), so it is plain HTML with its own print stylesheet
 * and no app chrome.
 */
@Component({
  selector: 'jb-resume-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="resume" [class.resume-print]="print()">
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
      --ink: #1b2026;
      --muted: #5d6771;
      --rule: #d9dedb;
      --accent: #0b5a5a;
      width: 100%;
      max-width: 210mm;
      margin: 0 auto;
      padding: 14mm 16mm;
      box-sizing: border-box;
      background: #fff;
      color: var(--ink);
      font:
        10.5pt/1.4 'IBM Plex Sans',
        'Segoe UI',
        system-ui,
        sans-serif;
      box-shadow:
        0 1px 3px rgb(0 0 0 / 0.12),
        0 8px 24px rgb(0 0 0 / 0.06);
    }
    .resume a {
      color: var(--accent);
      text-decoration: none;
    }
    .resume h1 {
      margin: 0;
      font-size: 20pt;
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
      font-size: 9.5pt;
    }
    .resume section {
      margin-top: 10pt;
    }
    .resume h2 {
      margin: 0 0 4pt;
      padding-bottom: 2pt;
      border-bottom: 1px solid var(--rule);
      font-size: 9pt;
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
      font-size: 9.5pt;
      white-space: nowrap;
    }
    @media print {
      .resume {
        box-shadow: none;
        max-width: none;
        padding: 0;
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
