/**
 * Outcome insights (Pro): what is getting replies. Takes the applications in
 * the tracker and splits them by things the user can act on (where the role
 * came from, how well it scored, how soon they applied, whether a cover
 * letter went with it), counting for each how many were answered and how
 * many led to an interview. Pure: the page passes roles and status events.
 */
import type { RoleEventRow, RoleRow, RoleStatus } from './database.types';

/** One application: a role that reached "applied", and what came of it. */
export interface Application {
  role: RoleRow;
  appliedAt: string;
  /** When the employer's answer was recorded; null while there is none. */
  respondedAt: string | null;
  /** It reached an interview or an offer. */
  interview: boolean;
}

const ANSWERS = new Set<RoleStatus>(['interview', 'offer', 'rejected']);
const INTERVIEWS = new Set<RoleStatus>(['interview', 'offer']);

/**
 * Every application, read the way the Insights page reads them: the first
 * move to "applied" dates it (or the role's last status change, for a role
 * past "applied" with no recorded move), and the first move after that to
 * interview, offer or rejected is the answer.
 */
export function applications(
  roles: RoleRow[],
  events: RoleEventRow[],
): Application[] {
  const to = (e: RoleEventRow) =>
    ((e.payload ?? {}) as { to?: string }).to as RoleStatus | undefined;
  const changes = events
    .filter((e) => e.kind === 'status_change' && e.role_id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const byRole = new Map<string, RoleEventRow[]>();
  for (const e of changes) {
    const id = e.role_id as string;
    byRole.set(id, [...(byRole.get(id) ?? []), e]);
  }
  const out: Application[] = [];
  for (const role of roles) {
    const mine = byRole.get(role.id) ?? [];
    const appliedAt =
      mine.find((e) => to(e) === 'applied')?.created_at ??
      (role.status === 'applied' || ANSWERS.has(role.status)
        ? role.status_changed_at
        : null);
    if (!appliedAt) continue;
    const after = mine.filter((e) => e.created_at > appliedAt);
    const answer = after.find((e) => ANSWERS.has(to(e) as RoleStatus));
    const answered = !!answer || ANSWERS.has(role.status);
    out.push({
      role,
      appliedAt,
      respondedAt: answered
        ? (answer?.created_at ?? role.status_changed_at)
        : null,
      interview:
        INTERVIEWS.has(role.status) ||
        after.some((e) => INTERVIEWS.has(to(e) as RoleStatus)),
    });
  }
  return out;
}

export interface OutcomeRow {
  label: string;
  applied: number;
  /** Answered at all: interview, offer or rejection. */
  responded: number;
  /** Reached an interview or an offer. */
  interviews: number;
}

export interface OutcomeGroup {
  key: 'source' | 'score' | 'speed' | 'letter';
  title: string;
  /** What the split shows, in one line. */
  lead: string;
  rows: OutcomeRow[];
}

export interface Outcomes {
  applied: number;
  interviews: number;
  groups: OutcomeGroup[];
  /** Plain sentences on what stands out; empty until there is enough to say. */
  findings: string[];
}

/** Applications a row needs before a finding is drawn from it. */
export const OUTCOME_MIN_SAMPLE = 4;

const SPEED: { label: string; maxDays: number }[] = [
  { label: 'Same or next day', maxDays: 1 },
  { label: 'Within 3 days', maxDays: 3 },
  { label: 'Within a week', maxDays: 7 },
  { label: 'Later than a week', maxDays: Infinity },
];
const SCORES: { label: string; min: number }[] = [
  { label: '85+', min: 85 },
  { label: '70–84', min: 70 },
  { label: '50–69', min: 50 },
  { label: 'Under 50', min: -Infinity },
];

/** interviews / applied as a whole percentage; 0 with nothing applied. */
export function interviewRate(row: OutcomeRow): number {
  return row.applied ? Math.round((100 * row.interviews) / row.applied) : 0;
}

export function computeOutcomes(
  roles: RoleRow[],
  events: RoleEventRow[],
): Outcomes {
  const apps = applications(roles, events);
  const split = (
    labels: string[],
    of: (a: Application) => string,
    keepEmpty: boolean,
  ): OutcomeRow[] => {
    const rows = new Map<string, OutcomeRow>(
      labels.map((label) => [
        label,
        { label, applied: 0, responded: 0, interviews: 0 },
      ]),
    );
    for (const a of apps) {
      const label = of(a);
      const row = rows.get(label) ?? {
        label,
        applied: 0,
        responded: 0,
        interviews: 0,
      };
      row.applied++;
      if (a.respondedAt) row.responded++;
      if (a.interview) row.interviews++;
      rows.set(label, row);
    }
    return [...rows.values()].filter((r) => keepEmpty || r.applied > 0);
  };

  const daysToApply = (a: Application) =>
    (new Date(a.appliedAt).getTime() - new Date(a.role.found_at).getTime()) /
    86_400_000;
  const source = split([], (a) => a.role.source || 'Added by hand', false)
    .sort((a, b) => b.applied - a.applied || a.label.localeCompare(b.label))
    .slice(0, 8);
  const score = split(
    SCORES.map((s) => s.label),
    (a) => (SCORES.find((s) => a.role.score >= s.min) ?? SCORES[3]).label,
    false,
  );
  const speed = split(
    SPEED.map((s) => s.label),
    (a) => (SPEED.find((s) => daysToApply(a) <= s.maxDays) ?? SPEED[3]).label,
    false,
  );
  const letter = split(
    ['With a cover letter', 'Without one'],
    (a) =>
      (a.role.cover_letter ?? '').trim()
        ? 'With a cover letter'
        : 'Without one',
    false,
  );

  const groups: OutcomeGroup[] = [
    {
      key: 'source',
      title: 'By where the role came from',
      lead: 'Which sources lead to interviews, not only to listings.',
      rows: source,
    },
    {
      key: 'score',
      title: 'By match score',
      lead: 'Whether the roles Jobbotix scores highest answer more often.',
      rows: score,
    },
    {
      key: 'speed',
      title: 'By how soon you applied',
      lead: 'Counted from the day the role was found.',
      rows: speed,
    },
    {
      key: 'letter',
      title: 'With and without a cover letter',
      lead: 'A letter saved on the role counts as sent with it.',
      rows: letter,
    },
  ];

  return {
    applied: apps.length,
    interviews: apps.filter((a) => a.interview).length,
    groups,
    findings: findings(groups),
  };
}

/**
 * What stands out, said only where the numbers can carry it: both rows
 * compared hold at least OUTCOME_MIN_SAMPLE applications and their interview
 * rates differ by 10 points or more.
 */
function findings(groups: OutcomeGroup[]): string[] {
  const out: string[] = [];
  const solid = (rows: OutcomeRow[]) =>
    rows.filter((r) => r.applied >= OUTCOME_MIN_SAMPLE);
  const says = (r: OutcomeRow) =>
    `${r.interviews} of ${r.applied} (${interviewRate(r)}%)`;
  const by = (key: OutcomeGroup['key']) =>
    solid(groups.find((g) => g.key === key)?.rows ?? []);
  const apart = (a: OutcomeRow, b: OutcomeRow) =>
    interviewRate(a) - interviewRate(b) >= 10;

  const sources = [...by('source')].sort(
    (a, b) => interviewRate(b) - interviewRate(a),
  );
  if (sources.length >= 2 && apart(sources[0], sources[sources.length - 1]))
    out.push(
      `${sources[0].label} leads to interviews most often: ${says(sources[0])}, against ${says(sources[sources.length - 1])} from ${sources[sources.length - 1].label}.`,
    );

  const scores = by('score');
  if (scores.length >= 2) {
    const [top, low] = [scores[0], scores[scores.length - 1]];
    if (apart(top, low))
      out.push(
        `Roles scoring ${top.label} reach an interview more often than roles scoring ${low.label.toLowerCase()}: ${says(top)} against ${says(low)}.`,
      );
    else if (apart(low, top))
      out.push(
        `Higher scores are not answering more often for you: ${says(top)} at ${top.label}, ${says(low)} at ${low.label.toLowerCase()}. The scoring weights on Search profile may need another look.`,
      );
  }

  const speeds = by('speed');
  if (speeds.length >= 2) {
    const [fast, slow] = [speeds[0], speeds[speeds.length - 1]];
    if (apart(fast, slow))
      out.push(
        `Applying early pays: ${says(fast)} when you applied ${fast.label.toLowerCase()}, ${says(slow)} ${slow.label.toLowerCase()}.`,
      );
  }

  const letters = by('letter');
  if (letters.length === 2) {
    const [withLetter, without] = letters;
    if (apart(withLetter, without))
      out.push(
        `Applications with a cover letter do better: ${says(withLetter)} against ${says(without)} without one.`,
      );
    else if (apart(without, withLetter))
      out.push(
        `A cover letter has not helped so far: ${says(withLetter)} with one, ${says(without)} without.`,
      );
  }
  return out;
}
