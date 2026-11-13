import { formatResumeDate, type ResumeSections } from '@jobbotix/shared-types';
import { ON_BANNER, templateOf } from './resume-templates';

/**
 * A resume as a Word file (.docx), for the employers and agencies that ask
 * for one and for editing by hand afterwards.
 *
 * It follows resume-pdf.ts: one column of real text in the same order under
 * the same headings, in the chosen template's font, colours and heading
 * style. Headings are Word headings and bullets are a Word list, so both a
 * person editing it and an applicant tracking system find the structure.
 * Two things the PDF has are left out: the photo, and an exact page fit,
 * which is Word's to decide.
 *
 * A .docx is a zip of XML parts. Both are written here by hand: the parts
 * are small, and it keeps a document library out of the bundle.
 */
export function buildResumeDocx(
  resume: ResumeSections,
  templateId?: string | null,
): Uint8Array {
  const r = resume;
  const t = templateOf(templateId);
  const k = t.scale;
  /** Half-points, Word's unit for type size. */
  const hp = (pt: number) => Math.round(pt * k * 2);
  /** Twentieths of a point, Word's unit for lengths. */
  const tw = (pt: number) => Math.round(pt * 20);
  const hex = (c: string) => c.replace('#', '').toUpperCase();
  const font = t.font === 'serif' ? 'Times New Roman' : 'Arial';
  const banner = t.header === 'banner';
  const centred = t.header === 'center';
  const PAGE_W = 11906; // A4, as the PDF
  const PAGE_H = 16838;
  const margin = tw(t.margin);
  const textWidth = PAGE_W - margin * 2;

  // Links are relationships of the document part; each gets an id.
  const links: string[] = [];
  const linkId = (url: string) => {
    let i = links.indexOf(url);
    if (i < 0) i = links.push(url) - 1;
    return `rLink${i + 1}`;
  };

  interface RunOpts {
    bold?: boolean;
    italic?: boolean;
    /** Points, before the template's scale. */
    size?: number;
    color?: string;
    url?: string;
  }
  const run = (text: string, o: RunOpts = {}): string => {
    if (!text) return '';
    const props =
      (o.bold ? '<w:b/><w:bCs/>' : '') +
      (o.italic ? '<w:i/><w:iCs/>' : '') +
      (o.color ? `<w:color w:val="${hex(o.color)}"/>` : '') +
      (o.size
        ? `<w:sz w:val="${hp(o.size)}"/><w:szCs w:val="${hp(o.size)}"/>`
        : '');
    const body = `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
    return o.url
      ? `<w:hyperlink r:id="${linkId(o.url)}" w:history="1">${body}</w:hyperlink>`
      : body;
  };
  const TAB = '<w:r><w:tab/></w:r>';

  interface ParaOpts {
    style?: string;
    center?: boolean;
    /** Space above and below, in points. */
    before?: number;
    after?: number;
    /** A tab stop at the right edge, for a date opposite a title. */
    rightTab?: boolean;
    bullet?: boolean;
    keepNext?: boolean;
    /** Fills the paragraph's background (the banner header). */
    fill?: string;
  }
  const para = (runs: string, o: ParaOpts = {}): string => {
    const props =
      (o.style ? `<w:pStyle w:val="${o.style}"/>` : '') +
      (o.keepNext ? '<w:keepNext/>' : '') +
      (o.bullet
        ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'
        : '') +
      (o.fill
        ? `<w:shd w:val="clear" w:color="auto" w:fill="${hex(o.fill)}"/>`
        : '') +
      (o.rightTab
        ? `<w:tabs><w:tab w:val="right" w:pos="${textWidth}"/></w:tabs>`
        : '') +
      (o.before !== undefined || o.after !== undefined
        ? `<w:spacing w:before="${tw((o.before ?? 0) * k)}" w:after="${tw((o.after ?? 0) * k)}"/>`
        : '') +
      // Text on a filled band stands in from its edges.
      (o.fill ? `<w:ind w:left="${tw(8)}" w:right="${tw(8)}"/>` : '') +
      (o.center ? '<w:jc w:val="center"/>' : '');
    // (Word reads these properties in a fixed order; keep it when adding one.)
    return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${runs}</w:p>`;
  };

  const href = (url: string) =>
    /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
  const bare = (url: string) => url.replace(/^https?:\/\//, '');
  const body: string[] = [];

  // Header: name, headline, one line of contact details with live links.
  const onBanner = banner ? { fill: t.accent } : {};
  const strong = banner ? ON_BANNER.strong : t.ink;
  const soft = banner ? ON_BANNER.soft : t.muted;
  if (r.contact.name)
    body.push(
      para(
        run(r.contact.name, {
          color: !banner && t.heading === 'accent' ? t.accent : strong,
        }),
        {
          style: 'Title',
          center: centred,
          before: banner ? 6 : 0,
          ...onBanner,
        },
      ),
    );
  if (r.contact.headline)
    body.push(
      para(
        run(r.contact.headline, {
          size: 11.5,
          italic: centred,
          color: banner ? ON_BANNER.soft : t.accent,
        }),
        { center: centred, after: 2, ...onBanner },
      ),
    );
  const contact: { text: string; url?: string }[] = [
    { text: r.contact.location },
    {
      text: r.contact.email,
      url: r.contact.email ? `mailto:${r.contact.email}` : undefined,
    },
    { text: r.contact.phone },
    {
      text: bare(r.contact.website),
      url: r.contact.website ? href(r.contact.website) : undefined,
    },
    ...r.contact.links
      .filter((l) => l.url)
      .map((l) => ({ text: bare(l.url), url: href(l.url) })),
  ].filter((p) => p.text);
  if (contact.length)
    body.push(
      para(
        contact
          .map(
            (p, i) =>
              (i ? run('  ·  ', { size: 9, color: soft }) : '') +
              run(p.text, { size: 9, color: soft, url: p.url }),
          )
          .join(''),
        { center: centred, after: banner ? 8 : 4, ...onBanner },
      ),
    );

  const heading = (label: string) =>
    body.push(para(run(label.toUpperCase()), { style: 'Heading1' }));
  const bullet = (text: string) => {
    if (text.trim()) body.push(para(run(text), { bullet: true }));
  };
  /** A bold or plain left part with a muted right part on the same line. */
  const row = (left: string, right: string, size: number, bold: boolean) => {
    if (!left && !right) return;
    body.push(
      para(
        run(left, { bold, size }) +
          (right ? TAB + run(right, { size: size - 1, color: t.muted }) : ''),
        { rightTab: true, keepNext: bold, before: bold ? 5 : 0 },
      ),
    );
  };

  if (r.summary) {
    heading('Summary');
    body.push(para(run(r.summary)));
  }
  if (r.skills.some((g) => g.items.length)) {
    heading('Skills');
    for (const g of r.skills) {
      if (!g.items.length) continue;
      body.push(
        para(
          (g.name ? run(`${g.name}: `, { bold: true }) : '') +
            run(g.items.join(', ')),
        ),
      );
    }
  }
  if (r.experience.length) {
    heading('Experience');
    for (const e of r.experience) {
      const dates = [formatResumeDate(e.start), formatResumeDate(e.end)]
        .filter(Boolean)
        .join(' – ');
      row(e.title, dates, 10.5, true);
      const where = [e.company, e.location].filter(Boolean).join(' · ');
      if (where)
        body.push(para(run(where, { color: t.muted }), { keepNext: true }));
      for (const b of e.bullets) bullet(b);
    }
  }
  if (r.projects.length) {
    heading('Projects');
    for (const p of r.projects) {
      if (p.name || p.stack.length)
        body.push(
          para(
            run(p.name, {
              bold: true,
              size: 10,
              url: p.url ? href(p.url) : undefined,
            }) +
              (p.stack.length
                ? TAB + run(p.stack.join(', '), { size: 9, color: t.muted })
                : ''),
            { rightTab: true, keepNext: true, before: 5 },
          ),
        );
      const desc = [p.description, bare(p.url)].filter(Boolean).join(' — ');
      if (desc) body.push(para(run(desc)));
    }
  }
  if (r.aiToolkit.length) {
    heading('AI toolkit');
    body.push(para(run(r.aiToolkit.join(', '))));
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
  if (r.certifications.some((c) => c.trim())) {
    heading('Certifications');
    for (const c of r.certifications) bullet(c);
  }

  const NS =
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const documentXml = `${HEAD}<w:document ${NS}><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="${PAGE_W}" w:h="${PAGE_H}"/><w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  // Section headings, by template: small grey capitals over a hairline,
  // accent capitals over a heavier line, centred capitals, or plain bold.
  const headingColor =
    t.heading === 'rule' ? t.muted : t.heading === 'accent' ? t.accent : t.ink;
  const headingBorder =
    t.heading === 'rule'
      ? `<w:pBdr><w:bottom w:val="single" w:sz="4" w:space="2" w:color="${hex(t.rule)}"/></w:pBdr>`
      : t.heading === 'accent'
        ? `<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="2" w:color="${hex(t.accent)}"/></w:pBdr>`
        : '';
  const headingSize = t.heading === 'rule' || t.heading === 'plain' ? 8.5 : 9;
  const fonts = `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}"/>`;
  const styles = `${HEAD}<w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr>${fonts}<w:color w:val="${hex(t.ink)}"/><w:sz w:val="${hp(9.5)}"/><w:szCs w:val="${hp(9.5)}"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="${tw(2 * k)}" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="${tw(2 * k)}"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="${hp(21)}"/><w:szCs w:val="${hp(21)}"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/>${headingBorder}<w:spacing w:before="${tw(11 * k)}" w:after="${tw(4 * k)}"/>${t.heading === 'center' ? '<w:jc w:val="center"/>' : ''}<w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:bCs/><w:color w:val="${hex(headingColor)}"/><w:spacing w:val="${t.heading === 'center' ? 28 : 16}"/><w:sz w:val="${hp(headingSize)}"/><w:szCs w:val="${hp(headingSize)}"/></w:rPr></w:style><w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/></w:style></w:styles>`;

  const numbering = `${HEAD}<w:numbering ${NS}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${tw(14)}" w:hanging="${tw(10)}"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;

  const REL =
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const PKG = 'http://schemas.openxmlformats.org/package/2006';
  const documentRels = `${HEAD}<Relationships xmlns="${PKG}/relationships"><Relationship Id="rStyles" Type="${REL}/styles" Target="styles.xml"/><Relationship Id="rNumbering" Type="${REL}/numbering" Target="numbering.xml"/>${links
    .map(
      (url, i) =>
        `<Relationship Id="rLink${i + 1}" Type="${REL}/hyperlink" Target="${xml(url)}" TargetMode="External"/>`,
    )
    .join('')}</Relationships>`;
  const rootRels = `${HEAD}<Relationships xmlns="${PKG}/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="${PKG}/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
  const contentTypes = `${HEAD}<Types xmlns="${PKG}/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="${WML}.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="${WML}.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="${WML}.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  const core = `${HEAD}<cp:coreProperties xmlns:cp="${PKG}/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml([r.contact.name, 'Resume'].filter(Boolean).join(' - '))}</dc:title><dc:subject>${xml(r.contact.headline)}</dc:subject><dc:creator>${xml(r.contact.name)}</dc:creator></cp:coreProperties>`;

  return zipStore([
    // Word wants the content types first.
    { name: '[Content_Types].xml', text: contentTypes },
    { name: '_rels/.rels', text: rootRels },
    { name: 'word/document.xml', text: documentXml },
    { name: 'word/styles.xml', text: styles },
    { name: 'word/numbering.xml', text: numbering },
    { name: 'word/_rels/document.xml.rels', text: documentRels },
    { name: 'docProps/core.xml', text: core },
  ]);
}

/** Text as XML content: escaped, and without what XML 1.0 cannot hold. */
export function xml(text: string): string {
  return (
    text
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  );
}

let crcTable: Uint32Array | undefined;
/** CRC-32 as zip uses it. */
export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * A zip archive of text files, stored without compression: every reader of
 * .docx accepts it, and a resume's XML is a few kilobytes either way.
 */
export function zipStore(files: { name: string; text: string }[]): Uint8Array {
  const enc = new TextEncoder();
  // 1 January 2026, noon: a fixed time, so the same resume gives the same file.
  const DOS_TIME = 12 << 11;
  const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = enc.encode(f.text);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // names are UTF-8
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, DOS_TIME, true);
    local.setUint16(12, DOS_DATE, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), name, data);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true); // version made by
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, 0, true);
    entry.setUint16(12, DOS_TIME, true);
    entry.setUint16(14, DOS_DATE, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + 22);
  let at = 0;
  for (const c of [...chunks, ...central, new Uint8Array(end.buffer)]) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** "Ada-Lovelace-Northwind-resume.docx", next to the PDF's name. */
export function docxFilename(pdfName: string): string {
  return pdfName.replace(/\.pdf$/i, '') + '.docx';
}

/** One-click download of the resume as a Word file. */
export function downloadResumeDocx(
  resume: ResumeSections,
  filename: string,
  templateId?: string | null,
): void {
  const bytes = buildResumeDocx(resume, templateId);
  const url = URL.createObjectURL(
    new Blob([bytes as BlobPart], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // After the click has been handled: revoking at once cancels some browsers' download.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
