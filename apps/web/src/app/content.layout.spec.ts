import { TestBed } from '@angular/core/testing';
import { Auth } from './core/auth';
import { SharesRepo } from './core/data/repos';
import {
  horizontalOverflow,
  pageScrollsSideways,
  renderApp,
  report,
  resetStorage,
  waitForRendered,
  withDemoData,
  type ViewportName,
} from '../testing/layout';

/**
 * Real postings are messier than the sample data: very long titles, long
 * compound company names, tracking-laden URLs with no spaces, a dozen stack
 * chips. These specs load that kind of data and check the pages still fit
 * the narrowest screens, along with the empty state a new account sees and
 * every tab of a role.
 */

const UNBREAKABLE_URL =
  'https://careers.a-company-with-a-remarkably-long-domain-name.example/jobs/apply/senior-staff-principal-frontend-platform-engineer-design-systems?utm_source=jobbotix&utm_medium=referral&utm_campaign=autumn-hiring-push&ref=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const MESSY = {
  title:
    'Senior Staff Principal Frontend Platform Engineer, Design Systems & Developer Experience (Angular / TypeScript / Web Components) — Remote, EMEA',
  company: 'Versicherungsunternehmensgruppenholdinggesellschaft International',
  url: UNBREAKABLE_URL,
  location:
    'Remote within Europe, the Middle East and Africa; must overlap at least four hours with Central European Time',
  salary:
    '€120,000–€160,000 plus equity, an annual bonus and a learning budget',
  stack: [
    'Angular Signals and standalone components',
    'TypeScript',
    'RxJS',
    'NgRx SignalStore',
    'Nx monorepos',
    'Web Components / Lit',
    'Storybook',
    'Playwright',
    'Vitest',
    'Module Federation',
    'Design tokens',
    'WCAG 2.2 AA',
  ],
  notes: `Recruiter sent ${UNBREAKABLE_URL} twice; reference SUPERCALIFRAGILISTICEXPIALIDOCIOUSREFERENCECODE0123456789.`,
};

const PHONES: ViewportName[] = ['small phone', 'phone'];

function expectFits(where: string) {
  const { scrollWidth, clientWidth } = pageScrollsSideways();
  const overflow = horizontalOverflow();
  expect(
    scrollWidth,
    `${where}: page scrolls sideways (${scrollWidth}px in ${clientWidth}px)\n` +
      report('Elements past the edge', overflow),
  ).toBeLessThanOrEqual(clientWidth + 1);
  expect(
    overflow,
    `${where}\n` + report('Elements past the edge', overflow),
  ).toEqual([]);
}

describe('long, messy posting data', () => {
  beforeEach(async () => {
    resetStorage();
    await withDemoData((data) => {
      for (const role of data.roles.slice(0, 3)) {
        Object.assign(role, MESSY, {
          reasons: [MESSY.title, `Links to ${UNBREAKABLE_URL}`],
          gaps: [MESSY.location],
        });
      }
    });
  });

  describe.each(['/today', '/roles', '/board', '/insights'])('%s', (url) => {
    it.each([...PHONES, 'tablet'] as ViewportName[])(
      'fits at %s width',
      async (vp) => {
        await renderApp(url, vp);
        expectFits(`${url} at ${vp}`);
      },
    );
  });

  it.each([...PHONES, 'desktop'] as ViewportName[])(
    'fits the public shared-role and shared-board pages at %s width',
    async (vp) => {
      for (const kind of ['role', 'board'] as const) {
        const { router, settle } = await renderApp('/today', vp);
        const token = await TestBed.inject(SharesRepo).create(
          kind,
          'r-northwind',
        );
        await TestBed.inject(Auth).signOut();
        await router.navigateByUrl(`/s/${token}`);
        await settle();
        await waitForRendered('main#main h1', settle);
        expectFits(`shared ${kind} page at ${vp}`);
        TestBed.resetTestingModule();
      }
    },
  );

  it.each(PHONES)('fits every role tab at %s width', async (vp) => {
    const { settle } = await renderApp('/roles/r-northwind', vp);
    const tabs = [
      ...document.querySelectorAll<HTMLButtonElement>('[id^="role-tab-"]'),
    ];
    expect(tabs.length).toBeGreaterThanOrEqual(5);
    for (const tab of tabs) {
      tab.click();
      await settle();
      const panel = tab.getAttribute('aria-controls');
      if (panel) await waitForRendered(`#${panel}`, settle);
      expectFits(`role tab "${tab.textContent?.trim()}" at ${vp}`);
    }
  });
});

describe('every tab of a role (sample data)', () => {
  beforeEach(() => resetStorage());

  it.each([
    'small phone',
    'tablet',
    'small laptop',
    'desktop',
  ] as ViewportName[])('fits at %s width', async (vp) => {
    const { settle } = await renderApp('/roles/r-northwind', vp);
    const tabs = [
      ...document.querySelectorAll<HTMLButtonElement>('[id^="role-tab-"]'),
    ];
    for (const tab of tabs) {
      tab.click();
      await settle();
      expectFits(`role tab "${tab.textContent?.trim()}" at ${vp}`);
    }
  });
});

describe('a brand-new account with no roles yet', () => {
  beforeEach(async () => {
    resetStorage();
    await withDemoData((data) => {
      data.roles = [];
      data.events = [];
    });
  });

  describe.each(['/today', '/roles', '/board', '/insights'])('%s', (url) => {
    it.each(PHONES)('fits at %s width', async (vp) => {
      await renderApp(url, vp);
      expectFits(`${url} (empty) at ${vp}`);
    });
  });
});
