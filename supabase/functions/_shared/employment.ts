// Employment types as the pool, the match step and the digest know them.
// Mirrors EmploymentType and EMPLOYMENT_TYPE_LABELS in libs/shared-types.

export type EmploymentType =
  'full_time' | 'contract' | 'freelance' | 'part_time';

export const EMPLOYMENT_LABEL: Record<EmploymentType, string> = {
  full_time: 'Full-time',
  contract: 'Contract',
  freelance: 'Freelance',
  part_time: 'Part-time',
};

/**
 * Reads a board's job-type field ("Contractor", "Freelance", "Part-time",
 * "Full-time, Part-time"...). Freelance wins over contract; part-time counts
 * only when full-time is not also offered.
 */
export function employmentType(v: unknown): EmploymentType {
  const s = String(v ?? '').toLowerCase();
  if (/freelanc|independent contractor/.test(s)) return 'freelance';
  if (/contract|temporar|fixed[- ]term|consult/.test(s)) return 'contract';
  if (/part[- ]?time/.test(s) && !/full[- ]?time/.test(s)) return 'part_time';
  return 'full_time';
}

/** "Full-time, contract or freelance" for a profile's list. */
export function typeList(types: EmploymentType[]): string {
  const words = types.map((t, i) =>
    i === 0 ? EMPLOYMENT_LABEL[t] : EMPLOYMENT_LABEL[t].toLowerCase(),
  );
  return words.length > 1
    ? `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`
    : (words[0] ?? '');
}
