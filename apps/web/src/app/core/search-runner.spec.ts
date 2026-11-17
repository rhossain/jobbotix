import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { SearchProfileRow } from '@jobbotix/shared-types';
import {
  RolesRepo,
  SearchProfileRepo,
  type SearchNowResult,
} from './data/repos';
import { SearchRunner, awaitsSearch } from './search-runner';

const profile = (over: Partial<SearchProfileRow> = {}): SearchProfileRow =>
  ({
    id: 'p1',
    updated_at: '2026-11-17T06:00:00Z',
    target_roles: ['QA Engineer'],
    stacks: [],
    last_matched_at: null,
    ...over,
  }) as SearchProfileRow;

const stretch = (over: Partial<SearchNowResult> = {}): SearchNowResult => ({
  done: true,
  busy: false,
  searched: 0,
  added: 0,
  ...over,
});

function setup(
  rows: SearchProfileRow[],
  replies: (SearchNowResult | Error)[] = [stretch()],
) {
  const profiles = signal(rows);
  const searchNow = vi.fn(async () => {
    const next = replies.shift() ?? stretch();
    if (next instanceof Error) throw next;
    return next;
  });
  // the server marks every search as read when the run ends
  const loadProfiles = vi.fn(async () => {
    profiles.update((list) =>
      list.map((p) => ({ ...p, last_matched_at: '2026-11-17T07:00:00Z' })),
    );
  });
  const loadRoles = vi.fn(async () => undefined);
  TestBed.configureTestingModule({
    providers: [
      {
        provide: SearchProfileRepo,
        useValue: {
          profiles,
          loaded: signal(true),
          load: loadProfiles,
          searchNow,
        },
      },
      { provide: RolesRepo, useValue: { load: loadRoles } },
    ],
  });
  const runner = TestBed.inject(SearchRunner);
  const pause = vi.fn(async () => undefined);
  (runner as unknown as { pause: typeof pause }).pause = pause;
  return { runner, profiles, searchNow, loadProfiles, loadRoles, pause };
}

describe('awaitsSearch', () => {
  it('is a search with something to look for that has not been run yet', () => {
    expect(awaitsSearch(profile())).toBe(true);
    expect(
      awaitsSearch(profile({ target_roles: [], stacks: ['cypress'] })),
    ).toBe(true);
    // nothing to look for yet
    expect(awaitsSearch(profile({ target_roles: [], stacks: [] }))).toBe(false);
    // already run
    expect(
      awaitsSearch(profile({ last_matched_at: '2026-11-17T05:50:00Z' })),
    ).toBe(false);
  });
});

describe('SearchRunner', () => {
  it('runs a new search at once, a stretch at a time, and adds up what it found', async () => {
    const { runner, searchNow, loadRoles, loadProfiles } = setup(
      [profile()],
      [
        stretch({ done: false, searched: 2400, added: 3 }),
        stretch({ done: false, searched: 2400, added: 0 }),
        stretch({ done: true, searched: 900, added: 6 }),
      ],
    );
    await runner.ensure();
    expect(searchNow).toHaveBeenCalledTimes(3);
    expect(runner.state()).toBe('finished');
    expect(runner.searched()).toBe(5700);
    expect(runner.added()).toBe(9);
    // jobs are loaded as they are found (twice) and once more at the end
    expect(loadRoles).toHaveBeenCalledTimes(3);
    expect(loadProfiles).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no search is waiting', async () => {
    const { runner, searchNow } = setup([
      profile({ last_matched_at: '2026-11-17T05:50:00Z' }),
      profile({ id: 'p2', target_roles: [], stacks: [] }),
    ]);
    await runner.ensure();
    expect(searchNow).not.toHaveBeenCalled();
    expect(runner.state()).toBe('idle');
  });

  it('asks once for a search the server leaves unread, and again after it is changed', async () => {
    const { runner, searchNow, loadProfiles, profiles } = setup([profile()]);
    // a search over the plan's limit is kept but never run
    loadProfiles.mockImplementation(async () => undefined);
    await runner.ensure();
    await runner.ensure();
    expect(searchNow).toHaveBeenCalledTimes(1);
    profiles.set([profile({ updated_at: '2026-11-17T08:00:00Z' })]);
    await runner.ensure();
    expect(searchNow).toHaveBeenCalledTimes(2);
  });

  it('waits and asks again while the hourly search is on the account', async () => {
    const { runner, searchNow, pause } = setup(
      [profile()],
      [
        stretch({ done: false, busy: true }),
        stretch({ done: true, searched: 40, added: 1 }),
      ],
    );
    await runner.ensure();
    expect(pause).toHaveBeenCalledTimes(1);
    expect(searchNow).toHaveBeenCalledTimes(2);
    expect(runner.added()).toBe(1);
  });

  it('runs once more when preferences are saved during a run', async () => {
    const { runner, searchNow } = setup([profile()]);
    let saved = false;
    searchNow.mockImplementation(async () => {
      if (!saved) {
        saved = true;
        void runner.start(); // Save pressed while the first run is going
      }
      return stretch({ searched: 10 });
    });
    await runner.start();
    expect(searchNow).toHaveBeenCalledTimes(2);
    expect(runner.state()).toBe('finished');
  });

  it('ends quietly when the server cannot run it, and keeps what a failed run found', async () => {
    const down = setup([profile()], [new Error('Not allowed')]);
    await down.runner.ensure();
    expect(down.runner.state()).toBe('unavailable');
    // not asked again on the next page
    await down.runner.ensure();
    expect(down.searchNow).toHaveBeenCalledTimes(1);

    TestBed.resetTestingModule();
    const cut = setup(
      [profile()],
      [stretch({ done: false, searched: 800, added: 2 }), new Error('offline')],
    );
    await cut.runner.ensure();
    expect(cut.runner.state()).toBe('finished');
    expect(cut.runner.added()).toBe(2);
  });

  it('gives up after a bounded number of stretches', async () => {
    const { runner, searchNow } = setup([profile()]);
    searchNow.mockImplementation(async () => stretch({ done: false }));
    await runner.ensure();
    expect(searchNow).toHaveBeenCalledTimes(30);
    expect(runner.state()).toBe('finished');
  });
});
