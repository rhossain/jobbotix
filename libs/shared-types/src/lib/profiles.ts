// Several search profiles per account (migration 0047): which is the main
// one, the order they are shown and searched in, and which of them a plan's
// limit leaves out.
//
// Kept in two copies, one for the Edge runtime and one for the app:
// supabase/functions/_shared/profiles.ts and
// libs/shared-types/src/lib/profiles.ts. Keep the two in step.

/** What these helpers need of a search_profiles row. */
export interface ProfileOrder {
  id: string;
  /** True on the account's main profile. */
  active: boolean;
  created_at: string;
}

/** The main profile first, then the others oldest first. */
export function orderProfiles<T extends ProfileOrder>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      a.created_at.localeCompare(b.created_at) ||
      a.id.localeCompare(b.id),
  );
}

/**
 * The profiles that are searched: all of them when nothing limits the
 * account (`limit` null), else the first `limit` in order, and always at
 * least the main one. The rest stay stored and are not searched, which is
 * what happens to further profiles when a plan ends.
 */
export function searchedProfiles<T extends ProfileOrder>(
  rows: T[],
  limit: number | null,
): T[] {
  const ordered = orderProfiles(rows);
  return limit === null ? ordered : ordered.slice(0, Math.max(1, limit));
}

/** A name for a new profile that none of the others has: "Search 2". */
export function nextProfileName(names: string[]): string {
  const taken = new Set(names.map((n) => n.trim().toLowerCase()));
  for (let n = names.length + 1; ; n++)
    if (!taken.has(`search ${n}`)) return `Search ${n}`;
}
