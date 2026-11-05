/**
 * The printed-resume palette. A resume is a paper document, so it never
 * follows the app's dark theme: the preview and the jsPDF export both read
 * these values, which match the light-theme ink, muted, line and brand tokens.
 */
export const RESUME_PALETTE = {
  paper: '#ffffff',
  ink: '#0f1e1b',
  muted: '#56655f',
  rule: '#e1e8e5',
  accent: '#0b5f5a',
} as const;

export type ResumeColour = keyof typeof RESUME_PALETTE;

/** jsPDF wants colours as 0–255 RGB triples. */
export function resumeRgb(name: ResumeColour): [number, number, number] {
  const hex = RESUME_PALETTE[name].slice(1);
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/** CSS custom properties for the preview's host element. */
export const resumeCssVars: Record<string, string> = {
  '--paper': RESUME_PALETTE.paper,
  '--ink': RESUME_PALETTE.ink,
  '--muted': RESUME_PALETTE.muted,
  '--rule': RESUME_PALETTE.rule,
  '--accent': RESUME_PALETTE.accent,
};
