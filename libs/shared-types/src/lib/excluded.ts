/**
 * Postings a search run looked at and did not add, in the words the user
 * reads. The matcher stores one reason per posting; these put the reasons in
 * a handful of groups so "why not" is one glance, not sixty lines.
 */

export type ExcludedGroupId =
  | 'low'
  | 'ai'
  | 'place'
  | 'onsite'
  | 'level'
  | 'pay'
  | 'contract'
  | 'language'
  | 'permit'
  | 'other';

export interface ExcludedGroupInfo {
  id: ExcludedGroupId;
  label: string;
  /** One sentence on what the group means and what would change it. */
  help: string;
}

/** In the order the page lists them: the closest calls first. */
export const EXCLUDED_GROUPS: ExcludedGroupInfo[] = [
  {
    id: 'low',
    label: 'Right job, low score',
    help: 'Your kind of job, but little else in the posting matched your profile.',
  },
  {
    id: 'ai',
    label: 'Checked by AI: a different job',
    help: 'The title was close to one of your target roles; the AI check read it as another job.',
  },
  {
    id: 'place',
    label: 'Open to other countries only',
    help: 'Remote, but the employer hires only in the places named.',
  },
  {
    id: 'onsite',
    label: 'On-site or hybrid',
    help: 'Needs you in an office your profile does not cover.',
  },
  {
    id: 'level',
    label: 'Below your level',
    help: 'More junior than the lowest level in your search profile.',
  },
  {
    id: 'pay',
    label: 'Pay below your minimum',
    help: 'The posted pay tops out under the minimum in your search profile.',
  },
  {
    id: 'contract',
    label: 'Contract type not wanted',
    help: 'A kind of contract your search profile leaves out.',
  },
  {
    id: 'language',
    label: 'Requires another language',
    help: 'Asks for a language that is not in your search profile.',
  },
  {
    id: 'permit',
    label: 'Requires local work authorisation',
    help: 'Asks for the right to work in a country, with no sponsorship.',
  },
  {
    id: 'other',
    label: 'Other reasons',
    help: 'Ruled out for the reason shown on each posting.',
  },
];

export function excludedGroupId(reason: string): ExcludedGroupId {
  const r = reason.trim();
  if (/^low match\b/i.test(r)) return 'low';
  if (/\(checked by AI\)$/i.test(r)) return 'ai';
  if (/^limited to\b/i.test(r)) return 'place';
  if (/^(hybrid|on-site) role$/i.test(r)) return 'onsite';
  if (/^junior\b/i.test(r)) return 'level';
  if (/^pay below\b/i.test(r)) return 'pay';
  if (/profile wants/i.test(r)) return 'contract';
  if (/^requires local work authori[sz]ation$/i.test(r)) return 'permit';
  if (/^requires\b/i.test(r)) return 'language';
  return 'other';
}

/** "Low match (score 24): no React" as { score: 24, detail: 'no React' }. */
export function lowMatchParts(
  reason: string,
): { score: number; detail: string } | null {
  const m = /^low match \(score (\d+)\):?\s*(.*)$/i.exec(reason.trim());
  return m ? { score: Number(m[1]), detail: m[2].trim() } : null;
}

/** The line under a posting: the stored reason, without the bookkeeping. */
export function excludedReasonLine(reason: string): string {
  const low = lowMatchParts(reason);
  if (low)
    return low.detail
      ? `Scored ${low.score} of 100. ${capitalise(low.detail)}`
      : `Scored ${low.score} of 100`;
  if (excludedGroupId(reason) === 'place')
    return reason.trim().replace(/^limited to/i, 'Hires only in');
  return reason.trim().replace(/\s*\(checked by AI\)$/i, '');
}

function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export interface ExcludedCount extends ExcludedGroupInfo {
  count: number;
}

/** Groups that have at least one posting, in page order, with their counts. */
export function excludedCounts(rows: { reason: string }[]): ExcludedCount[] {
  const n = new Map<ExcludedGroupId, number>();
  for (const r of rows) {
    const id = excludedGroupId(r.reason);
    n.set(id, (n.get(id) ?? 0) + 1);
  }
  return EXCLUDED_GROUPS.filter((g) => n.has(g.id)).map((g) => ({
    ...g,
    count: n.get(g.id) ?? 0,
  }));
}
