import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Guards the design tokens in tailwind.css: text stays readable (WCAG AA
 * 4.5:1 for body text, 3:1 for large text, UI lines and graphics) in both
 * themes, and the two copies of the dark palette never drift apart.
 */

const css = readFileSync(
  new URL('../../tailwind.css', import.meta.url),
  'utf8',
);

type Palette = Record<string, string>;

function block(selector: string): string {
  const at = css.indexOf(selector);
  if (at < 0) throw new Error(`${selector} not found in tailwind.css`);
  const open = css.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`unclosed block for ${selector}`);
}

function hexTokens(body: string): Palette {
  const out: Palette = {};
  for (const m of body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
    out[m[1]] = m[2].toLowerCase();
  }
  return out;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const light = hexTokens(block(':root {'));
const dark = hexTokens(block(":root[data-theme='dark'] {"));
const darkSystem = hexTokens(block(':root:not([data-theme]) {'));

/** [foreground, background, minimum ratio] */
const pairs: [string, string, number][] = [
  ['ink', 'surface', 7],
  ['ink', 'surface-canvas', 7],
  ['ink', 'surface-sunken', 7],
  ['ink-muted', 'surface', 4.5],
  ['ink-muted', 'surface-canvas', 4.5],
  ['ink-muted', 'surface-sunken', 4.5],
  ['ink-faint', 'surface', 4.5],
  ['ink-faint', 'surface-canvas', 4.5],
  ['ink-on-brand', 'brand', 4.5],
  ['ink-on-brand', 'brand-hover', 4.5],
  ['brand', 'surface', 4.5],
  ['brand', 'surface-canvas', 4.5],
  ['brand-ink', 'brand-tint', 4.5],
  ['signal-ink', 'surface', 4.5],
  ['signal', 'surface', 2.5],
  ['good', 'surface', 4.5],
  ['warn', 'surface', 4.5],
  ['bad', 'surface', 4.5],
  ['line-focus', 'surface', 3],
  ['line-strong', 'surface', 1.35],
  ['status-new', 'surface', 4.5],
  ['status-shortlist', 'surface', 4.5],
  ['status-applied', 'surface', 4.5],
  ['status-interview', 'surface', 4.5],
  ['status-offer', 'surface', 4.5],
  ['status-rejected', 'surface', 4.5],
  ['status-skipped', 'surface', 4.5],
];

describe('design tokens', () => {
  for (const [name, palette] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    describe(`${name} theme`, () => {
      for (const [fg, bg, min] of pairs) {
        it(`${fg} on ${bg} ≥ ${min}:1`, () => {
          expect(palette[fg], `--${fg} missing`).toBeDefined();
          expect(palette[bg], `--${bg} missing`).toBeDefined();
          expect(contrast(palette[fg], palette[bg])).toBeGreaterThanOrEqual(
            min,
          );
        });
      }
    });
  }

  it('the system-dark copy matches the explicit dark theme', () => {
    expect(darkSystem).toEqual(dark);
  });

  it('every light colour token has a dark counterpart', () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });
});
