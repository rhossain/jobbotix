import { formatResumeDate, type ResumeSections } from '@jobbotix/shared-types';
import type { jsPDF as JsPdf } from 'jspdf';
import { pdfSafeResume } from './pdf-text';
import { ON_BANNER, PHOTO, rgb, templateOf } from './resume-templates';

/**
 * A resume as a PDF, drawn as real text with jsPDF (lazy-loaded) so ATS
 * parsers can read it, in the template chosen (resume-templates.ts). Every
 * template is one column in the same order: name, headline, contact line,
 * then the sections under standard headings. It overflows onto a second
 * page rather than shrinking text.
 */
export async function buildResumePdf(
  resume: ResumeSections,
  templateId?: string | null,
  /** The account's photo (a JPEG data URL), for a template that shows one. */
  photo?: string | null,
): Promise<{ doc: JsPdf; dropped: string[] }> {
  const { resume: r, dropped } = pdfSafeResume(resume);
  const t = templateOf(templateId);
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = t.margin;
  const width = W - M * 2;
  const k = t.scale;
  const face = t.font === 'serif' ? 'times' : 'helvetica';
  const accent = rgb(t.accent);
  const ink = rgb(t.ink);
  const muted = rgb(t.muted);
  const rule = rgb(t.rule);
  type Rgb = [number, number, number];
  let y = M;

  const ensure = (needed: number) => {
    if (y + needed > H - M) {
      doc.addPage();
      y = M;
    }
  };
  const text = (
    s: string,
    size: number,
    opts: {
      bold?: boolean;
      italic?: boolean;
      color?: Rgb;
      center?: boolean;
      lineHeight?: number;
      /** Narrower than the page, for text beside the photo. */
      maxWidth?: number;
    } = {},
  ) => {
    if (!s) return;
    doc.setFont(face, opts.bold ? 'bold' : opts.italic ? 'italic' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...(opts.color ?? ink));
    const lh = opts.lineHeight ?? size * 1.32;
    const lines = doc.splitTextToSize(s, opts.maxWidth ?? width) as string[];
    for (const line of lines) {
      ensure(lh);
      if (opts.center)
        doc.text(line, W / 2, y + size * 0.85, { align: 'center' });
      else doc.text(line, M, y + size * 0.85);
      y += lh;
    }
  };
  const heading = (s: string) => {
    const label = s.toUpperCase();
    ensure(26 * k);
    y += (t.heading === 'plain' ? 6 : 8) * k;
    const size = (t.heading === 'rule' || t.heading === 'plain' ? 8.5 : 9) * k;
    const space = t.heading === 'center' ? 1.4 : 0.8;
    doc.setFont(face, 'bold');
    doc.setFontSize(size);
    doc.setTextColor(
      ...(t.heading === 'rule' ? muted : t.heading === 'accent' ? accent : ink),
    );
    // Centred by hand: jsPDF's own centring ignores the letter spacing.
    const x =
      t.heading === 'center'
        ? (W - (doc.getTextWidth(label) + space * (label.length - 1))) / 2
        : M;
    doc.text(label, x, y + 7 * k, { charSpace: space });
    y += 11 * k;
    if (t.heading === 'plain') {
      y += 1;
      return;
    }
    doc.setDrawColor(...(t.heading === 'accent' ? accent : rule));
    doc.setLineWidth(t.heading === 'accent' ? 1.1 : 0.6);
    doc.line(M, y, W - M, y);
    y += 6 * k;
  };
  const bullet = (s: string) => {
    const size = 9.5 * k;
    doc.setFont(face, 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...ink);
    const lines = doc.splitTextToSize(s, width - 14) as string[];
    const lh = size * 1.32;
    for (let i = 0; i < lines.length; i++) {
      ensure(lh);
      if (i === 0) doc.text('•', M + 3, y + size * 0.85);
      doc.text(lines[i], M + 14, y + size * 0.85);
      y += lh;
    }
  };
  /** Left text with a right-aligned muted note on the same line. */
  const row = (left: string, right: string, size: number, bold: boolean) => {
    ensure(size * 1.4);
    doc.setFont(face, bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...ink);
    const rightW = right ? doc.getTextWidth(right) + 8 : 0;
    const leftLines = doc.splitTextToSize(left, width - rightW) as string[];
    doc.text(leftLines[0] ?? '', M, y + size * 0.85);
    if (right) {
      doc.setFont(face, 'normal');
      doc.setFontSize(size - 1);
      doc.setTextColor(...muted);
      doc.text(right, W - M, y + size * 0.85, { align: 'right' });
    }
    y += size * 1.4;
    for (const extra of leftLines.slice(1)) {
      doc.setFont(face, bold ? 'bold' : 'normal');
      doc.setFontSize(size);
      doc.setTextColor(...ink);
      doc.text(extra, M, y + size * 0.85);
      y += size * 1.4;
    }
  };

  // Header
  const contactParts = [
    r.contact.location,
    r.contact.email,
    r.contact.phone,
    r.contact.website,
    ...r.contact.links.map((l) => l.url.replace(/^https?:\/\//, '')),
  ].filter(Boolean);
  const contact = contactParts.join('  ·  ');
  const nameSize = 20 * k;
  const headlineSize = 11 * k;
  const contactSize = 8.5 * k;
  const nameLh = 24 * k;
  const headlineLh = 15 * k;
  const contactLh = 12 * k;
  const center = t.header === 'center';
  if (t.header === 'banner') {
    // The band is drawn first, sized to the lines the header will take.
    const lines = (s: string, size: number, bold = false) => {
      if (!s) return 0;
      doc.setFont(face, bold ? 'bold' : 'normal');
      doc.setFontSize(size);
      return (doc.splitTextToSize(s, width) as string[]).length;
    };
    const pad = 22 * k;
    const band =
      pad * 2 +
      lines(r.contact.name, nameSize, true) * nameLh +
      lines(r.contact.headline, headlineSize) * headlineLh +
      lines(contact, contactSize) * contactLh;
    doc.setFillColor(...accent);
    doc.rect(0, 0, W, band, 'F');
    y = pad;
    text(r.contact.name, nameSize, {
      bold: true,
      color: rgb(ON_BANNER.strong),
      lineHeight: nameLh,
    });
    text(r.contact.headline, headlineSize, {
      color: rgb(ON_BANNER.soft),
      lineHeight: headlineLh,
    });
    text(contact, contactSize, {
      color: rgb(ON_BANNER.soft),
      lineHeight: contactLh,
    });
    y = band + 6 * k;
  } else if (t.photo) {
    // The portrait top right; the name and one contact detail a line beside
    // it. The picture is the only image in the file: all the text is text.
    const top = y;
    const beside = photo ? width - PHOTO.width - 14 : width;
    if (photo) {
      doc.addImage(
        photo,
        'JPEG',
        W - M - PHOTO.width,
        top,
        PHOTO.width,
        PHOTO.height,
      );
      doc.setDrawColor(...rule);
      doc.setLineWidth(0.6);
      doc.rect(W - M - PHOTO.width, top, PHOTO.width, PHOTO.height);
    }
    text(r.contact.name, nameSize, {
      bold: true,
      lineHeight: nameLh,
      maxWidth: beside,
    });
    text(r.contact.headline, headlineSize, {
      color: accent,
      lineHeight: headlineLh + 2,
      maxWidth: beside,
    });
    for (const part of contactParts)
      text(part, contactSize + 0.5, {
        color: muted,
        lineHeight: contactLh,
        maxWidth: beside,
      });
    if (photo) y = Math.max(y, top + PHOTO.height);
    y += 4 * k;
  } else {
    text(r.contact.name, nameSize, {
      bold: true,
      center,
      color: t.heading === 'accent' ? accent : ink,
      lineHeight: nameLh,
    });
    text(r.contact.headline, headlineSize, {
      center,
      italic: center,
      color: accent,
      lineHeight: headlineLh,
    });
    text(contact, contactSize, { center, color: muted, lineHeight: contactLh });
  }

  const body = 9.5 * k;
  if (r.summary) {
    heading('Summary');
    text(r.summary, body);
  }
  if (r.skills.length) {
    heading('Skills');
    const lh = body * 1.32;
    for (const g of r.skills) {
      if (!g.items.length) continue;
      ensure(lh);
      doc.setFont(face, 'bold');
      doc.setFontSize(body);
      doc.setTextColor(...ink);
      const label = g.name ? `${g.name}: ` : '';
      doc.text(label, M, y + body * 0.85);
      const lw = doc.getTextWidth(label);
      doc.setFont(face, 'normal');
      const lines = doc.splitTextToSize(
        g.items.join(', '),
        width - lw,
      ) as string[];
      doc.text(lines[0] ?? '', M + lw, y + body * 0.85);
      y += lh;
      for (const extra of lines.slice(1)) {
        ensure(lh);
        doc.text(extra, M + lw, y + body * 0.85);
        y += lh;
      }
    }
  }
  if (r.experience.length) {
    heading('Experience');
    for (const e of r.experience) {
      row(
        e.title,
        `${formatResumeDate(e.start)} – ${formatResumeDate(e.end)}`,
        10.5 * k,
        true,
      );
      text([e.company, e.location].filter(Boolean).join(' · '), body, {
        color: muted,
        lineHeight: 12 * k,
      });
      for (const b of e.bullets) bullet(b);
      y += 4 * k;
    }
  }
  if (r.projects.length) {
    heading('Projects');
    for (const p of r.projects) {
      row(p.name, p.stack.join(', '), 10 * k, true);
      const desc = [p.description, p.url.replace(/^https?:\/\//, '')]
        .filter(Boolean)
        .join(' — ');
      text(desc, body);
      y += 3 * k;
    }
  }
  if (r.aiToolkit.length) {
    heading('AI toolkit');
    text(r.aiToolkit.join(', '), body);
  }
  if (r.education.length) {
    heading('Education');
    for (const ed of r.education)
      row(
        [ed.degree, ed.institution].filter(Boolean).join(', '),
        ed.year,
        body,
        false,
      );
  }
  if (r.certifications.length) {
    heading('Certifications');
    for (const c of r.certifications) bullet(c);
  }

  doc.setProperties({
    title: `${r.contact.name || 'Resume'}`,
    author: r.contact.name,
    creator: 'Jobbotix',
  });
  return { doc, dropped };
}

/**
 * One-click download of the resume PDF. Resolves with the characters the
 * PDF font could not show and so left out (see pdf-text.ts); empty for
 * nearly every resume.
 */
export async function downloadResumePdf(
  resume: ResumeSections,
  filename: string,
  templateId?: string | null,
  photo?: string | null,
): Promise<string[]> {
  const { doc, dropped } = await buildResumePdf(resume, templateId, photo);
  doc.save(filename);
  return dropped;
}

export function resumeFilename(r: ResumeSections, suffix = ''): string {
  const base = (r.contact.name || 'resume')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${base}${suffix ? `-${suffix.replace(/[^A-Za-z0-9]+/g, '-')}` : ''}-resume.pdf`;
}
