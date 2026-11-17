import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { SwUpdate } from '@angular/service-worker';
import { Toast } from '../shared/toast';
import { StaleBuild, isStaleBuildError } from './stale-build';

function setup(opts: { online?: boolean; sw?: boolean; found?: boolean } = {}) {
  const store = new Map<string, string>();
  const assign = vi.fn();
  const reload = vi.fn();
  const checkForUpdate = vi.fn().mockResolvedValue(opts.found ?? true);
  const activateUpdate = vi.fn().mockResolvedValue(true);
  TestBed.configureTestingModule({
    providers: [
      {
        provide: SwUpdate,
        useValue: {
          isEnabled: opts.sw ?? false,
          checkForUpdate,
          activateUpdate,
        },
      },
      {
        provide: DOCUMENT,
        useValue: {
          defaultView: {
            navigator: { onLine: opts.online ?? true },
            location: { assign, reload },
            sessionStorage: {
              getItem: (k: string) => store.get(k) ?? null,
              setItem: (k: string, v: string) => store.set(k, v),
            },
          },
        },
      },
    ],
  });
  return {
    stale: TestBed.inject(StaleBuild),
    toast: TestBed.inject(Toast),
    assign,
    reload,
    checkForUpdate,
    activateUpdate,
    store,
  };
}

/** Lets the reload's awaits run. */
const settle = () => new Promise((done) => setTimeout(done, 0));

describe('isStaleBuildError', () => {
  it("knows each browser's wording for a page file that is gone", () => {
    for (const message of [
      'Failed to fetch dynamically imported module: https://jobbotix.com/chunk-DG3MdnOm.js',
      'error loading dynamically imported module: https://jobbotix.com/chunk-DG3MdnOm.js',
      'Importing a module script failed.',
      'Loading chunk 42 failed.',
    ])
      expect(isStaleBuildError(new TypeError(message))).toBe(true);
    // as the router's rejected navigation reaches the error handler
    expect(
      isStaleBuildError({
        rejection: new TypeError(
          'Failed to fetch dynamically imported module: https://jobbotix.com/chunk-x.js',
        ),
      }),
    ).toBe(true);
  });

  it('leaves every other error alone', () => {
    expect(isStaleBuildError(new TypeError('Failed to fetch'))).toBe(false);
    expect(isStaleBuildError(new Error('x is not a function'))).toBe(false);
    expect(isStaleBuildError(null)).toBe(false);
  });
});

describe('StaleBuild', () => {
  it('loads the page the person was opening, on the new build', async () => {
    const { stale, assign, reload, checkForUpdate } = setup();
    expect(stale.recover('/board')).toBe(true);
    await settle();
    expect(assign).toHaveBeenCalledWith('/board');
    expect(reload).not.toHaveBeenCalled();
    // no service worker in charge: nothing to switch
    expect(checkForUpdate).not.toHaveBeenCalled();
  });

  it('reloads where it is when the page is not known', async () => {
    const { stale, assign, reload } = setup();
    expect(stale.recover()).toBe(true);
    await settle();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
  });

  it('moves the service worker to the new build before loading the page', async () => {
    const { stale, assign, checkForUpdate, activateUpdate } = setup({
      sw: true,
    });
    stale.recover('/today');
    expect(assign).not.toHaveBeenCalled();
    await settle();
    expect(checkForUpdate).toHaveBeenCalledTimes(1);
    expect(activateUpdate).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/today');
  });

  it('reloads once: the same error again is one reload, and a failure after it is a real error', async () => {
    const first = setup();
    expect(first.stale.recover('/board')).toBe(true);
    // the navigation's rejection arrives at the error handler a moment later
    expect(first.stale.recover()).toBe(true);
    await settle();
    expect(first.assign).toHaveBeenCalledTimes(1);

    // the page after that reload: the file is still missing
    const mark = first.store.get('jb-stale-reload') ?? '';
    TestBed.resetTestingModule();
    const second = setup();
    second.store.set('jb-stale-reload', mark);
    expect(second.stale.recover('/board')).toBe(false);
    await settle();
    expect(second.assign).not.toHaveBeenCalled();
    expect(second.toast.items()[0].message).toMatch(
      /^Could not load this page/,
    );
  });

  it('does not reload a device that is offline', async () => {
    const { stale, assign, reload, toast } = setup({ online: false });
    // dealt with: being offline is not an error to report
    expect(stale.recover('/board')).toBe(true);
    await settle();
    expect(assign).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(toast.items()[0].message).toContain('offline');
  });
});
