/**
 * Pure computations behind the Insights page: applications per week, the
 * response rate, time spent in each status, and the score distribution.
 * Takes roles and status_change events; no dates are read from the clock
 * except through the `now` argument, so the numbers are testable.
 */
import type { RoleEventRow, RoleRow, RoleStatus } from './database.types';

export interface WeekCount {
  /** Monday of the ISO week, as YYYY-MM-DD. */
  weekStart: string;
  applied: number;
  found: number;
}

export interface StatusDwell {
  status: RoleStatus;
  /** Mean days roles spent in this status before moving on. */
  meanDays: number;
  samples: number;
}

export interface ScoreBand {
  label: string;
  min: number;
  max: number;
  count: number;
}

export interface Insights {
  weeks: WeekCount[];
  funnel: { status: RoleStatus; count: number }[];
  applied: number;
  responded: number;
  interviews: number;
  offers: number;
  /** responded / applied, 0-1, or null with nothing applied. */
  responseRate: number | null;
  dwell: StatusDwell[];
  scores: ScoreBand[];
  medianDaysToResponse: number | null;
}

export const FUNNEL_ORDER: RoleStatus[] = [
  'new',
  'shortlist',
  'applied',
  'interview',
  'offer',
  'rejected',
  'skipped',
];

const RESPONSE_STATUSES = new Set<RoleStatus>([
  'interview',
  'offer',
  'rejected',
]);

function mondayOf(d: Date): Date {
  const x = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const day = (x.getUTCDay() + 6) % 7; // Monday = 0
  x.setUTCDate(x.getUTCDate() - day);
  return x;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function payload(e: RoleEventRow): { from?: string; to?: string } {
  return (e.payload ?? {}) as { from?: string; to?: string };
}

export function computeInsights(
  roles: RoleRow[],
  events: RoleEventRow[],
  opts: { now?: Date; weeks?: number } = {},
): Insights {
  const now = opts.now ?? new Date();
  const weekCount = opts.weeks ?? 8;
  const changes = events
    .filter((e) => e.kind === 'status_change' && e.role_id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  // Weeks: applied from events (fallback: roles whose status is past
  // "applied" but have no event, dated by status_changed_at); found from found_at.
  const weeks: WeekCount[] = [];
  const start = mondayOf(now);
  start.setUTCDate(start.getUTCDate() - 7 * (weekCount - 1));
  const index = new Map<string, WeekCount>();
  for (let i = 0; i < weekCount; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + 7 * i);
    const w = { weekStart: isoDate(d), applied: 0, found: 0 };
    weeks.push(w);
    index.set(w.weekStart, w);
  }
  const bump = (iso: string, key: 'applied' | 'found') => {
    const w = index.get(isoDate(mondayOf(new Date(iso))));
    if (w) w[key]++;
  };
  const appliedAt = new Map<string, string>();
  for (const e of changes) {
    if (payload(e).to === 'applied' && e.role_id && !appliedAt.has(e.role_id))
      appliedAt.set(e.role_id, e.created_at);
  }
  for (const r of roles) {
    if (
      !appliedAt.has(r.id) &&
      (r.status === 'applied' || RESPONSE_STATUSES.has(r.status))
    )
      appliedAt.set(r.id, r.status_changed_at);
    bump(r.found_at, 'found');
  }
  for (const iso of appliedAt.values()) bump(iso, 'applied');

  // Funnel and responses.
  const funnel = FUNNEL_ORDER.map((status) => ({
    status,
    count: roles.filter((r) => r.status === status).length,
  }));
  const roleById = new Map(roles.map((r) => [r.id, r]));
  let responded = 0;
  const responseDays: number[] = [];
  for (const [id, at] of appliedAt) {
    const r = roleById.get(id);
    if (!r) continue;
    const response = changes.find(
      (e) =>
        e.role_id === id &&
        e.created_at > at &&
        RESPONSE_STATUSES.has(payload(e).to as RoleStatus),
    );
    if (response || RESPONSE_STATUSES.has(r.status)) {
      responded++;
      const when = response?.created_at ?? r.status_changed_at;
      responseDays.push(
        (new Date(when).getTime() - new Date(at).getTime()) / 86_400_000,
      );
    }
  }
  const applied = appliedAt.size;

  // Dwell: for each status_change, the time since the previous change of the same role.
  const lastChange = new Map<string, string>();
  const dwellSamples = new Map<RoleStatus, number[]>();
  for (const e of changes) {
    const id = e.role_id as string;
    const { from } = payload(e);
    const prev = lastChange.get(id) ?? roleById.get(id)?.found_at;
    if (from && prev) {
      const days =
        (new Date(e.created_at).getTime() - new Date(prev).getTime()) /
        86_400_000;
      const arr = dwellSamples.get(from as RoleStatus) ?? [];
      arr.push(Math.max(0, days));
      dwellSamples.set(from as RoleStatus, arr);
    }
    lastChange.set(id, e.created_at);
  }
  const dwell: StatusDwell[] = FUNNEL_ORDER.filter((s) =>
    dwellSamples.has(s),
  ).map((status) => {
    const arr = dwellSamples.get(status) ?? [];
    return {
      status,
      meanDays: round1(arr.reduce((a, b) => a + b, 0) / arr.length),
      samples: arr.length,
    };
  });

  const scores: ScoreBand[] = [
    { label: 'Under 50', min: 0, max: 49, count: 0 },
    { label: '50–69', min: 50, max: 69, count: 0 },
    { label: '70–84', min: 70, max: 84, count: 0 },
    { label: '85+', min: 85, max: 100, count: 0 },
  ];
  for (const r of roles) {
    const band = scores.find((b) => r.score >= b.min && r.score <= b.max);
    if (band) band.count++;
  }

  return {
    weeks,
    funnel,
    applied,
    responded,
    interviews: roles.filter(
      (r) => r.status === 'interview' || r.status === 'offer',
    ).length,
    offers: roles.filter((r) => r.status === 'offer').length,
    responseRate: applied ? responded / applied : null,
    dwell,
    scores,
    medianDaysToResponse: responseDays.length
      ? round1(median(responseDays))
      : null,
  };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
