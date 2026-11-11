/**
 * The looks a resume can be shown, printed and exported in.
 *
 * Every template is one column of real text in the same order, with the
 * same standard headings: that is what applicant tracking systems read
 * reliably, so a template changes type, colour, spacing and how the header
 * and headings are drawn, and nothing about the structure. A resume is a
 * paper document, so none of this follows the app's dark theme.
 *
 * One definition drives both the on-screen preview (resume-preview.ts, CSS)
 * and the PDF (resume-pdf.ts, jsPDF), which is how the two stay alike.
 */
export interface ResumeTemplate {
  id: string;
  name: string;
  /** One line for the picker: what it looks like and who it suits. */
  blurb: string;
  /** Part of the plan's "extra resume templates" (Classic is for everyone). */
  pro: boolean;
  /**
   * Shows the account's photo top right, with the contact details listed
   * under the name. Without a photo it is drawn the same, minus the picture.
   */
  photo: boolean;
  /** Helvetica or Times: fonts every PDF reader has. */
  font: 'sans' | 'serif';
  /** The name block: flush left, centred, or on a filled band. */
  header: 'left' | 'center' | 'banner';
  /**
   * Section headings: small grey capitals over a hairline ('rule'), accent
   * capitals over a heavier line ('accent'), centred capitals ('center'),
   * or plain bold capitals with nothing drawn ('plain').
   */
  heading: 'rule' | 'accent' | 'center' | 'plain';
  /** Type size against Classic; under 1 fits more on the page. */
  scale: number;
  /** PDF page margin in points (the preview uses the same in proportion). */
  margin: number;
  paper: string;
  ink: string;
  muted: string;
  rule: string;
  accent: string;
}

export const RESUME_TEMPLATES: ResumeTemplate[] = [
  {
    id: 'classic',
    name: 'Classic',
    blurb: 'Clean and neutral. Works for any role.',
    pro: false,
    photo: false,
    font: 'sans',
    header: 'left',
    heading: 'rule',
    scale: 1,
    margin: 46,
    paper: '#ffffff',
    ink: '#0f1e1b',
    muted: '#56655f',
    rule: '#e1e8e5',
    accent: '#0b5f5a',
  },
  {
    id: 'modern',
    name: 'Modern',
    blurb: 'Blue headings and a strong name. Tech and product roles.',
    pro: true,
    photo: false,
    font: 'sans',
    header: 'left',
    heading: 'accent',
    scale: 1,
    margin: 46,
    paper: '#ffffff',
    ink: '#111827',
    muted: '#4b5563',
    rule: '#dbe3f0',
    accent: '#1d4ed8',
  },
  {
    id: 'compact',
    name: 'Compact',
    blurb: 'Smaller type and tighter margins. Fits a long history on one page.',
    pro: true,
    photo: false,
    font: 'sans',
    header: 'left',
    heading: 'plain',
    scale: 0.9,
    margin: 34,
    paper: '#ffffff',
    ink: '#111827',
    muted: '#4b5563',
    rule: '#d1d5db',
    accent: '#334155',
  },
  {
    id: 'serif',
    name: 'Elegant',
    blurb: 'Serif type, centred, no colour. Traditional and formal.',
    pro: true,
    photo: false,
    font: 'serif',
    header: 'center',
    heading: 'center',
    scale: 1.06,
    margin: 50,
    paper: '#ffffff',
    ink: '#141414',
    muted: '#4a4a4a',
    rule: '#bdbdbd',
    accent: '#141414',
  },
  {
    id: 'banner',
    name: 'Bold',
    blurb: 'Your name on a dark band. Stands out in a stack.',
    pro: true,
    photo: false,
    font: 'sans',
    header: 'banner',
    heading: 'accent',
    scale: 1,
    margin: 46,
    paper: '#ffffff',
    ink: '#0f172a',
    muted: '#475569',
    rule: '#cbd5e1',
    accent: '#0f2a4a',
  },
  {
    id: 'photo',
    name: 'Photo',
    blurb:
      'A portrait top right, as is customary in Germany, Austria, Switzerland and much of Europe, Asia and Latin America.',
    pro: true,
    photo: true,
    font: 'sans',
    header: 'left',
    heading: 'rule',
    scale: 1,
    margin: 46,
    paper: '#ffffff',
    ink: '#111827',
    muted: '#4b5563',
    rule: '#d7dde5',
    accent: '#1f4e79',
  },
];

export const DEFAULT_TEMPLATE_ID = 'classic';

/** The portrait: 3 wide by 4 tall, the passport shape CVs with a photo use. */
export const PHOTO = {
  /** Width and height on the page, in points (26 by 35 mm). */
  width: 75,
  height: 100,
  /** The pixels the browser shrinks an upload to: sharp in print, small to keep. */
  pixels: { width: 360, height: 480 },
} as const;

/** The template of that name; Classic for a name the app does not know. */
export function templateOf(id: string | null | undefined): ResumeTemplate {
  return RESUME_TEMPLATES.find((t) => t.id === id) ?? RESUME_TEMPLATES[0];
}

/** jsPDF wants colours as 0–255 RGB triples. */
export function rgb(hex: string): [number, number, number] {
  const h = hex.slice(1);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/** Text drawn on the accent band: white, and a soft white for small print. */
export const ON_BANNER = { strong: '#ffffff', soft: '#d5deea' } as const;

/** CSS custom properties for the preview's host element. */
export function templateCssVars(t: ResumeTemplate): Record<string, string> {
  return {
    '--paper': t.paper,
    '--ink': t.ink,
    '--muted': t.muted,
    '--rule': t.rule,
    '--accent': t.accent,
    '--on-banner': ON_BANNER.strong,
    '--on-banner-soft': ON_BANNER.soft,
    '--scale': String(t.scale),
    '--photo-w': `${PHOTO.width}pt`,
    // 46pt on an A4 page is 16mm; the preview keeps the same proportion.
    '--pad-x': `${((t.margin / 46) * 16).toFixed(1)}mm`,
    '--pad-y': `${((t.margin / 46) * 14).toFixed(1)}mm`,
    '--resume-font':
      t.font === 'serif'
        ? "'Times New Roman', Times, serif"
        : "'Helvetica Neue', Helvetica, Arial, sans-serif",
  };
}

/** The classes that switch the preview's header and heading styles. */
export function templateClasses(t: ResumeTemplate): string {
  return `resume--head-${t.header} resume--h-${t.heading}${t.photo ? ' resume--photo' : ''}`;
}
