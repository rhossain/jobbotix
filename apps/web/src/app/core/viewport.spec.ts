import { TestBed } from '@angular/core/testing';
import { Viewport } from './viewport';

/**
 * The Viewport service decides which layout gets rendered at all (phone tab
 * bar or sidebar, rail or full sidebar). These tests drive it with a fake
 * matchMedia that evaluates min-/max-width queries against a window width,
 * so the breakpoint edges are checked exactly, pixel by pixel.
 */

type Listener = (e: { matches: boolean }) => void;

/** A matchMedia that answers width queries for a resizable fake window. */
function fakeScreen(initialWidth: number) {
  let width = initialWidth;
  const lists: { query: string; listeners: Listener[]; last: boolean }[] = [];

  const evaluate = (query: string) => {
    const min = /min-width:\s*([\d.]+)px/.exec(query);
    const max = /max-width:\s*([\d.]+)px/.exec(query);
    return (
      (!min || width >= parseFloat(min[1])) &&
      (!max || width <= parseFloat(max[1]))
    );
  };

  const matchMedia = vi.fn((query: string) => {
    const entry = { query, listeners: [] as Listener[], last: evaluate(query) };
    lists.push(entry);
    return {
      media: query,
      get matches() {
        return evaluate(query);
      },
      addEventListener: (_: 'change', fn: Listener) => entry.listeners.push(fn),
      removeEventListener: () => undefined,
    } as unknown as MediaQueryList;
  });

  return {
    matchMedia,
    queries: () => lists.map((l) => l.query),
    /** Resizes and fires `change` on every query whose answer flipped. */
    resize(to: number) {
      width = to;
      for (const l of lists) {
        const now = evaluate(l.query);
        if (now !== l.last) {
          l.last = now;
          l.listeners.forEach((fn) => fn({ matches: now }));
        }
      }
    },
  };
}

describe('Viewport', () => {
  let original: typeof window.matchMedia | undefined;

  beforeEach(() => {
    original = window.matchMedia;
  });
  afterEach(() => {
    window.matchMedia = original as typeof window.matchMedia;
  });

  function viewportAt(width: number) {
    const screen = fakeScreen(width);
    window.matchMedia = screen.matchMedia;
    return { screen, vp: TestBed.inject(Viewport) };
  }

  it.each([
    // width, phone, wide
    [320, true, false],
    [390, true, false],
    [767, true, false],
    [767.5, true, false], // fractional widths from browser zoom
    [768, false, false],
    [1024, false, false],
    [1279, false, false],
    [1280, false, true],
    [1920, false, true],
  ])('at %spx: phone=%s, wide=%s', (width, phone, wide) => {
    const { vp } = viewportAt(width);
    expect(vp.phone()).toBe(phone);
    expect(vp.wide()).toBe(wide);
  });

  it('never reports phone and wide at once, at any width', () => {
    for (let w = 280; w <= 2000; w += 1) {
      const screen = fakeScreen(w);
      window.matchMedia = screen.matchMedia;
      TestBed.resetTestingModule();
      const vp = TestBed.inject(Viewport);
      expect(vp.phone() && vp.wide(), `at ${w}px`).toBe(false);
    }
  });

  it('switches at exactly the CSS md breakpoint (768px)', () => {
    // 767.98 is the usual stand-in for "under 768": fractional widths from
    // browser zoom (767.27 at 110%, 767.5 at 200%…) still count as phone,
    // and from 768px the md: styles and the sidebar take over together.
    for (const [w, phone] of [
      [767.27, true],
      [767.98, true],
      [768, false],
      [768.5, false],
    ] as const) {
      const { vp } = viewportAt(w);
      expect(vp.phone(), `${w}px`).toBe(phone);
      TestBed.resetTestingModule();
    }
  });

  it('updates live as the window crosses each breakpoint', () => {
    const { screen, vp } = viewportAt(1440);
    const seen: string[] = [];
    const snap = () =>
      seen.push(`${vp.phone() ? 'phone' : vp.wide() ? 'wide' : 'rail'}`);

    for (const w of [1440, 1279, 1280, 900, 768, 767, 360, 800, 1500]) {
      screen.resize(w);
      snap();
    }
    expect(seen).toEqual([
      'wide',
      'rail',
      'wide',
      'rail',
      'rail',
      'phone',
      'phone',
      'rail',
      'wide',
    ]);
  });

  it('asks the browser the same breakpoints the stylesheets use', () => {
    const { screen } = viewportAt(1024);
    expect(screen.queries()).toEqual([
      '(max-width: 767.98px)', // below Tailwind md (48rem)
      '(min-width: 1280px)', // Tailwind xl (80rem)
    ]);
  });

  it('falls back to the desktop layout where matchMedia is missing', () => {
    window.matchMedia = undefined as unknown as typeof window.matchMedia;
    const vp = TestBed.inject(Viewport);
    expect(vp.phone()).toBe(false);
    expect(vp.wide()).toBe(true);
  });
});
