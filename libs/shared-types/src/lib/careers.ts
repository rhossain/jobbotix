import type { AtsKind } from './database.types';

/**
 * Reads a company's careers system and board slug from a careers or job
 * link, for the four systems Jobbotix can follow. Mirrors detectAts in
 * supabase/functions/_shared/sources/normalise.ts (which knows more
 * systems, for discovery only).
 */
const PATTERNS: [AtsKind, RegExp][] = [
  [
    'greenhouse',
    /^https?:\/\/(?:job-)?boards(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_app\?for=)?([a-z0-9_-]+)/i,
  ],
  ['lever', /^https?:\/\/jobs(?:\.eu)?\.lever\.co\/([a-z0-9_.-]+)/i],
  ['ashby', /^https?:\/\/jobs\.ashbyhq\.com\/([a-z0-9_.%-]+)/i],
  ['workable', /^https?:\/\/apply\.workable\.com\/([a-z0-9_-]+)/i],
];

export const ATS_LABEL: Record<AtsKind, string> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  workable: 'Workable',
};

export function careersSystem(
  url: string,
): { kind: AtsKind; slug: string } | null {
  const u = url.trim();
  for (const [kind, re] of PATTERNS) {
    const m = u.match(re);
    if (m?.[1]) {
      const slug = decodeURIComponent(m[1]).toLowerCase();
      if (['embed', 'jobs', 'www', 'api'].includes(slug)) continue;
      return { kind, slug };
    }
  }
  return null;
}
