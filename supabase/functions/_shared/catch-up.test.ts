import { deepStrictEqual as assertEquals } from 'node:assert';
import { type Left, matchInOrder, readPages } from './catch-up.ts';

/** A clock that runs out after `ticks` checks. */
const clock = (ticks: number) => () => ticks-- <= 0;
const never = () => false;

Deno.test(
  'every profile gets its first page before any backlog is read',
  async () => {
    const calls: string[] = [];
    // b is a new account with a backlog; a and c have less than a page
    const waiting = await matchInOrder(
      ['a', 'b', 'c'],
      (w, catchUp) => {
        calls.push(`${w}${catchUp ? '+' : ''}`);
        return Promise.resolve<Left>(w === 'b' && !catchUp ? 'more' : 'done');
      },
      never,
    );
    assertEquals(calls, ['a', 'b', 'c', 'b+']);
    assertEquals(waiting, []);
  },
);

Deno.test(
  'what is not reached, or not finished, in time is left waiting',
  async () => {
    // time for two first pages only
    assertEquals(
      await matchInOrder(
        ['a', 'b', 'c'],
        () => Promise.resolve<Left>('done'),
        clock(2),
      ),
      ['c'],
    );
    // the backlog outlasts the call
    assertEquals(
      await matchInOrder(['a'], () => Promise.resolve<Left>('more'), never),
      ['a'],
    );
    // out of time before the backlog is started
    const calls: boolean[] = [];
    assertEquals(
      await matchInOrder(
        ['a'],
        (_w, catchUp) => {
          calls.push(catchUp);
          return Promise.resolve<Left>('more');
        },
        clock(1),
      ),
      ['a'],
    );
    assertEquals(calls, [false]);
  },
);

Deno.test(
  'a profile that changed mid-run is left for the next call, not re-read from the stale row',
  async () => {
    const calls: string[] = [];
    const waiting = await matchInOrder(
      ['a', 'b'],
      (w, catchUp) => {
        calls.push(`${w}${catchUp ? '+' : ''}`);
        return Promise.resolve<Left>(w === 'a' ? 'again' : 'done');
      },
      never,
    );
    assertEquals(calls, ['a', 'b']);
    assertEquals(waiting, ['a']);
  },
);

Deno.test(
  'readPages reads one page, or the whole backlog when catching up',
  async () => {
    const pages = (full: number) => {
      let read = 0;
      return {
        page: () => Promise.resolve({ more: ++read <= full, lost: false }),
        count: () => read,
      };
    };
    // less than a page waiting
    let p = pages(0);
    assertEquals(await readPages(p.page, false, never), 'done');
    assertEquals(p.count(), 1);
    // a backlog, first pass: one page only
    p = pages(3);
    assertEquals(await readPages(p.page, false, never), 'more');
    assertEquals(p.count(), 1);
    // a backlog, catching up: three full pages and the last partial one
    p = pages(3);
    assertEquals(await readPages(p.page, true, never), 'done');
    assertEquals(p.count(), 4);
    // out of time after two pages
    p = pages(3);
    assertEquals(await readPages(p.page, true, clock(1)), 'more');
    assertEquals(p.count(), 2);
  },
);

Deno.test(
  'readPages stops at a page that could not be marked as read',
  async () => {
    let read = 0;
    assertEquals(
      await readPages(
        () => Promise.resolve({ more: true, lost: ++read === 2 }),
        true,
        never,
      ),
      'again',
    );
    assertEquals(read, 2);
  },
);
