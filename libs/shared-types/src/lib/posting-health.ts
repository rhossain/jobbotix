/**
 * Posting health: warning badges for postings that have been up a long time,
 * were relisted under a new id, have passed their closing date, or have
 * disappeared from the company's own careers page. Listings three months old
 * and roles reposted as new are the signs job seekers cite most for "ghost"
 * jobs, so these show on the card before anyone spends time applying.
 *
 * Pure: takes the role, what the pool knows (posting_health() in the
 * database) and `now`, so the rules are unit-tested without a clock.
 */

/** One row of the posting_health() RPC. */
export interface PoolPostingFacts {
  role_id: string;
  first_seen_at: string | null;
  posted_at: string | null;
  expires_at: string | null;
  /** Listings of this posting across every board, relistings included. */
  listings: number;
  /** Distinct boards that listed it. */
  boards: number;
  /** Set when the company's careers page stopped listing it. */
  gone_since: string | null;
}

export type HealthTone = 'warn' | 'bad';

export interface HealthBadge {
  kind: 'age' | 'repost' | 'expired' | 'gone';
  tone: HealthTone;
  /** A few words for the card. */
  label: string;
  /** One sentence for the role page and the tooltip. */
  detail: string;
}

export interface PostingHealth {
  /** Days since the earliest date anyone saw the posting; null if unknown. */
  ageDays: number | null;
  badges: HealthBadge[];
}

/** A posting this old earns the "open N days" badge. */
export const AGE_WARN_DAYS = 30;
/** From here the age badge turns red. */
export const AGE_BAD_DAYS = 60;

const DAY = 86_400_000;

function time(v: string | null | undefined): number | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

function shortDate(t: number): string {
  return new Date(t).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

export function postingHealth(
  role: { posted_at: string | null },
  pool: PoolPostingFacts | null | undefined,
  now: Date,
): PostingHealth {
  const nowT = now.getTime();
  const starts = [
    time(role.posted_at),
    time(pool?.posted_at),
    time(pool?.first_seen_at),
  ].filter((t): t is number => t !== null && t <= nowT);
  const since = starts.length ? Math.min(...starts) : null;
  const ageDays = since === null ? null : Math.floor((nowT - since) / DAY);

  const badges: HealthBadge[] = [];

  const gone = time(pool?.gone_since);
  if (gone !== null) {
    badges.push({
      kind: 'gone',
      tone: 'bad',
      label: 'Closed on careers page',
      detail: `The company's careers page has not listed it since ${shortDate(gone)}; it has probably closed.`,
    });
  }

  const expires = time(pool?.expires_at);
  if (gone === null && expires !== null && expires < nowT) {
    badges.push({
      kind: 'expired',
      tone: 'bad',
      label: 'Closing date passed',
      detail: `Applications closed on ${shortDate(expires)}.`,
    });
  }

  if (pool && pool.listings > pool.boards && pool.boards > 0) {
    const extra = pool.listings - pool.boards;
    badges.push({
      kind: 'repost',
      tone: 'warn',
      label: extra === 1 ? 'Reposted' : `Reposted ${extra}×`,
      detail: `Relisted as new ${extra === 1 ? 'once' : `${extra} times`}; roles reposted without hiring are a common sign of a ghost job.`,
    });
  }

  if (ageDays !== null && ageDays >= AGE_WARN_DAYS) {
    badges.push({
      kind: 'age',
      tone: ageDays >= AGE_BAD_DAYS ? 'bad' : 'warn',
      label: `Open ${ageDays} days`,
      detail: `First posted ${ageDays} days ago (${shortDate(since as number)}). Long-open postings are often filled, paused or never real.`,
    });
  }

  return { ageDays, badges };
}
