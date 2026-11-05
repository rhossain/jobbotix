import { formatResumeDate, type ResumeSections } from '@jobbotix/shared-types';
import { resumeRgb } from './resume-palette';

/**
 * One-click PDF of a resume, drawn as real text with jsPDF (lazy-loaded) so
 * ATS parsers can read it. Mirrors the single-page preview layout: name,
 * headline, contact line, then sections with a rule under each heading.
 * Overflows onto a second page rather than shrinking text.
 */
export async function downloadResumePdf(
  r: ResumeSections,
  filename: string,
): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 46; // margin
  const width = W - M * 2;
  const brand = resumeRgb('accent');
  const ink = resumeRgb('ink');
  const muted = resumeRgb('muted');
  const rule = resumeRgb('rule');
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
      color?: [number, number, number];
      x?: number;
      maxWidth?: number;
      lineHeight?: number;
    } = {},
  ) => {
    if (!s) return;
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...(opts.color ?? ink));
    const lh = opts.lineHeight ?? size * 1.32;
    const lines = doc.splitTextToSize(s, opts.maxWidth ?? width) as string[];
    for (const line of lines) {
      ensure(lh);
      doc.text(line, opts.x ?? M, y + size * 0.85);
      y += lh;
    }
  };
  const heading = (s: string) => {
    ensure(26);
    y += 8;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...muted);
    doc.text(s.toUpperCase(), M, y + 7, { charSpace: 0.8 });
    y += 11;
    doc.setDrawColor(...rule);
    doc.setLineWidth(0.6);
    doc.line(M, y, W - M, y);
    y += 6;
  };
  const bullet = (s: string) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...ink);
    const lines = doc.splitTextToSize(s, width - 14) as string[];
    const lh = 9.5 * 1.32;
    for (let i = 0; i < lines.length; i++) {
      ensure(lh);
      if (i === 0) doc.text('•', M + 3, y + 8);
      doc.text(lines[i], M + 14, y + 8);
      y += lh;
    }
  };
  /** Left text with a right-aligned muted note on the same line. */
  const row = (left: string, right: string, size: number, bold: boolean) => {
    ensure(size * 1.4);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...ink);
    const rightW = right ? doc.getTextWidth(right) + 8 : 0;
    const leftLines = doc.splitTextToSize(left, width - rightW) as string[];
    doc.text(leftLines[0] ?? '', M, y + size * 0.85);
    if (right) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(size - 1);
      doc.setTextColor(...muted);
      doc.text(right, W - M, y + size * 0.85, { align: 'right' });
    }
    y += size * 1.4;
    for (const extra of leftLines.slice(1)) {
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(size);
      doc.setTextColor(...ink);
      doc.text(extra, M, y + size * 0.85);
      y += size * 1.4;
    }
  };

  // Header
  text(r.contact.name, 20, { bold: true, lineHeight: 24 });
  text(r.contact.headline, 11, { color: brand, lineHeight: 15 });
  const contact = [
    r.contact.location,
    r.contact.email,
    r.contact.phone,
    r.contact.website,
    ...r.contact.links.map((l) => l.url.replace(/^https?:\/\//, '')),
  ]
    .filter(Boolean)
    .join('  ·  ');
  text(contact, 8.5, { color: muted, lineHeight: 12 });

  if (r.summary) {
    heading('Summary');
    text(r.summary, 9.5);
  }
  if (r.skills.length) {
    heading('Skills');
    for (const g of r.skills) {
      if (!g.items.length) continue;
      ensure(14);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(...ink);
      const label = g.name ? `${g.name}: ` : '';
      doc.text(label, M, y + 8);
      const lw = doc.getTextWidth(label);
      doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(
        g.items.join(', '),
        width - lw,
      ) as string[];
      doc.text(lines[0] ?? '', M + lw, y + 8);
      y += 12.5;
      for (const extra of lines.slice(1)) {
        ensure(12.5);
        doc.text(extra, M + lw, y + 8);
        y += 12.5;
      }
    }
  }
  if (r.experience.length) {
    heading('Experience');
    for (const e of r.experience) {
      row(
        e.title,
        `${formatResumeDate(e.start)} – ${formatResumeDate(e.end)}`,
        10.5,
        true,
      );
      text([e.company, e.location].filter(Boolean).join(' · '), 9.5, {
        color: muted,
        lineHeight: 12,
      });
      for (const b of e.bullets) bullet(b);
      y += 4;
    }
  }
  if (r.projects.length) {
    heading('Projects');
    for (const p of r.projects) {
      row(p.name, p.stack.join(', '), 10, true);
      const desc = [p.description, p.url.replace(/^https?:\/\//, '')]
        .filter(Boolean)
        .join(' — ');
      text(desc, 9.5);
      y += 3;
    }
  }
  if (r.aiToolkit.length) {
    heading('AI toolkit');
    text(r.aiToolkit.join(', '), 9.5);
  }
  if (r.education.length) {
    heading('Education');
    for (const ed of r.education)
      row(
        [ed.degree, ed.institution].filter(Boolean).join(', '),
        ed.year,
        9.5,
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
  doc.save(filename);
}

export function resumeFilename(r: ResumeSections, suffix = ''): string {
  const base = (r.contact.name || 'resume')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${base}${suffix ? `-${suffix.replace(/[^A-Za-z0-9]+/g, '-')}` : ''}-resume.pdf`;
}
