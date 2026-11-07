// The instant alert: one short email the moment a match run files roles that
// score at or above the user's alert threshold (search_profiles.alert_min_score).

export interface AlertRole {
  id: string;
  company: string;
  title: string;
  score: number;
  source: string;
  location: string;
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ] as string,
  );

/** Roles at or above the threshold, best first; none when alerts are off. */
export function alertWorthy<T extends { score: number }>(
  roles: T[],
  threshold: number | null,
): T[] {
  if (threshold === null || threshold === undefined) return [];
  return roles
    .filter((r) => r.score >= threshold)
    .sort((a, b) => b.score - a.score);
}

export function buildAlert(input: {
  name: string;
  appUrl: string;
  roles: AlertRole[];
}): { subject: string; text: string; html: string } {
  const [top] = input.roles;
  const more = input.roles.length - 1;
  const subject =
    more > 0
      ? `${top.score}: ${top.title} at ${top.company}, and ${more} more`
      : `${top.score}: ${top.title} at ${top.company}`;
  const first = input.name.split(' ')[0] || 'there';
  const link = (r: AlertRole) => `${input.appUrl}/roles/${r.id}`;
  const text = [
    `Hi ${first},`,
    '',
    input.roles.length === 1
      ? 'A new role just cleared your alert score:'
      : `${input.roles.length} new roles just cleared your alert score:`,
    '',
    ...input.roles.map(
      (r) =>
        `${r.score}  ${r.title} at ${r.company} (${r.location || 'location not given'}; via ${r.source})\n    ${link(r)}`,
    ),
    '',
    'Change or turn off these alerts on Search profile.',
  ].join('\n');
  const rows = input.roles
    .map(
      (r) =>
        `<tr><td style="padding:6px 12px 6px 0;font-weight:600;vertical-align:top">${r.score}</td><td style="padding:6px 0"><a href="${esc(link(r))}">${esc(r.title)}</a> at ${esc(r.company)}<br><span style="color:#666">${esc(r.location || 'Location not given')} · via ${esc(r.source)}</span></td></tr>`,
    )
    .join('');
  const html = `<p>Hi ${esc(first)},</p><p>${
    input.roles.length === 1
      ? 'A new role just cleared your alert score:'
      : `${input.roles.length} new roles just cleared your alert score:`
  }</p><table>${rows}</table><p style="color:#666">Change or turn off these alerts on Search profile.</p>`;
  return { subject, text, html };
}
