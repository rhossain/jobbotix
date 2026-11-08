/**
 * Turns what a file reader hands back into clean resume text for the parser.
 *
 * - PDFs come as positioned glyph runs. Lines are rebuilt from baselines,
 *   spaces from the real gaps between runs (so "Engineer ," never happens),
 *   two-column layouts are read column by column, and running headers,
 *   footers and page numbers are dropped.
 * - .docx comes from mammoth as HTML so headings, bullets and table cells
 *   survive instead of being flattened into bare paragraphs.
 *
 * Both are pure functions so they run (and are tested) without a browser.
 */

export interface PdfTextItem {
  str: string;
  /** Left edge of the run, in PDF points. */
  x: number;
  /** Baseline, in PDF points from the bottom of the page. */
  y: number;
  width: number;
  /** Font size; 0 when the reader did not know it. */
  height: number;
}

export interface PdfTextPage {
  width: number;
  height: number;
  items: PdfTextItem[];
}

interface Segment {
  x0: number;
  x1: number;
  y: number;
  fs: number;
  text: string;
  row: number;
}

const BULLET_GLYPH = /^[-*•·▪◦‣●■□➢➤►✓✔]$/;

const DATE_LIKE =
  /\b(?:19|20)\d{2}\b|\b(?:present|current)\b|^[A-Za-z .,'-]+,\s*[A-Za-z .'-]+$/i;

export function pdfPagesToText(pages: PdfTextPage[]): string {
  const pageLines = pages.map((p) => pageToLines(p));
  return dropRunningLines(pageLines)
    .map((ls) => ls.join('\n'))
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function pageToLines(page: PdfTextPage): string[] {
  // Whitespace-only runs are kept: some generators encode word spaces as
  // separate runs rather than as gaps, and dropping them glues words.
  const inStream = page.items
    .filter((i) => i.str !== '')
    .map((i) => ({ ...i, height: i.height > 0 ? i.height : 10 }));
  if (!inStream.some((i) => i.str.trim())) return [];

  // A clear two-column layout is always read column by column: some tools
  // write such pages row by row across both columns.
  const columns = positionalLines(page, inStream, true);
  if (columns) return columns;
  // Otherwise most generators (Word, Docs, LaTeX) write text in reading
  // order, which already handles small grids. Trust it unless it jumps around.
  const stream = streamLines(inStream);
  if (stream.upJumps <= Math.max(3, stream.lines.length * 0.08)) {
    return withBlocks([stream.lines]);
  }
  return positionalLines(page, inStream, false) ?? [];
}

interface Line {
  y: number;
  fs: number;
  text: string;
}

function streamLines(items: PdfTextItem[]): { lines: Line[]; upJumps: number } {
  const lines: Line[] = [];
  let cur: (Line & { x1: number }) | null = null;
  let upJumps = 0;
  for (const it of items) {
    const fs = it.height;
    const sameRow =
      cur !== null &&
      Math.abs(it.y - cur.y) <= Math.min(fs, cur.fs, 12) * 0.5 &&
      it.x >= cur.x1 - Math.max(2, fs * 0.3);
    if (cur && sameRow) {
      const gap = it.x - cur.x1;
      const bulletOnly = BULLET_GLYPH.test(cur.text.trim());
      cur.text =
        !bulletOnly && gap > Math.max(fs * 2, 14)
          ? `${cur.text} | ${it.str}`
          : joinRun(cur.text, it.str, bulletOnly ? fs : gap, fs);
      // A space run's box often overlaps the next word; it is not an edge.
      if (it.str.trim()) cur.x1 = Math.max(cur.x1, it.x + it.width);
      cur.fs = Math.max(cur.fs, fs);
      continue;
    }
    if (cur && it.y > cur.y + Math.max(fs, cur.fs) * 0.8) upJumps++;
    cur = { y: it.y, fs, text: it.str, x1: it.x + it.width };
    lines.push(cur);
  }
  for (const l of lines) l.text = tidy(l.text);
  return { lines, upJumps };
}

/** Joins line groups, adding a blank line where the vertical gap is large. */
function withBlocks(groups: Line[][]): string[] {
  const out: string[] = [];
  for (const lines of groups) {
    if (!lines.length) continue;
    if (out.length && out[out.length - 1] !== '') out.push('');
    const pitches = lines
      .slice(1)
      .map((l, i) => lines[i].y - l.y)
      .filter((p) => p > 0)
      .sort((a, b) => a - b);
    const pitch = pitches[Math.floor(pitches.length / 2)] ?? 14;
    lines.forEach((l, i) => {
      if (i > 0 && lines[i - 1].y - l.y > pitch * 1.8) out.push('');
      out.push(l.text);
    });
  }
  return out;
}

function positionalLines(
  page: PdfTextPage,
  raw: PdfTextItem[],
  onlyIfColumns: boolean,
): string[] | null {
  const items = [...raw].sort((a, b) => b.y - a.y || a.x - b.x);

  // 1. Rows: runs whose baselines sit within half a font size of each other.
  const rows: (typeof items)[] = [];
  let rowY = Number.NaN;
  for (const it of items) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(it.y - rowY) <= Math.min(it.height, 12) * 0.5) {
      last.push(it);
    } else {
      rows.push([it]);
      rowY = it.y;
    }
  }

  // 2. Segments: runs in a row split wherever the gap is wide enough to be a
  //    column gutter or a tab stop.
  const segments: Segment[] = [];
  rows.forEach((row, r) => {
    row.sort((a, b) => a.x - b.x);
    let seg: Segment | null = null;
    for (const it of row) {
      const fs = it.height;
      const end = it.x + it.width;
      // A lone bullet glyph always belongs to the text after it.
      const bulletOnly = seg !== null && BULLET_GLYPH.test(seg.text.trim());
      if (seg && (bulletOnly || it.x - seg.x1 <= Math.max(fs * 2, 14))) {
        if (bulletOnly) seg.text = seg.text.trim() + ' ';
        seg.text = joinRun(seg.text, it.str, it.x - seg.x1, fs);
        seg.x1 = Math.max(seg.x1, end);
      } else {
        seg = { x0: it.x, x1: end, y: it.y, fs, text: it.str, row: r };
        segments.push(seg);
      }
    }
  });
  for (const s of segments) s.text = tidy(s.text);

  // 3. Columns: read a two-column page left column first, then right.
  const gutter = findGutter(segments, page.width);
  if (gutter === null && onlyIfColumns) return null;
  let ordered: Segment[][];
  if (gutter === null) {
    ordered = [segments];
  } else {
    const left: Segment[] = [];
    const right: Segment[] = [];
    const spanning: Segment[] = [];
    for (const s of segments) {
      if (s.x0 >= gutter - 4) right.push(s);
      else if (s.x1 <= gutter + 4) left.push(s);
      else spanning.push(s);
    }
    const colTop = Math.max(...[...left, ...right].map((s) => s.y));
    const head = spanning.filter((s) => s.y > colTop);
    const foot = spanning.filter((s) => s.y <= colTop);
    ordered = [head, left, right, foot];
  }

  // 4. Lines, with a blank line wherever the vertical gap says "new block".
  return withBlocks(
    ordered.map((group) => {
      const byRow = new Map<number, Segment[]>();
      for (const s of group) {
        const list = byRow.get(s.row) ?? [];
        list.push(s);
        byRow.set(s.row, list);
      }
      return [...byRow.values()]
        .map((ss) => {
          ss.sort((a, b) => a.x0 - b.x0);
          return {
            y: ss[0].y,
            fs: Math.max(...ss.map((s) => s.fs)),
            text: ss.map((s) => s.text).join(' | '),
          };
        })
        .sort((a, b) => b.y - a.y);
    }),
  );
}

/** Joins two runs on one line, adding a space only where there is a gap. */
function joinRun(a: string, b: string, gap: number, fs: number): string {
  if (!a) return b;
  if (/\s$/.test(a) || /^\s/.test(b)) return a + b;
  return gap > fs * 0.12 ? `${a} ${b}` : a + b;
}

function tidy(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/\s+([,;:])/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();
}

/**
 * Finds the x of a right column's left edge, or null for a one-column page.
 * A real column has many runs starting at the same x, almost nothing
 * crossing it, real prose on both sides, and is not just a tab stop for
 * dates and places beside a one-column body.
 */
function findGutter(segs: Segment[], width: number): number | null {
  if (segs.length < 12 || !width) return null;
  const starts = new Map<number, number>();
  for (const s of segs) {
    if (s.x0 < width * 0.2 || s.x0 > width * 0.8) continue;
    const k = Math.round(s.x0 / 4) * 4;
    starts.set(k, (starts.get(k) ?? 0) + 1);
  }
  const candidates = [...starts.entries()]
    .filter(([, n]) => n >= 6)
    .sort((a, b) => b[1] - a[1]);
  const chars = (ss: Segment[]) => ss.reduce((n, s) => n + s.text.length, 0);
  const total = chars(segs);
  for (const [x] of candidates) {
    const right = segs.filter((s) => s.x0 >= x - 4);
    const left = segs.filter((s) => s.x1 <= x + 4);
    const crossing = segs.length - right.length - left.length;
    if (crossing > segs.length * 0.15) continue;
    // Sidebars are often light on text, so the smaller side may be thin.
    if (chars(right) < total * 0.08 || chars(left) < total * 0.08) continue;
    const dateish = right.filter((s) => DATE_LIKE.test(s.text)).length;
    if (dateish > right.length * 0.4) continue;
    const leftRows = new Set(left.map((s) => s.row));
    const alone = right.filter((s) => !leftRows.has(s.row)).length;
    const words =
      right.reduce((n, s) => n + s.text.split(/\s+/).length, 0) / right.length;
    if (alone < right.length * 0.3 && words < 3) continue;
    return x;
  }
  return null;
}

/** Drops page numbers and lines repeated at the top or bottom of every page. */
function dropRunningLines(pages: string[][]): string[][] {
  const key = (l: string) => l.toLowerCase().replace(/\d+/g, '#').trim();
  const edgeCount = new Map<string, number>();
  if (pages.length > 1) {
    for (const lines of pages) {
      const content = lines.filter(Boolean);
      const edges = new Set([
        ...content.slice(0, 2).map(key),
        ...content.slice(-2).map(key),
      ]);
      for (const k of edges) edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
    }
  }
  return pages.map((lines) =>
    lines.filter((l) => {
      if (/^(page\s*)?#?\d+(\s*(of|\/)\s*\d+)?$/i.test(l.trim())) return false;
      return !(pages.length > 1 && (edgeCount.get(key(l)) ?? 0) >= 2 && l);
    }),
  );
}

/* ---------- .docx (via mammoth's HTML) ---------- */

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  bull: '•',
  hellip: '…',
};

/** Converts mammoth's HTML into text that keeps headings, bullets and cells. */
export function htmlToResumeText(html: string): string {
  return (
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      // Short cells ("Jane Doe | jane@doe.dev") share a line; a cell holding
      // a whole section (a two-column Word template) stays a block of its own.
      .replace(
        /<t([dh])\b[^>]*>([\s\S]*?)<\/t\1>/gi,
        (_, _t, inner: string) => {
          const blocks = (inner.match(/<(p|li|h[1-6])\b/gi) ?? []).length;
          const isBlock = blocks > 2 || /<(li|h[1-6])\b/i.test(inner);
          return isBlock
            ? `\n\n${inner}\n\n`
            : inner.replace(/<\/?p\b[^>]*>|<br\s*\/?>/gi, ' ') + '\uE000';
        },
      )
      .replace(/\uE000(\s*<\/tr>)/gi, '$1')
      .replace(/\uE000/g, ' | ')
      .replace(/<img[^>]*>/gi, '')
      .replace(
        /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
        (_, href, t) => {
          const text = String(t)
            .replace(/<[^>]+>/g, '')
            .trim();
          const url = String(href);
          return /^mailto:/i.test(url) ||
            text.includes(url.replace(/^https?:\/\//, ''))
            ? text
            : `${text} ${url}`.trim();
        },
      )
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<h[1-6][^>]*>/gi, '\n\n')
      .replace(/<\/h[1-6]>/gi, '\n')
      .replace(/<li[^>]*>/gi, '\n• ')
      .replace(/<\/li>/gi, '')
      .replace(/<\/(ul|ol|table)>/gi, '\n\n')
      .replace(/<\/(p|tr|div)>/gi, '\n')
      .replace(/<\/t[dh]>/gi, ' | ')
      .replace(/<[^>]+>/g, '')
      .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
        if (e[0] === '#') {
          const n =
            e[1].toLowerCase() === 'x'
              ? parseInt(e.slice(2), 16)
              : parseInt(e.slice(1), 10);
          return Number.isFinite(n) ? String.fromCodePoint(n) : m;
        }
        return ENTITIES[e.toLowerCase()] ?? m;
      })
      .split('\n')
      .map((l) =>
        l
          .replace(/[ \t]+/g, ' ')
          .replace(/(\s*\|\s*)+$/, '')
          .replace(/^(\s*\|\s*)+/, '')
          .replace(/•\s+•\s+/, '• ')
          .trim(),
      )
      .filter((l) => l !== '•')
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}
