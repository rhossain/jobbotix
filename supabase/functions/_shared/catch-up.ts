// The order match-postings works through search profiles in.
//
// The pool is read a page at a time from each profile's watermark. Most
// profiles have less than a page waiting; a new account, or one whose
// preferences just changed, has the last 30 days. Every profile gets its
// first page before any of them gets a second, so one account's backlog
// never keeps the others waiting, and the backlogs are then read to the end
// for as long as the call has time.

/**
 * What matching one profile left behind: 'done' when nothing is waiting,
 * 'more' when further pages are, and 'again' when the row in hand went out
 * of date mid-run (the user changed their preferences) and has to be read
 * afresh by the next call.
 */
export type Left = 'done' | 'more' | 'again';

/**
 * Runs `run` over `work` and returns the items that still have postings
 * waiting when the call ends: those not reached in time, those whose backlog
 * outlasted it, and those that have to be read again.
 */
export async function matchInOrder<W>(
  work: W[],
  run: (w: W, catchUp: boolean) => Promise<Left>,
  outOfTime: () => boolean,
): Promise<W[]> {
  const waiting: W[] = [];
  const behind: W[] = [];
  for (const w of work) {
    if (outOfTime()) {
      waiting.push(w);
      continue;
    }
    const left = await run(w, false);
    if (left === 'more') behind.push(w);
    if (left === 'again') waiting.push(w);
  }
  for (const w of behind)
    if (outOfTime() || (await run(w, true)) !== 'done') waiting.push(w);
  return waiting;
}

/**
 * Reads one profile's pages: the first, or (catchUp) every page waiting for
 * as long as there is time. `page` matches one page and says whether it was
 * full (`more`) and whether it could not be marked as read (`lost`).
 */
export async function readPages(
  page: () => Promise<{ more: boolean; lost: boolean }>,
  catchUp: boolean,
  outOfTime: () => boolean,
): Promise<Left> {
  for (;;) {
    const r = await page();
    // Not marked as read: reading on would read the same page again.
    if (r.lost) return 'again';
    if (!r.more) return 'done';
    if (!catchUp || outOfTime()) return 'more';
  }
}
