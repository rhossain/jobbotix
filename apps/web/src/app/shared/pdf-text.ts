import type { ResumeSections } from '@jobbotix/shared-types';

// The resume PDF is drawn in Helvetica, one of the fonts every PDF reader
// has, so the file is small and its text is real text an ATS can read. That
// font only covers Windows-1252: Western European letters and common
// punctuation. Anything else jsPDF writes as bytes no reader maps back: a
// non-breaking hyphen (U+2011, which AI models write all the time in "AI-assisted")
// vanished, "→" came out as "!'", "Łódź" as "Aódz", and some parsers then
// read the whole line with a space between every letter.
//
// So before drawing, text is brought into what the font can show: lookalike
// punctuation is swapped for the plain form, letters with marks the font
// lacks lose the mark, and what is left over is dropped and reported, never
// drawn as garbage.

/** The characters of Windows-1252 outside ASCII and Latin-1. */
const CP1252_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';

function drawable(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return (
    (c >= 0x20 && c <= 0x7e) ||
    (c >= 0xa0 && c <= 0xff) ||
    CP1252_EXTRA.includes(ch)
  );
}

/** Punctuation and symbols with a plain form that means the same. */
const PLAIN: [RegExp, string][] = [
  // hyphens and minus signs that are not the keyboard hyphen
  [/[\u2010\u2011\u2012\u2043\u2212\ufe63\uff0d]/g, '-'],
  [/\u2015/g, '—'],
  // spaces of other widths, including the non-breaking ones
  [/[\u2000-\u200a\u202f\u205f\u3000]/g, ' '],
  // zero-width characters and the byte-order mark
  [/[\u200b-\u200f\u2060\ufeff\u00ad]/g, ''],
  [/[\u2192\u279c\u2794\u27f6]/g, '->'],
  [/\u2190/g, '<-'],
  [/\u2194/g, '<->'],
  [/\u21d2/g, '=>'],
  [/\u2265/g, '>='],
  [/\u2264/g, '<='],
  [/\u2260/g, '!='],
  [/\u2248/g, '~'],
  [/[\u2022\u2023\u25cf\u25e6\u25aa\u25ab\u2219\u30fb]/g, '•'],
  [/[\u2032\u02bc\u2035]/g, "'"],
  [/[\u2033\u2036]/g, '"'],
  [/[\ufb01]/g, 'fi'],
  [/[\ufb02]/g, 'fl'],
];

/** Letters whose plain form is not what removing the mark gives. */
const LETTERS: Record<string, string> = {
  Ł: 'L',
  ł: 'l',
  Đ: 'D',
  đ: 'd',
  ı: 'i',
  Ħ: 'H',
  ħ: 'h',
  ĸ: 'k',
  Ŧ: 'T',
  ŧ: 't',
};

/**
 * `text` in characters the PDF font can show, and the ones that had to be
 * left out (each once, in the order met).
 */
export function pdfSafe(text: string): { text: string; dropped: string[] } {
  let s = text;
  for (const [from, to] of PLAIN) s = s.replace(from, to);
  const dropped: string[] = [];
  let out = '';
  for (const ch of s) {
    if (drawable(ch) || ch === '\n' || ch === '\t') {
      out += ch;
      continue;
    }
    // "ź" is "z" plus a mark: keep the letter when the font has it.
    const base =
      LETTERS[ch] ?? ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (base && [...base].every(drawable)) {
      out += base;
      continue;
    }
    // Variation selectors and joiners belong to the emoji before them.
    if (!/[\ufe00-\ufe0f\u200d]/.test(ch) && !dropped.includes(ch))
      dropped.push(ch);
  }
  // A dropped character can leave two spaces behind.
  return { text: dropped.length ? out.replace(/ {2,}/g, ' ') : out, dropped };
}

/** Every string of a resume made safe for the PDF, and what was left out. */
export function pdfSafeResume(r: ResumeSections): {
  resume: ResumeSections;
  dropped: string[];
} {
  const dropped: string[] = [];
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const safe = pdfSafe(v);
      for (const ch of safe.dropped)
        if (!dropped.includes(ch)) dropped.push(ch);
      return safe.text;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object')
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, walk(x)]),
      );
    return v;
  };
  return { resume: walk(r) as ResumeSections, dropped };
}

/** What to tell the user when the PDF could not show some characters. */
export function droppedNote(dropped: string[]): string {
  if (!dropped.length) return '';
  const shown = dropped.slice(0, 8).join(' ');
  const more = dropped.length > 8 ? ` and ${dropped.length - 8} more` : '';
  return `The PDF font cannot show ${dropped.length === 1 ? 'this character' : 'these characters'}, so ${dropped.length === 1 ? 'it was' : 'they were'} left out: ${shown}${more}. To keep ${dropped.length === 1 ? 'it' : 'them'}, use the print button and choose Save as PDF.`;
}
