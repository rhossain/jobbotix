// Opening a job post's page for extract-role.
//
// Two sites are never opened: LinkedIn and Upwork do not allow a tool to read
// their pages. That holds for the link the user pasted and for every address
// a redirect leads to, so redirects are followed here by hand, one hop at a
// time, and each hop is checked before it is requested. A short link or a
// tracking link that lands on either site stops before the request is made.

import { isUpworkUrl } from './gig.ts';
import { isLinkedInUrl } from './linkedin.ts';

export type NoReadSite = 'linkedin' | 'upwork';

/** The site, if this address is on one Jobbotix must never open. */
export function noReadSite(url: string): NoReadSite | null {
  if (isLinkedInUrl(url)) return 'linkedin';
  if (isUpworkUrl(url)) return 'upwork';
  return null;
}

export type OpenResult =
  | { ok: true; html: string }
  /** The link, or a redirect from it, is on a site that is never opened. */
  | { ok: false; reason: 'no-read'; site: NoReadSite }
  /** The page answered with an error status. */
  | { ok: false; reason: 'status'; status: number }
  /** No answer, too many redirects, or a redirect to nowhere. */
  | { ok: false; reason: 'failed' };

/** Redirects followed before giving up. */
export const MAX_REDIRECTS = 5;

const HEADERS = {
  'user-agent': 'Mozilla/5.0 (compatible; Jobbotix/1.0; +https://jobbotix.com)',
  accept: 'text/html,*/*',
};

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Fetches a page's HTML, following redirects itself. Never requests an
 * address on LinkedIn or Upwork. Never throws.
 */
export async function openPage(
  url: string,
  fetchImpl: Fetch = fetch,
  timeoutMs = 15_000,
): Promise<OpenResult> {
  const signal = AbortSignal.timeout(timeoutMs);
  let at = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const site = noReadSite(at);
    if (site) return { ok: false, reason: 'no-read', site };
    let res: Response;
    try {
      res = await fetchImpl(at, {
        headers: HEADERS,
        redirect: 'manual',
        signal,
      });
    } catch {
      return { ok: false, reason: 'failed' };
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      try {
        await res.body?.cancel();
      } catch {
        /* nothing to release */
      }
      if (!location) return { ok: false, reason: 'status', status: res.status };
      let next: URL;
      try {
        next = new URL(location, at);
      } catch {
        return { ok: false, reason: 'failed' };
      }
      if (next.protocol !== 'https:' && next.protocol !== 'http:')
        return { ok: false, reason: 'failed' };
      at = next.toString();
      continue;
    }
    if (!res.ok) return { ok: false, reason: 'status', status: res.status };
    try {
      return { ok: true, html: await res.text() };
    } catch {
      return { ok: false, reason: 'failed' };
    }
  }
  return { ok: false, reason: 'failed' };
}
