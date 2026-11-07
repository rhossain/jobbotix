import { TestBed } from '@angular/core/testing';
import { Toast } from '../shared/toast';
import {
  VIEWPORTS,
  expectedShell,
  horizontalOverflow,
  isRendered,
  renderApp,
  report,
  resetStorage,
  setViewport,
  smallTargets,
  waitForRendered,
  type ViewportName,
} from '../../testing/layout';
import { Confirm } from '../ui/confirm';
import { ShellState } from './shell-state';
import { Tour } from './tour';

/**
 * The app shell at every width, measured in a real browser: which navigation
 * shows, that it never overlaps the page, that it follows a rotate or resize
 * live, and that sheets, the palette, dialogs and toasts fit a phone screen.
 */

/** The element's box; fails the test with its name when it is missing. */
function box(sel: string): DOMRect {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`${sel} is not on the page`);
  return el.getBoundingClientRect();
}

const NAMES = Object.keys(VIEWPORTS) as ViewportName[];

/** Asserts the navigation that belongs at a width, and that it fits. */
function expectShellFor(width: number) {
  const kind = expectedShell(width);
  const sidebar = document.querySelector('jb-sidebar');
  const tabBar = document.querySelector('jb-tab-bar');
  const topBar = document.querySelector('jb-top-bar');
  const shell = document.querySelector('.jb-shell');
  const main = box('main#main');

  if (kind === 'phone') {
    expect(sidebar, 'no sidebar on a phone').toBeNull();
    expect(tabBar && isRendered(tabBar), 'tab bar on a phone').toBe(true);
    expect(topBar && isRendered(topBar), 'top bar on a phone').toBe(true);
    const bar = box('jb-tab-bar');
    expect(Math.round(bar.bottom)).toBe(window.innerHeight);
    expect(Math.round(bar.width)).toBe(document.documentElement.clientWidth);
    // The page uses the full width, minus the gutters.
    expect(main.left).toBeLessThanOrEqual(1);
    return;
  }

  expect(tabBar, 'no tab bar from 768px up').toBeNull();
  expect(topBar, 'no phone top bar from 768px up').toBeNull();
  expect(sidebar && isRendered(sidebar), 'sidebar from 768px up').toBe(true);
  expect(shell?.getAttribute('data-rail')).toBe(String(kind === 'rail'));
  const side = box('jb-sidebar');
  const css = getComputedStyle(document.documentElement);
  const expectedWidth = parseFloat(
    css.getPropertyValue(kind === 'rail' ? '--rail-w' : '--sidebar-w'),
  );
  expect(Math.round(side.width)).toBe(expectedWidth);
  expect(main.left, 'page starts after the sidebar').toBeGreaterThanOrEqual(
    side.right - 1,
  );
  // The sidebar stays put while the page scrolls.
  window.scrollTo(0, 400);
  expect(Math.round(box('jb-sidebar').top)).toBe(0);
  window.scrollTo(0, 0);
}

describe('app shell', () => {
  beforeEach(() => resetStorage());

  it.each(NAMES)('shows the right navigation at %s width', async (vp) => {
    await renderApp('/roles', vp);
    expectShellFor(VIEWPORTS[vp].width);
  });

  it('follows a phone rotating to landscape and back', async () => {
    const { settle } = await renderApp('/today', 'phone');
    expectShellFor(390);

    await setViewport({ width: 844, height: 390, touch: true });
    await settle();
    expectShellFor(844);
    expect(horizontalOverflow()).toEqual([]);

    await setViewport(VIEWPORTS.phone);
    await settle();
    expectShellFor(390);
    expect(horizontalOverflow()).toEqual([]);
  });

  it('follows a desktop window resized past each breakpoint', async () => {
    const { settle } = await renderApp('/board', 'desktop');
    for (const width of [1440, 1279, 1280, 900, 768, 767, 500, 1440]) {
      await setViewport({ width, height: 900, touch: false });
      await settle();
      expectShellFor(width);
      const overflow = horizontalOverflow();
      expect(
        overflow,
        `at ${width}px\n` + report('Past the edge', overflow),
      ).toEqual([]);
    }
  });

  it('keeps the collapsed sidebar a rail even on wide screens', async () => {
    const { settle } = await renderApp('/today', 'desktop');
    TestBed.inject(ShellState).sidebarCollapsed.set(true);
    await settle();
    expect(document.querySelector('.jb-shell')?.getAttribute('data-rail')).toBe(
      'true',
    );
    const rail = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--rail-w'),
    );
    expect(Math.round(box('jb-sidebar').width)).toBe(rail);
  });

  it.each(['small phone', 'phone'] as ViewportName[])(
    'gives every tab bar item a full-height touch target at %s width',
    async (vp) => {
      await renderApp('/today', vp);
      const tabs = [
        ...document.querySelectorAll('jb-tab-bar a, jb-tab-bar button'),
      ];
      expect(tabs.length).toBeGreaterThanOrEqual(4);
      for (const t of tabs) {
        const r = t.getBoundingClientRect();
        expect(
          r.height,
          `${t.textContent?.trim()} height`,
        ).toBeGreaterThanOrEqual(44);
        expect(
          r.width,
          `${t.textContent?.trim()} width`,
        ).toBeGreaterThanOrEqual(44);
      }
    },
  );

  it('keeps the phone top bar pinned while the page scrolls', async () => {
    await renderApp('/roles', 'phone');
    window.scrollTo(0, 600);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(Math.round(box('jb-top-bar').top)).toBeLessThanOrEqual(0);
    expect(Math.round(box('jb-top-bar').bottom)).toBeGreaterThan(0);
    window.scrollTo(0, 0);
  });
});

describe('overlays on a small phone', () => {
  beforeEach(() => resetStorage());

  /** An open overlay panel must sit wholly inside the screen. */
  async function expectInsideScreen(sel: string, settle: () => Promise<void>) {
    const el = await waitForRendered(sel, settle);
    const r = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const at = ` (panel ${Math.round(r.left)},${Math.round(r.top)} to ${Math.round(r.right)},${Math.round(r.bottom)} in ${vw}×${window.innerHeight})`;
    expect(r.left, `${sel} left edge` + at).toBeGreaterThanOrEqual(-1);
    expect(r.right, `${sel} right edge` + at).toBeLessThanOrEqual(vw + 1);
    expect(r.top, `${sel} top edge` + at).toBeGreaterThanOrEqual(-1);
    expect(r.bottom, `${sel} bottom edge` + at).toBeLessThanOrEqual(
      window.innerHeight + 1,
    );
    const overflow = horizontalOverflow(el);
    expect(
      overflow,
      report('Inside the panel, past the edge', overflow),
    ).toEqual([]);
    const small = smallTargets(24, el);
    expect(small, report('Controls under 24×24px', small)).toEqual([]);
  }

  it('opens the More sheet inside the screen', async () => {
    const { settle } = await renderApp('/today', 'small phone');
    TestBed.inject(ShellState).moreOpen.set(true);
    await expectInsideScreen('jb-more-sheet .jb-sheet-panel', settle);
  });

  it('opens the command palette inside the screen', async () => {
    const { settle } = await renderApp('/today', 'small phone');
    TestBed.inject(ShellState).paletteOpen.set(true);
    await expectInsideScreen('.jb-palette .jb-dialog-panel', settle);
  });

  it('opens a confirm dialog inside the screen', async () => {
    const { settle } = await renderApp('/roles', 'small phone');
    void TestBed.inject(Confirm).ask({
      title: 'Delete this role and everything drafted for it?',
      body: 'This removes the cover letter, the resume variant and the notes. It cannot be undone.',
      action: 'Delete role',
      danger: true,
    });
    await expectInsideScreen('jb-confirm-host .jb-dialog-panel', settle);
  });

  it('keeps every step of the first-run tour inside the screen', async () => {
    resetStorage({ tour: true });
    const { settle } = await renderApp('/today', 'small phone');
    const tour = TestBed.inject(Tour);
    // It starts on its own for a new user; drive it step by step from there.
    await waitForRendered('jb-tour .card', settle);
    for (let i = 0; i < tour.steps.length; i++) {
      tour.start(i);
      await expectInsideScreen('jb-tour .card', settle);
    }
  });

  it('stacks toasts above the tab bar, inside the screen', async () => {
    const { settle } = await renderApp('/today', 'small phone');
    const toast = TestBed.inject(Toast);
    toast.show('Saved');
    toast.error('Could not reach the server; your note is kept and will retry');
    await waitForRendered('jb-toast-host li', settle);
    const bar = box('jb-tab-bar');
    const toasts = [...document.querySelectorAll('jb-toast-host li')].filter(
      isRendered,
    );
    expect(toasts.length).toBeGreaterThan(0);
    for (const t of toasts) {
      const r = t.getBoundingClientRect();
      expect(r.bottom, 'toast clears the tab bar').toBeLessThanOrEqual(
        bar.top + 1,
      );
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.right).toBeLessThanOrEqual(document.documentElement.clientWidth);
    }
  });
});
