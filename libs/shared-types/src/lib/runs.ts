import type { Json } from './database.types';
import type { RunSummary } from './shared-types';

/** The fields of a role_events row this reads. */
export interface RunEventLike {
  payload: Json;
  created_at: string;
}

const WINDOW_MS = 24 * 3_600_000;

/**
 * Sums the search runs of the last 24 hours. Jobbotix's own matcher reports
 * a run every hour that new postings arrive, so the latest single run would
 * undersell the day; a user's scheduled task reports once a day, and with no
 * run in the window the latest run on record is returned on its own. Digest
 * markers (payload.digest) are not runs and are ignored. Supabase's digest
 * keeps a copy of this in supabase/functions/_shared/digest.ts.
 */
export function summariseRuns(
  events: RunEventLike[],
  now = new Date(),
): RunSummary | null {
  const runs = events
    .map((e) => ({
      p: (e.payload ?? {}) as Record<string, unknown>,
      created: e.created_at,
    }))
    .filter((r) => r.p['digest'] !== true)
    .map((r) => ({
      at: String(r.p['at'] ?? r.created),
      searched: Number(r.p['searched'] ?? 0) || 0,
      added: Number(r.p['added'] ?? 0) || 0,
      excluded: Number(r.p['excluded'] ?? 0) || 0,
      // reported by Jobbotix's own matcher since the designation rework
      notRelevant:
        typeof r.p['notRelevant'] === 'number' ? r.p['notRelevant'] : null,
      lowMatch: typeof r.p['lowMatch'] === 'number' ? r.p['lowMatch'] : null,
      aiJudged: Number(r.p['aiJudged'] ?? 0) || 0,
      aiRejected: Number(r.p['aiRejected'] ?? 0) || 0,
      aiRescued: Number(r.p['aiRescued'] ?? 0) || 0,
      aiFailed: Number(r.p['aiFailed'] ?? 0) || 0,
      aiError: typeof r.p['aiError'] === 'string' ? r.p['aiError'] : '',
    }))
    .sort((a, b) => b.at.localeCompare(a.at));
  if (!runs.length) return null;

  const recent = runs.filter(
    (r) => now.getTime() - Date.parse(r.at) <= WINDOW_MS,
  );
  const use = recent.length ? recent : [runs[0]];
  return {
    at: use[0].at,
    searched: use.reduce((n, r) => n + r.searched, 0),
    added: use.reduce((n, r) => n + r.added, 0),
    excluded: use.reduce((n, r) => n + r.excluded, 0),
    runs: use.length,
    ...(use.some((r) => r.notRelevant !== null)
      ? { notRelevant: use.reduce((n, r) => n + (r.notRelevant ?? 0), 0) }
      : {}),
    ...(use.some((r) => r.lowMatch !== null)
      ? { lowMatch: use.reduce((n, r) => n + (r.lowMatch ?? 0), 0) }
      : {}),
    ...(use.some((r) => r.aiJudged > 0)
      ? {
          aiCheck: {
            looked: use.reduce((n, r) => n + r.aiJudged, 0),
            turnedDown: use.reduce((n, r) => n + r.aiRejected, 0),
            broughtIn: use.reduce((n, r) => n + r.aiRescued, 0),
          },
        }
      : {}),
    ...(use.some((r) => r.aiFailed > 0)
      ? {
          aiTrouble: {
            runs: use.filter((r) => r.aiFailed > 0).length,
            reason: use.find((r) => r.aiFailed > 0 && r.aiError)?.aiError ?? '',
          },
        }
      : {}),
  };
}
