// Budgeted, polite HTTP for adapters: one request at a time, a pause between
// requests, a hard cap from source_catalog, failures collected as warnings.
// An adapter calls fail() at the end, which throws only when every request
// failed, so one bad page never sinks a run but a dead feed is reported.

import { USER_AGENT, type AdapterContext } from './types.ts';

export interface RequestOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
}

export interface Fetcher {
  json(url: string, opts?: RequestOptions): Promise<unknown | null>;
  text(url: string): Promise<string | null>;
  readonly requests: number;
  readonly warnings: string[];
  readonly left: number;
  /** Throws when every request this run made failed. */
  assertSomeSucceeded(source: string): void;
}

export function fetcher(ctx: AdapterContext, delayMs = 500): Fetcher {
  let requests = 0;
  let failures = 0;
  const warnings: string[] = [];

  const get = async (
    url: string,
    accept: string,
    opts: RequestOptions = {},
  ): Promise<Response | null> => {
    if (requests >= ctx.maxRequests) return null;
    if (requests > 0) await ctx.sleep(delayMs);
    requests++;
    try {
      const res = await ctx.fetch(url, {
        method: opts.method ?? 'GET',
        headers: {
          'user-agent': USER_AGENT,
          accept,
          ...(opts.body !== undefined
            ? { 'content-type': 'application/json' }
            : {}),
          ...(opts.headers ?? {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(25_000),
      });
      if (!res.ok) {
        failures++;
        warnings.push(`${res.status} from ${redact(url)}`);
        return null;
      }
      return res;
    } catch (e) {
      failures++;
      warnings.push(`${(e as Error).message} for ${redact(url)}`);
      return null;
    }
  };

  return {
    async json(url, opts) {
      const res = await get(url, 'application/json', opts);
      if (!res) return null;
      try {
        return await res.json();
      } catch {
        failures++;
        warnings.push(`Not JSON: ${redact(url)}`);
        return null;
      }
    },
    async text(url) {
      const res = await get(
        url,
        'application/rss+xml, application/xml, text/xml, */*',
      );
      return res ? await res.text() : null;
    },
    get requests() {
      return requests;
    },
    get warnings() {
      return warnings;
    },
    get left() {
      return ctx.maxRequests - requests;
    },
    assertSomeSucceeded(source) {
      if (requests > 0 && failures === requests)
        throw new Error(
          `Every ${source} request failed: ${warnings.slice(0, 3).join('; ')}`,
        );
    },
  };
}

/** URLs go into run logs: keys in a query string or a keyed path never do. */
export function redact(url: string): string {
  return url
    .replace(
      /([?&](?:app_id|app_key|api_key|apikey|key|token)=)[^&]*/gi,
      '$1***',
    )
    .replace(/(jooble\.org\/api\/)[^/?#]+/i, '$1***');
}

/** Keeps drafts newer than ctx.since (undated ones too) and drops repeats by external id. */
export function keepRecent<
  T extends { external_id: string; posted_at: string | null },
>(items: (T | null)[], since: Date): T[] {
  const seen = new Map<string, T>();
  for (const d of items) {
    if (!d) continue;
    if (d.posted_at && Date.parse(d.posted_at) < since.getTime()) continue;
    if (!seen.has(d.external_id)) seen.set(d.external_id, d);
  }
  return [...seen.values()];
}

/** "Worldwide" style location text to the pool's remote fields. */
export function remoteFields(
  where: string[],
  parse: (items: string[]) => {
    worldwide: boolean;
    countries: string[];
    regions: string[];
  },
): Pick<
  import('./types.ts').DraftPosting,
  'location' | 'remote_policy' | 'hiring_countries' | 'hiring_regions'
> {
  const items = where.map((w) => w.trim()).filter(Boolean);
  if (!items.length)
    return {
      location: 'Remote',
      remote_policy: 'unknown',
      hiring_countries: [],
      hiring_regions: [],
    };
  const loc = parse(items);
  if (loc.worldwide && !loc.countries.length && !loc.regions.length)
    return {
      location: 'Remote, worldwide',
      remote_policy: 'worldwide',
      hiring_countries: [],
      hiring_regions: [],
    };
  if (!loc.countries.length && !loc.regions.length)
    return {
      location: `Remote: ${items.join(', ')}`.slice(0, 300),
      remote_policy: 'unknown',
      hiring_countries: [],
      hiring_regions: [],
    };
  return {
    location: `Remote: ${items.join(', ')}`.slice(0, 300),
    remote_policy: 'region_locked',
    hiring_countries: loc.countries,
    hiring_regions: loc.regions,
  };
}
