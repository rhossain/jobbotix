// Which Claude models Jobbotix offers, and the defaults.
//
// The list in the app comes from Anthropic's Models API on the user's key
// (the list-models Edge Function runs pickModelChoices on it), so a new model
// appears without a code change. FALLBACK_MODELS is shown when there is no key
// or the lookup fails, and DEFAULT_MODEL / FAST_MODEL are what the functions
// use when the user has not picked one.
//
// Copied to supabase/functions/_shared/models.ts for the Edge runtime; keep
// the two in step.

export interface ModelChoice {
  id: string;
  label: string;
}

/** Writing, research, extraction: the user's default unless they pick one. */
export const DEFAULT_MODEL = 'claude-sonnet-5-5';
/** Scoring many postings: fast and cheap. */
export const FAST_MODEL = 'claude-haiku-5-5';

/** Families in the order the picker lists them, with what each is for. */
const LINES: { line: string; hint: string }[] = [
  { line: 'haiku', hint: 'fast, cheapest' },
  { line: 'sonnet', hint: 'balanced' },
  { line: 'opus', hint: 'very strong' },
  { line: 'fable', hint: 'most capable' },
];

export const FALLBACK_MODELS: ModelChoice[] = [
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5 (fast, cheapest)' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5 (default)' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5 (very strong)' },
  { id: 'claude-fable-5-1', label: 'Fable 5.1 (most capable)' },
];

/** One entry of Anthropic's GET /v1/models reply (the fields used here). */
export interface ApiModel {
  id: string;
  display_name?: string;
  created_at?: string;
  lifecycle?: 'active' | 'deprecated' | 'retired' | string;
  line?: string | null;
}

/** The family from the API's `line`, or from the id for older replies without it. */
export function modelLine(m: ApiModel): string {
  if (m.line) return m.line;
  return (
    m.id.match(/claude-(?:\d[\d-]*-)?(haiku|sonnet|opus|fable|mythos)/)?.[1] ??
    ''
  );
}

/** "Claude Sonnet 5.5" → "Sonnet 5.5"; falls back to the id. */
function shortName(m: ApiModel): string {
  return (m.display_name || m.id).replace(/^Claude\s+/i, '').trim();
}

/**
 * The newest active model of each family, in picker order, labelled with
 * what it is for. Models the user already chose (`keep`) stay in the list
 * even when they are older, so the select can still show them.
 */
export function pickModelChoices(
  models: ApiModel[],
  keep: (string | null | undefined)[] = [],
): ModelChoice[] {
  const active = models.filter((m) => (m.lifecycle ?? 'active') === 'active');
  const time = (m: ApiModel) => Date.parse(m.created_at ?? '') || 0;
  const out: ModelChoice[] = [];
  for (const { line, hint } of LINES) {
    const newest = active
      .filter((m) => modelLine(m) === line)
      .sort((a, b) => time(b) - time(a))[0];
    if (!newest) continue;
    const isDefault = newest.id === DEFAULT_MODEL;
    out.push({
      id: newest.id,
      label: `${shortName(newest)} (${isDefault ? 'default' : hint})`,
    });
  }
  if (!out.length) return [...FALLBACK_MODELS];
  for (const id of keep) {
    if (!id || out.some((c) => c.id === id)) continue;
    const known = models.find((m) => m.id === id);
    out.push({
      id,
      label: `${known ? shortName(known) : id} (older)`,
    });
  }
  return out;
}
