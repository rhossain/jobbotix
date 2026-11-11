import type { ResumeSections, VariantChange } from '@jobbotix/shared-types';

type Sample = Omit<VariantChange, 'id' | 'decision'>;

/** Openers that state a duty, and the action verb to start with instead. */
const WEAK_OPENERS: [RegExp, string][] = [
  [/^responsible for\s+/i, 'Owned '],
  [/^worked on\s+/i, 'Built '],
  [/^helped (to\s+)?/i, 'Supported '],
  [/^involved in\s+/i, 'Contributed to '],
];

/**
 * A stand-in for the AI review in demo mode, where there is no model: a few
 * rule-based suggestions in the format the real review answers with, so the
 * accept-or-reject flow can be tried. Like the real one it only rewrites
 * what is there.
 */
export function sampleReview(s: ResumeSections): Sample[] {
  const out: Sample[] = [];
  const sentences = s.summary.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [];
  if (sentences.length > 2 && s.summary.length > 220)
    out.push({
      path: 'summary',
      kind: 'replace',
      before: s.summary,
      after: sentences.slice(0, 2).join('').trim(),
      reason:
        'A summary is skimmed in seconds; the first two sentences already say what you do.',
    });
  s.experience.forEach((e, i) =>
    e.bullets.forEach((b, j) => {
      for (const [weak, verb] of WEAK_OPENERS) {
        if (!weak.test(b)) continue;
        out.push({
          path: `experience.${i}.bullets.${j}`,
          kind: 'replace',
          before: b,
          after: verb + b.replace(weak, ''),
          reason: 'Opens with a duty; an action verb reads stronger.',
        });
        break;
      }
    }),
  );
  return out.slice(0, 12);
}
