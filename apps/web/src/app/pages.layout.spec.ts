import {
  VIEWPORTS,
  clippedContent,
  contentBehindTabBar,
  horizontalOverflow,
  pageScrollsSideways,
  renderApp,
  report,
  resetStorage,
  smallTargets,
  tinyText,
  zoomingInputs,
  type ViewportName,
} from '../testing/layout';

/**
 * Responsive sweep: every page at every width, measured in a real browser.
 *
 * For each page and width it checks that nothing makes the page scroll
 * sideways or pokes past the screen edge, that no text drops below 11px,
 * that phone-sized controls are big enough to tap (WCAG 2.2 target size),
 * and that the phone tab bar never covers the end of the page.
 */

interface PageCase {
  url: string;
  name: string;
  signedOut?: boolean;
}

const SIGNED_IN: PageCase[] = [
  { name: 'Today', url: '/today' },
  { name: 'Roles', url: '/roles' },
  { name: 'Add a role', url: '/roles/new' },
  { name: 'Role detail', url: '/roles/r-northwind' },
  { name: 'Board', url: '/board' },
  { name: 'Insights', url: '/insights' },
  { name: 'AI usage', url: '/usage' },
  { name: 'Sources', url: '/sources' },
  { name: 'Search profile', url: '/search' },
  { name: 'Master resume', url: '/resume' },
  { name: 'Settings', url: '/settings' },
  { name: 'Admin', url: '/admin' },
  { name: 'Invite codes', url: '/admin/invites' },
  { name: 'UI kit', url: '/_ui' },
];

const PUBLIC: PageCase[] = [
  { name: 'Landing', url: '/', signedOut: true },
  { name: 'Privacy', url: '/privacy', signedOut: true },
  { name: 'Sign in', url: '/login', signedOut: true },
  { name: 'Sign up', url: '/signup', signedOut: true },
  { name: 'Forgot password', url: '/forgot-password', signedOut: true },
  { name: 'Reset password', url: '/reset-password', signedOut: true },
];

const PHONES: ViewportName[] = ['small phone', 'phone', 'large phone'];

describe.each([...SIGNED_IN, ...PUBLIC])('$name ($url)', (pageCase) => {
  beforeEach(() => resetStorage());

  it.each(Object.keys(VIEWPORTS) as ViewportName[])(
    'fits the screen at %s width',
    async (vp) => {
      await renderApp(pageCase.url, vp, { signedOut: pageCase.signedOut });

      const { scrollWidth, clientWidth } = pageScrollsSideways();
      const overflow = horizontalOverflow();
      expect(
        scrollWidth,
        `page scrolls sideways (${scrollWidth}px of content in ${clientWidth}px)\n` +
          report('Elements past the edge', overflow),
      ).toBeLessThanOrEqual(clientWidth + 1);
      expect(overflow, report('Elements past the edge', overflow)).toEqual([]);

      const tiny = tinyText();
      expect(tiny, report('Text below 11px', tiny)).toEqual([]);

      const clipped = clippedContent();
      expect(clipped, report('Cut off by a clipping box', clipped)).toEqual([]);

      if (VIEWPORTS[vp].touch) {
        const zooming = zoomingInputs();
        expect(
          zooming,
          report('Text fields under 16px (iOS zooms in on focus)', zooming),
        ).toEqual([]);
      }
    },
  );

  it.each(PHONES)('has tappable controls at %s width', async (vp) => {
    await renderApp(pageCase.url, vp, { signedOut: pageCase.signedOut });
    const small = smallTargets(24);
    expect(small, report('Controls under 24×24px', small)).toEqual([]);
  });

  if (!pageCase.signedOut) {
    it.each(PHONES)(
      'keeps the end of the page above the tab bar at %s width',
      async (vp) => {
        const { settle } = await renderApp(pageCase.url, vp);
        const hidden = await contentBehindTabBar(settle);
        expect(hidden, hidden ?? '').toBeNull();
      },
    );
  }
});
