// POST /functions/v1/fetch-sources      (pg_cron every 6 hours, or by hand)
//   Authorization: Bearer <CRON_SECRET>
//   { "sources": ["himalayas"] }   optional: run only these (enabled or not)
//
// Runs each enabled adapter in source_catalog with search terms built from
// every active search profile, merges what comes back into the shared
// postings pool (ingest_postings) and records the run's health. Scoring and
// filing roles for users is match-postings' job; this function never touches
// a user's data.

import { json, requireCronSecret, serviceClient } from '../_shared/auth.ts';
import { buildQueries } from '../_shared/queries.ts';
import { finishPosting } from '../_shared/sources/normalise.ts';
import { ADAPTERS } from '../_shared/sources/registry.ts';
import type { CompanyTarget, PoolPosting } from '../_shared/sources/types.ts';

const DEFAULT_LOOKBACK_DAYS = 3;
const CHUNK = 150;

interface RunSummary {
  source: string;
  requests: number;
  fetched: number;
  inserted: number;
  updated: number;
  warnings: string[];
  error?: string;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const denied = requireCronSecret(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as {
    sources?: string[];
    /** Company careers only: poll followed companies, not discovered ones. */
    followedOnly?: boolean;
  };
  const admin = serviceClient();

  let catalog = admin
    .from('source_catalog')
    .select('id, max_requests_per_run, last_success_at');
  catalog =
    Array.isArray(body.sources) && body.sources.length
      ? catalog.in('id', body.sources)
      : catalog.eq('enabled', true);
  const [
    { data: sources, error: catErr },
    { data: profiles, error: profErr },
    { data: setting },
  ] = await Promise.all([
    catalog,
    admin
      .from('search_profiles')
      .select('target_roles, stacks, home_country, allowed_countries')
      .eq('active', true),
    admin.from('settings').select('value').eq('key', 'sourcing').maybeSingle(),
  ]);
  if (catErr || profErr)
    return json(500, { error: (catErr ?? profErr)!.message });

  const queries = buildQueries(
    (profiles ?? []).map((p) => ({
      target_roles: p.target_roles ?? [],
      stacks: p.stacks ?? [],
    })),
  );
  if (!queries.length)
    return json(200, { queries, runs: [], note: 'No active search profiles' });

  // Every distinct designation, so sources that list all of a company's jobs
  // keep the ones some user is looking for, whatever the profession.
  const roles = [
    ...new Set(
      (profiles ?? []).flatMap((p) =>
        ((p.target_roles ?? []) as string[])
          .map((r) => r.trim())
          .filter(Boolean),
      ),
    ),
  ].slice(0, 500);

  // Countries users can work in, most common first, for country-scoped sources.
  const tally = new Map<string, number>();
  for (const p of profiles ?? [])
    for (const c of [p.home_country, ...(p.allowed_countries ?? [])])
      if (typeof c === 'string' && c) tally.set(c, (tally.get(c) ?? 0) + 1);
  const countries = [...tally.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([c]) => c);

  const lookbackDays =
    Number(
      (setting?.value as Record<string, unknown> | null)?.['lookback_days'],
    ) || DEFAULT_LOOKBACK_DAYS;
  const runs: RunSummary[] = [];

  for (const s of sources ?? []) {
    const started = new Date();
    const adapter = ADAPTERS[s.id];
    const run: RunSummary = {
      source: s.id,
      requests: 0,
      fetched: 0,
      inserted: 0,
      updated: 0,
      warnings: [],
    };
    try {
      if (!adapter) throw new Error(`No adapter is built for "${s.id}" yet`);
      // Page back to the last good run (with a day's overlap), never past the lookback window.
      const floor = Date.now() - lookbackDays * 86_400_000;
      const last = s.last_success_at
        ? Date.parse(s.last_success_at) - 86_400_000
        : floor;
      const since = new Date(Math.max(floor, last));

      const companies =
        s.id === 'ats'
          ? await companyTargets(
              admin,
              s.max_requests_per_run,
              body.followedOnly === true,
            )
          : undefined;

      const result = await adapter.run({
        queries,
        roles,
        since,
        maxRequests: s.max_requests_per_run,
        fetch: globalThis.fetch.bind(globalThis),
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        countries,
        secret: (name) => Deno.env.get(name),
        companies,
      });
      if (result.companies?.length)
        await admin.rpc('record_company_polls', { p: result.companies });
      run.requests = result.requests;
      run.warnings = result.warnings.slice(0, 10);

      const byKey = new Map<string, PoolPosting>();
      for (const d of result.postings) {
        const p = await finishPosting(d);
        if (!byKey.has(p.dedupe_key)) byKey.set(p.dedupe_key, p);
      }
      const rows = [...byKey.values()];
      run.fetched = rows.length;

      for (let i = 0; i < rows.length; i += CHUNK) {
        const { data, error } = await admin.rpc('ingest_postings', {
          p_source: s.id,
          p_rows: rows.slice(i, i + CHUNK),
        });
        if (error) throw new Error(`ingest_postings: ${error.message}`);
        const r = data as { inserted: number; updated: number };
        run.inserted += r.inserted;
        run.updated += r.updated;
      }
    } catch (e) {
      run.error = (e as Error).message;
    }

    await admin.rpc('record_source_run', {
      p_source: s.id,
      p_started: started.toISOString(),
      p_requests: run.requests,
      p_fetched: run.fetched,
      p_inserted: run.inserted,
      p_updated: run.updated,
      p_error: run.error ?? null,
    });
    runs.push(run);
  }

  return json(200, { queries, runs });
});

/**
 * Companies to poll this run: every followed company first (oldest poll
 * first), then, unless followedOnly, companies discovered in the pool, up to
 * one request each within the source's budget.
 */
async function companyTargets(
  admin: ReturnType<typeof serviceClient>,
  budget: number,
  followedOnly: boolean,
): Promise<CompanyTarget[]> {
  const cols = 'id, ats_kind, ats_slug, name';
  const toTarget = (c: {
    id: string;
    ats_kind: CompanyTarget['kind'];
    ats_slug: string;
    name: string;
  }): CompanyTarget => ({
    id: c.id,
    kind: c.ats_kind,
    slug: c.ats_slug,
    name: c.name,
  });
  const { data: follows } = await admin
    .from('company_follows')
    .select('company_id')
    .limit(5000);
  const followed = [...new Set((follows ?? []).map((f) => f.company_id))];
  const out: CompanyTarget[] = [];
  if (followed.length) {
    const { data } = await admin
      .from('companies')
      .select(cols)
      .in('id', followed)
      .order('last_polled_at', { ascending: true, nullsFirst: true })
      .limit(budget);
    out.push(...(data ?? []).map(toTarget));
  }
  if (!followedOnly && out.length < budget) {
    let q = admin
      .from('companies')
      .select(cols)
      .order('last_polled_at', { ascending: true, nullsFirst: true })
      .limit(budget - out.length);
    if (followed.length) q = q.not('id', 'in', `(${followed.join(',')})`);
    const { data } = await q;
    out.push(...(data ?? []).map(toTarget));
  }
  return out;
}
