import { emptyResume, type ResumeSections } from '@jobbotix/shared-types';
import {
  buildResumeDocx,
  crc32,
  docxFilename,
  xml,
  zipStore,
} from './resume-docx';
import { RESUME_TEMPLATES } from './resume-templates';

const RESUME: ResumeSections = {
  ...emptyResume(),
  contact: {
    name: 'Ada Lovelace',
    headline: 'Senior Frontend Engineer',
    email: 'ada@example.com',
    phone: '',
    location: 'Dhaka, Bangladesh',
    website: 'ada.dev',
    links: [{ label: 'GitHub', url: 'https://github.com/ada' }],
  },
  summary: 'R&D <lead> with "quotes"',
  skills: [
    { name: 'Frontend', items: ['Angular', 'TypeScript'] },
    { name: 'Empty', items: [] },
  ],
  experience: [
    {
      title: 'Senior Frontend Engineer',
      company: 'Northwind',
      location: 'Remote',
      start: '2020-01',
      end: '',
      bullets: ['Cut the bundle by 38%', '  '],
    },
  ],
  projects: [
    {
      name: 'Styloviz',
      url: 'styloviz.dev',
      description: 'A component library',
      stack: ['Angular', 'Tailwind'],
    },
  ],
  aiToolkit: ['Claude Code'],
  education: [
    { degree: 'B.Sc.', institution: 'Example University', year: '2010' },
  ],
  certifications: ['AWS Cloud Practitioner'],
};

/** The files of a stored zip, read back from its bytes. */
function unzip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  const out = new Map<string, string>();
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const size = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    const start = local + 30 + view.getUint16(local + 26, true);
    const data = bytes.subarray(start, start + size);
    expect(crc32(data)).toBe(view.getUint32(at + 16, true));
    out.set(name, dec.decode(data));
    at += 46 + nameLen;
  }
  return out;
}

const wellFormed = (text: string) =>
  new DOMParser()
    .parseFromString(text, 'application/xml')
    .getElementsByTagName('parsererror').length === 0;

describe('zipStore and crc32', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('writes files that read back unchanged, non-ASCII names and text included', () => {
    const files = [
      { name: 'a.txt', text: 'hello' },
      { name: 'dir/ü.xml', text: '<x>日本語</x>' },
    ];
    const back = unzip(zipStore(files));
    expect([...back]).toEqual(files.map((f) => [f.name, f.text]));
  });

  it('gives the same bytes for the same input', () => {
    const f = [{ name: 'a', text: 'b' }];
    expect(zipStore(f)).toEqual(zipStore(f));
  });
});

describe('xml', () => {
  it('escapes markup and drops what XML cannot hold', () => {
    expect(xml('R&D <b> "x"')).toBe('R&amp;D &lt;b&gt; &quot;x&quot;');
    expect(xml('a\u0000b\u000Bc\td\ne')).toBe('abc\td\ne');
  });
});

describe('buildResumeDocx', () => {
  const parts = unzip(buildResumeDocx(RESUME));
  const doc = parts.get('word/document.xml') ?? '';

  it('holds the parts Word needs, each well-formed XML', () => {
    expect([...parts.keys()]).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'word/document.xml',
      'word/styles.xml',
      'word/numbering.xml',
      'word/_rels/document.xml.rels',
      'docProps/core.xml',
    ]);
    for (const [name, text] of parts) expect(wellFormed(text), name).toBe(true);
  });

  it('writes every section as text, in the order of the PDF', () => {
    const order = [
      'Ada Lovelace',
      'Senior Frontend Engineer',
      'Dhaka, Bangladesh',
      'SUMMARY',
      'R&amp;D &lt;lead&gt; with &quot;quotes&quot;',
      'SKILLS',
      'Frontend: ',
      'Angular, TypeScript',
      'EXPERIENCE',
      'Jan 2020',
      'Northwind · Remote',
      'Cut the bundle by 38%',
      'PROJECTS',
      'Styloviz',
      'A component library — styloviz.dev',
      'AI TOOLKIT',
      'Claude Code',
      'EDUCATION',
      'B.Sc., Example University',
      'CERTIFICATIONS',
      'AWS Cloud Practitioner',
    ];
    let at = -1;
    for (const text of order) {
      const next = doc.indexOf(text, at + 1);
      expect(next, text).toBeGreaterThan(at);
      at = next;
    }
  });

  it('uses Word headings and a Word list, and skips empty groups and bullets', () => {
    expect(doc.match(/<w:pStyle w:val="Heading1"\/>/g)).toHaveLength(7);
    // one experience bullet and one certification; the blank bullet is left out
    expect(doc.match(/<w:numPr>/g)).toHaveLength(2);
    expect(doc).not.toContain('Empty');
  });

  it('makes the email, the site, the profile link and the project clickable', () => {
    const rels = parts.get('word/_rels/document.xml.rels') ?? '';
    for (const url of [
      'mailto:ada@example.com',
      'https://ada.dev',
      'https://github.com/ada',
      'https://styloviz.dev',
    ])
      expect(rels).toContain(`Target="${url}" TargetMode="External"`);
    expect(doc.match(/<w:hyperlink /g)).toHaveLength(4);
  });

  it('builds for every template and for an empty resume', () => {
    for (const t of RESUME_TEMPLATES) {
      const p = unzip(buildResumeDocx(RESUME, t.id));
      for (const [name, text] of p)
        expect(wellFormed(text), `${t.id} ${name}`).toBe(true);
      expect(p.get('word/styles.xml')).toContain(
        t.font === 'serif' ? 'Times New Roman' : 'Arial',
      );
    }
    const empty = unzip(buildResumeDocx(emptyResume()));
    expect(wellFormed(empty.get('word/document.xml') ?? '')).toBe(true);
    expect(empty.get('word/document.xml')).not.toContain('Heading1');
  });

  it('names the photo nowhere: the Word file is text only', () => {
    const p = unzip(buildResumeDocx(RESUME, 'photo'));
    expect([...p.keys()].some((n) => /media|image/.test(n))).toBe(false);
  });
});

describe('docxFilename', () => {
  it('follows the PDF name', () => {
    expect(docxFilename('Ada-Lovelace-Northwind-resume.pdf')).toBe(
      'Ada-Lovelace-Northwind-resume.docx',
    );
  });
});
