import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Design guard: keeps templates and styles on the design tokens. It reads
 * every source file under src/app (plus the global stylesheets) and fails on
 * patterns that bypass the system. Each rule says what to use instead.
 */

const SRC = new URL('../..', import.meta.url).pathname; // apps/web/src/
const APP = join(SRC, 'app');

/** Files allowed to hold raw colour values, with the reason. */
const COLOUR_EXEMPT = new Set([
  'app/ui/icons.generated.ts', // generated SVG data
  'app/shared/resume-templates.ts', // the printed resume is always light
  'app/core/theme.ts', // browser chrome colours per theme
  'app/core/design.node-spec.ts', // this file names the patterns
  'app/core/tokens.node-spec.ts',
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = [
  ...walk(APP).filter((f) => /\.(ts|html|scss|css)$/.test(f)),
  join(SRC, 'styles.scss'),
].map((path) => ({
  path,
  rel: relative(SRC, path).replace(/\\/g, '/'),
  text: readFileSync(path, 'utf8'),
}));

/** Component styles: the `styles:` block of a .ts file, or a whole stylesheet. */
function styleText(f: { path: string; text: string }): string {
  if (!f.path.endsWith('.ts')) return f.text;
  const m = f.text.match(/styles:\s*`([\s\S]*?)`/);
  return m ? m[1] : '';
}

function hits(re: RegExp, text: string): string[] {
  return [...text.matchAll(re)].map((m) => m[0]);
}

interface Rule {
  name: string;
  use: string;
  find: (f: (typeof files)[number]) => string[];
}

const PALETTE =
  /\b(?:bg|text|border|divide|fill|stroke|ring|outline|from|via|to|decoration|accent|shadow|placeholder|caret)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;

const rules: Rule[] = [
  {
    name: 'Tailwind palette colours in templates',
    use: 'semantic tokens: text-ink, text-ink-muted, bg-surface, bg-sunken, border-line, text-bad, bg-warn-tint …',
    find: (f) => hits(PALETTE, f.text),
  },
  {
    name: 'Old brand shades (brand-50…700)',
    use: 'bg-brand, text-brand-ink, bg-brand-tint',
    find: (f) => hits(/\b[\w:-]*-brand-(?:50|500|600|700)\b/g, f.text),
  },
  {
    name: 'Raw colour values in styles',
    use: 'var(--token) or color-mix() with tokens',
    find: (f) =>
      COLOUR_EXEMPT.has(f.rel)
        ? []
        : hits(/#[0-9a-f]{3,8}\b(?![\w-])|\b(?:rgba?|hsla?)\(/gi, styleText(f)),
  },
  {
    name: 'Arbitrary hex colours in classes',
    use: 'a token utility',
    find: (f) =>
      COLOUR_EXEMPT.has(f.rel) ? [] : hits(/-\[#[0-9a-f]{3,8}\]/gi, f.text),
  },
  {
    name: 'Radii outside the scale',
    use: 'rounded-control, rounded-card, rounded-sheet or rounded-full',
    find: (f) => hits(/\brounded-(?:md|lg|xl|2xl|3xl)\b/g, f.text),
  },
  {
    name: 'Type below 11px',
    use: 'text-xs (13px) or text-[0.6875rem] at the smallest',
    find: (f) => hits(/\btext-\[(?:[0-9]|10)px\]/g, f.text),
  },
  {
    name: 'Theme switching by media query in components',
    use: 'tokens (they already switch with data-theme)',
    find: (f) =>
      f.rel === 'app/core/theme.ts' || f.rel.endsWith('node-spec.ts')
        ? []
        : hits(/prefers-color-scheme/g, styleText(f)),
  },
  {
    name: '"Loading…" text instead of a skeleton',
    use: '<jb-skeleton> (or a busy button)',
    find: (f) =>
      f.path.endsWith('.ts') &&
      !f.rel.endsWith('spec.ts') &&
      f.rel !== 'app/ui/skeleton.ts' // its own screen-reader text
        ? hits(/>\s*Loading…\s*</g, f.text)
        : [],
  },
];

describe('design guard', () => {
  it('checks a real set of files', () => {
    expect(files.length).toBeGreaterThan(40);
  });

  for (const rule of rules) {
    it(`no ${rule.name}`, () => {
      const found = files.flatMap((f) =>
        rule.find(f).map((h) => `${f.rel}: ${h}`),
      );
      expect(found, `Use ${rule.use} instead.`).toEqual([]);
    });
  }
});
