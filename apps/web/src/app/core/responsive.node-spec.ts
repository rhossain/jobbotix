import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Responsive guard: source-level rules for the phone and tablet layouts,
 * checked in milliseconds before anything renders. The layout specs
 * (*.layout.spec.ts) measure the result in a real browser; these catch the
 * known causes early and point at the line. Each rule says what to do instead.
 */

const SRC = new URL('../..', import.meta.url).pathname; // apps/web/src/
const APP = join(SRC, 'app');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const read = (path: string) => readFileSync(path, 'utf8');

const files = [
  ...walk(APP).filter(
    (f) => /\.(ts|html|scss|css)$/.test(f) && !/spec\.ts$/.test(f),
  ),
  join(SRC, 'styles.scss'),
].map((path) => ({
  path,
  rel: relative(SRC, path).replace(/\\/g, '/'),
  text: read(path),
}));

type SourceFile = (typeof files)[number];

const styles = read(join(SRC, 'styles.scss'));
const tokens = read(join(SRC, 'tailwind.css'));
const indexHtml = read(join(SRC, 'index.html'));
const viewportTs = read(join(APP, 'core/viewport.ts'));

/**
 * Component styles: every `styles:` block of a .ts file (one file may define
 * several components), or a whole stylesheet.
 */
function styleText(f: SourceFile): string {
  if (!f.path.endsWith('.ts')) return f.text;
  return [...f.text.matchAll(/styles:\s*`([\s\S]*?)`/g)]
    .map((m) => m[1])
    .join('\n');
}

/** Every class attribute value in a file (static `class="…"` and [class] strings). */
function classStrings(f: SourceFile): string[] {
  return [...f.text.matchAll(/class="([^"]*)"/g)].map((m) => m[1]);
}

/** "file:line: snippet" for each match, so a failure points at the source. */
function locate(f: SourceFile, re: RegExp, text = f.text): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    const offset = f.text.indexOf(m[0]);
    const line = offset < 0 ? '?' : f.text.slice(0, offset).split('\n').length;
    out.push(`${f.rel}:${line}: ${m[0].trim().slice(0, 90)}`);
  }
  return out;
}

/** CSS with every `@media (min-width: ≥768px)` block removed (tablet-up only). */
function phoneStyles(css: string): string {
  let out = css;
  for (;;) {
    const m = /@media[^{]*\(min-width:\s*([\d.]+)(px|rem)\)[^{]*\{/.exec(out);
    if (!m || remToPx(m[1] + m[2]) < 768) break;
    let depth = 0;
    let end = m.index + m[0].length - 1;
    for (; end < out.length; end++) {
      if (out[end] === '{') depth++;
      if (out[end] === '}' && --depth === 0) break;
    }
    out = out.slice(0, m.index) + out.slice(end + 1);
  }
  return out;
}

const remToPx = (v: string) =>
  v.endsWith('rem') ? parseFloat(v) * 16 : parseFloat(v);

/** Usable width on the narrowest phone we support: 320px minus 16px gutters. */
const PHONE_CONTENT = 320 - 2 * 16;

/* ------------------------------------------------------------ breakpoints */

const bp = (name: string) => {
  const m = tokens.match(new RegExp(`--breakpoint-${name}:\\s*([\\d.]+)rem`));
  if (!m) throw new Error(`--breakpoint-${name} missing from tailwind.css`);
  return parseFloat(m[1]) * 16;
};
const MD = bp('md');
const LG = bp('lg');
const XL = bp('xl');

describe('responsive guard', () => {
  it('checks a real set of files', () => {
    expect(files.length).toBeGreaterThan(40);
  });

  describe('viewport meta', () => {
    const meta =
      indexHtml.match(/<meta\s+name="viewport"\s+content="([^"]+)"/)?.[1] ?? '';

    it('sizes the page to the device', () => {
      expect(meta).toMatch(/width=device-width/);
      expect(meta).toMatch(/initial-scale=1(?:\.0)?\b/);
    });

    it('extends under the notch, which the safe-area padding relies on', () => {
      expect(meta).toMatch(/viewport-fit=cover/);
    });

    it('never stops people zooming (WCAG 1.4.4)', () => {
      expect(meta).not.toMatch(/user-scalable\s*=\s*(no|0)/);
      const max = meta.match(/maximum-scale\s*=\s*([\d.]+)/);
      if (max) expect(parseFloat(max[1])).toBeGreaterThanOrEqual(5);
    });
  });

  describe('breakpoints stay in sync', () => {
    it('uses md 768px, lg 1024px and xl 1280px', () => {
      expect([MD, LG, XL]).toEqual([768, 1024, 1280]);
    });

    it('switches the Viewport service at the same widths as the CSS', () => {
      // 0.02px below md, the usual stand-in for "under md".
      expect(viewportTs).toContain(`(max-width: ${MD - 0.02}px)`);
      expect(viewportTs).toContain(`(min-width: ${XL}px)`);
    });

    it('changes the layout tokens at md and xl', () => {
      const widths = [...tokens.matchAll(/@media \(min-width: (\d+)px\)/g)].map(
        (m) => Number(m[1]),
      );
      expect(widths).toEqual([MD, XL]);
    });

    it('writes raw width queries only at the shared breakpoints', () => {
      const allowed = new Set([
        `min-width: ${MD}px`,
        `min-width: ${LG}px`,
        `min-width: ${XL}px`,
        `max-width: ${MD - 0.02}px`,
      ]);
      const found = files.flatMap((f) =>
        locate(
          f,
          /@media[^{]*?\((?:min|max)-width:[^)]*\)/g,
          styleText(f),
        ).filter((hit) => ![...allowed].some((a) => hit.includes(a))),
      );
      expect(found, 'Use 768px, 1024px or 1280px (md, lg, xl).').toEqual([]);
    });

    it('keeps one-off Tailwind breakpoints for small phones only', () => {
      // min-[…]: / max-[…]: are for tuning under md; above it use md: lg: xl:.
      const found = files.flatMap((f) =>
        classStrings(f).flatMap((c) =>
          [...c.matchAll(/\b(?:min|max)-\[([\d.]+)(px|rem)\]:/g)]
            .filter((m) => remToPx(m[1] + m[2]) >= MD)
            .map((m) => `${f.rel}: ${m[0]}`),
        ),
      );
      expect(found, 'Use md:, lg: or xl: from 768px up.').toEqual([]);
    });
  });

  describe('sizes that break on phones', () => {
    it('uses dvh/svh, not vh or h-screen (mobile browser bars change vh)', () => {
      const found = files.flatMap((f) => [
        ...locate(f, /(?<![\w-])\d+(?:\.\d+)?vh\b/g, styleText(f)),
        ...classStrings(f).flatMap((c) =>
          [
            ...c.matchAll(
              /\b(?:h|min-h|max-h)-screen\b|\[[^\]]*\d+vh[^\]]*\]/g,
            ),
          ].map((m) => `${f.rel}: ${m[0]}`),
        ),
      ]);
      expect(found, 'Use dvh (or svh), e.g. min-h-dvh.').toEqual([]);
    });

    it('caps any vw size with min(), max() or clamp()', () => {
      // 100vw counts the scrollbar on desktop and ignores the gutters.
      const found = files.flatMap((f) =>
        [
          ...`${styleText(f)}\n${classStrings(f).join('\n')}`.matchAll(
            /[^;\n]*\d+(?:\.\d+)?vw[^;\n]*/g,
          ),
        ]
          .map((m) => m[0])
          .filter((decl) => !/\b(?:min|max|clamp)\(/.test(decl))
          .map((decl) => `${f.rel}: ${decl.trim().slice(0, 90)}`),
      );
      expect(found, 'Wrap it: min(24rem, calc(100vw - 2rem)).').toEqual([]);
    });

    it(`sets no fixed width a ${PHONE_CONTENT}px-wide phone cannot hold`, () => {
      const tooWide = (px: number) => px > PHONE_CONTENT;
      const found = files.flatMap((f) => {
        // Unprefixed utilities only: md:w-96 is fine, it starts at 768px.
        const utilities = classStrings(f).flatMap((c) =>
          c
            .split(/\s+/)
            .filter((cls) => !cls.includes(':'))
            .filter((cls) => {
              const scale = cls.match(/^(?:w|min-w)-(\d+(?:\.\d+)?)$/);
              if (scale) return tooWide(parseFloat(scale[1]) * 4);
              const arb = cls.match(/^(?:w|min-w)-\[([\d.]+)(px|rem)\]$/);
              return arb ? tooWide(remToPx(arb[1] + arb[2])) : false;
            })
            .map((cls) => `${f.rel}: ${cls}`),
        );
        const css = [
          ...phoneStyles(styleText(f)).matchAll(
            /(?<![\w(-])(?:min-)?width:\s*([\d.]+)(px|rem)/g,
          ),
        ]
          .filter((m) => tooWide(remToPx(m[1] + m[2])))
          .map((m) => `${f.rel}: ${m[0]}`);
        return [...utilities, ...css];
      });
      expect(
        found,
        'Use max-w-* (or w-full max-w-*), or apply the width from md: up.',
      ).toEqual([]);
    });
  });

  describe('touch screens', () => {
    it('pads bottom-anchored fixed bars for the home indicator', () => {
      const found = files.flatMap((f) => {
        const css = styleText(f);
        const out: string[] = [];
        // Each rule body that fixes something to the bottom edge.
        for (const m of css.matchAll(/\{([^{}]*position:\s*fixed[^{}]*)\}/g)) {
          const body = m[1];
          const inset = body
            .match(/inset:\s*([^;]+);/)?.[1]
            .trim()
            .split(/\s+/);
          const bottom =
            /(?:^|[\s;])bottom:/.test(body) ||
            (inset?.length === 3 && inset[0] === 'auto') ||
            (inset?.length === 4 && inset[0] === 'auto');
          if (bottom && !body.includes('safe-area-inset-bottom')) {
            out.push(`${f.rel}: ${body.trim().split('\n')[0].slice(0, 80)}`);
          }
        }
        return out;
      });
      expect(
        found,
        'Add env(safe-area-inset-bottom, 0px) to its offset or padding.',
      ).toEqual([]);
    });

    it('reveals nothing on hover alone (touch screens cannot hover)', () => {
      const found = files.flatMap((f) =>
        classStrings(f)
          .filter((c) =>
            /\b(?:group-)?hover:(?:opacity-100|visible|block|flex|inline-flex|grid)\b/.test(
              c,
            ),
          )
          .filter(
            (c) =>
              !/\b(?:focus|focus-visible|focus-within|group-focus-within|pointer-coarse):/.test(
                c,
              ),
          )
          .map((c) => `${f.rel}: ${c.slice(0, 90)}`),
      );
      expect(
        found,
        'Also show it on focus-within: and pointer-coarse:, or keep it visible.',
      ).toEqual([]);
    });

    it('keeps text fields at 16px on touch screens, above every layer', () => {
      // iOS zooms into smaller fields on focus. The rule must stay unlayered,
      // or a text-sm utility beats it (this happened; see styles.scss).
      const unlayered = styles.replace(/@layer\s+\w+\s*\{[\s\S]*?\n\}/g, '');
      const block =
        unlayered.match(/@media \(pointer: coarse\)\s*\{([\s\S]*?)\n\}/)?.[1] ??
        '';
      expect(block, 'unlayered @media (pointer: coarse) block').toMatch(
        /select/,
      );
      expect(block).toMatch(/textarea/);
      expect(block).toMatch(/font-size:\s*max\(1rem,\s*16px\)/);
    });
  });

  describe('content from postings', () => {
    it('lets a word break when it cannot fit its line', () => {
      const bodies = [...styles.matchAll(/\bbody\s*\{([^}]*)\}/g)].map(
        (m) => m[1],
      );
      expect(
        bodies.some((b) => /overflow-wrap:\s*break-word/.test(b)),
        'a body rule in styles.scss sets overflow-wrap: break-word',
      ).toBe(true);
    });

    it('keeps tags on one line that can never outgrow their row', () => {
      const tag = styles.match(/\.jb-tag\s*\{([^}]*)\}/)?.[1] ?? '';
      expect(tag).toMatch(/max-width:\s*100%/);
      expect(tag).toMatch(/text-overflow:\s*ellipsis/);
      expect(tag).toMatch(/overflow:\s*hidden/);
    });

    it('puts every table in a box that scrolls sideways', () => {
      const found = files.flatMap((f) => {
        const out: string[] = [];
        for (const m of f.text.matchAll(/<table\b/g)) {
          const before = f.text.slice(0, m.index);
          // The nearest enclosing elements sit within the few lines above.
          const context = before.split('\n').slice(-16).join('\n');
          if (!/overflow-(?:x-)?auto/.test(context)) {
            out.push(`${f.rel}:${before.split('\n').length}`);
          }
        }
        return out;
      });
      expect(found, 'Wrap it in a div with overflow-x-auto.').toEqual([]);
    });
  });
});
