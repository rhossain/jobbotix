// Builds the morning digest for one user. Pure: takes rows, returns subject,
// text and HTML, so it is unit-tested without a database or Resend.

import { EMPLOYMENT_LABEL, type EmploymentType } from './employment.ts';

export interface DigestRole {
  id: string;
  company: string;
  title: string;
  url: string;
  location: string;
  type: EmploymentType;
  salary: string;
  score: number;
  ai_match: boolean;
  status: string;
  status_changed_at: string;
  cover_letter: string;
  reasons: string[];
}

export interface DigestRun {
  at: string;
  searched: number;
  added: number;
  excluded: number;
  /** Runs summed; 1 when only one run counted. */
  runs?: number;
}

/**
 * Sums the runs of the last 24 hours (Jobbotix matches hourly), falling back
 * to the latest run on record; digest markers are not runs. Mirrors
 * summariseRuns in libs/shared-types/src/lib/runs.ts.
 */
export function summariseRuns(
  events: { payload: unknown; created_at: string }[],
  now = new Date(),
): DigestRun | null {
  const runs = events
    .map((e) => ({
      p: (e.payload ?? {}) as Record<string, unknown>,
      created: e.created_at,
    }))
    .filter((r) => r.p['digest'] !== true)
    .map((r) => ({
      at: String(r.p['at'] ?? r.created),
      searched: Number(r.p['searched'] ?? 0) || 0,
      added: Number(r.p['added'] ?? 0) || 0,
      excluded: Number(r.p['excluded'] ?? 0) || 0,
    }))
    .sort((a, b) => b.at.localeCompare(a.at));
  if (!runs.length) return null;
  const recent = runs.filter(
    (r) => now.getTime() - Date.parse(r.at) <= 24 * 3_600_000,
  );
  const use = recent.length ? recent : [runs[0]];
  return {
    at: use[0].at,
    searched: use.reduce((n, r) => n + r.searched, 0),
    added: use.reduce((n, r) => n + r.added, 0),
    excluded: use.reduce((n, r) => n + r.excluded, 0),
    runs: use.length,
  };
}

const runLabel = (r: DigestRun) =>
  (r.runs ?? 1) > 1 ? `Last 24 hours (${r.runs} runs)` : 'Last run';

export interface DigestInput {
  name: string;
  appUrl: string;
  now: Date;
  run: DigestRun | null;
  newRoles: DigestRole[];
  stale: DigestRole[];
}

export interface DigestEmail {
  subject: string;
  text: string;
  html: string;
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ] as string,
  );

const typeLabel = (t: DigestRole['type']) => EMPLOYMENT_LABEL[t] ?? 'Full-time';

export function daysBetween(a: string, b: Date): number {
  return Math.max(
    0,
    Math.floor((b.getTime() - new Date(a).getTime()) / 86_400_000),
  );
}

export function buildDigest(input: DigestInput): DigestEmail {
  const date = input.now.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
  const top = [...input.newRoles].sort((a, b) => b.score - a.score).slice(0, 8);
  const withLetter = top.filter((r) => r.cover_letter.trim()).length;
  const subject = top.length
    ? `Job search: ${top.length} new role${top.length === 1 ? '' : 's'} (${date})`
    : `Job search: nothing new (${date})`;

  const lines: string[] = [];
  lines.push(
    `Good morning${input.name ? `, ${input.name.split(' ')[0]}` : ''}.`,
  );
  lines.push('');
  if (top.length) {
    lines.push('New roles, best match first:');
    for (const r of top) {
      lines.push(
        `${r.score} · ${r.title} at ${r.company} · ${r.location || 'remote scope unknown'} · ${typeLabel(r.type)}${r.salary ? ` · ${r.salary}` : ''}${r.ai_match ? ' · AI-assisted dev' : ''}`,
      );
      if (r.reasons[0]) lines.push(`   ${r.reasons[0]}`);
      lines.push(`   ${r.url}`);
    }
    lines.push('');
    lines.push(
      withLetter
        ? `${withLetter} of these have a cover letter ready in the tracker.`
        : 'No cover letters were drafted for this batch.',
    );
  } else {
    lines.push('Nothing new since the last run.');
  }
  if (input.run) {
    lines.push('');
    lines.push(
      `${runLabel(input.run)}: ${input.run.searched} listings reviewed, ${input.run.added} added, ${input.run.excluded} excluded.`,
    );
  }
  if (input.stale.length) {
    lines.push('');
    lines.push('Waiting on you (in To apply for 3+ days):');
    for (const r of input.stale)
      lines.push(
        `- ${r.title} at ${r.company}: ${daysBetween(r.status_changed_at, input.now)} days`,
      );
  }
  lines.push('');
  lines.push(`Open the tracker: ${input.appUrl}/today`);
  const text = lines.join('\n');

  const roleHtml = top
    .map(
      (r) => `
      <tr>
        <td style="padding:10px 12px 10px 0;vertical-align:top;font:600 20px/1 'IBM Plex Mono',Menlo,monospace;color:${r.score >= 80 ? '#2f7d4f' : r.score >= 60 ? '#b7791f' : '#737373'}">${r.score}</td>
        <td style="padding:10px 0;vertical-align:top;font:15px/1.45 'IBM Plex Sans',Segoe UI,sans-serif;color:#1b2026">
          <a href="${esc(input.appUrl)}/roles/${esc(r.id)}" style="color:#0b5a5a;font-weight:600;text-decoration:none">${esc(r.title)}</a>
          <div style="color:#5d6771">${esc(r.company)} · ${esc(r.location || 'remote scope unknown')} · ${typeLabel(r.type)}${r.salary ? ` · ${esc(r.salary)}` : ''}${r.ai_match ? ' · <span style="color:#0f6e6e">AI-assisted dev</span>' : ''}</div>
          ${r.reasons[0] ? `<div style="margin-top:4px;font-size:14px">${esc(r.reasons[0])}</div>` : ''}
          <div style="margin-top:4px;font-size:13px"><a href="${esc(r.url)}" style="color:#5d6771">Open posting ↗</a></div>
        </td>
      </tr>`,
    )
    .join('');

  const staleHtml = input.stale.length
    ? `<h2 style="margin:24px 0 8px;font:600 12px/1 'IBM Plex Sans',Segoe UI,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#737373">Waiting on you</h2>
       <ul style="margin:0;padding-left:18px;font:14px/1.5 'IBM Plex Sans',Segoe UI,sans-serif;color:#1b2026">
       ${input.stale.map((r) => `<li><a href="${esc(input.appUrl)}/roles/${esc(r.id)}" style="color:#0b5a5a">${esc(r.title)}</a> at ${esc(r.company)}: in To apply for ${daysBetween(r.status_changed_at, input.now)} days</li>`).join('')}
       </ul>`
    : '';

  const html = `<!doctype html><html><body style="margin:0;background:#f6f7f5;padding:24px 16px">
  <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #dde2df;border-radius:8px;padding:24px">
    <div style="font:600 18px/1 'IBM Plex Sans',Segoe UI,sans-serif;color:#0b5a5a">Jobbotix</div>
    <p style="font:15px/1.45 'IBM Plex Sans',Segoe UI,sans-serif;color:#1b2026;margin:16px 0 0">${esc(lines[0])}</p>
    ${
      top.length
        ? `<h2 style="margin:20px 0 4px;font:600 12px/1 'IBM Plex Sans',Segoe UI,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#737373">New roles</h2>
           <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse">${roleHtml}</table>
           <p style="font:13px/1.45 'IBM Plex Sans',Segoe UI,sans-serif;color:#5d6771;margin:8px 0 0">${withLetter ? `${withLetter} of these have a cover letter ready in the tracker.` : 'No cover letters were drafted for this batch.'}</p>`
        : `<p style="font:15px/1.45 'IBM Plex Sans',Segoe UI,sans-serif;color:#5d6771;margin:12px 0 0">Nothing new since the last run.</p>`
    }
    ${input.run ? `<p style="font:13px/1.45 'IBM Plex Mono',Menlo,monospace;color:#5d6771;margin:16px 0 0">${runLabel(input.run)}: ${input.run.searched} listings reviewed · ${input.run.added} added · ${input.run.excluded} excluded</p>` : ''}
    ${staleHtml}
    <p style="margin:24px 0 0"><a href="${esc(input.appUrl)}/today" style="display:inline-block;background:#0b5a5a;color:#fff;font:600 14px/1 'IBM Plex Sans',Segoe UI,sans-serif;padding:10px 14px;border-radius:6px;text-decoration:none">Open the tracker</a></p>
    <p style="font:12px/1.45 'IBM Plex Sans',Segoe UI,sans-serif;color:#9aa5ad;margin:24px 0 0">You get this because a daily search runs for your Jobbotix account. Change the time or stop it under Search profile.</p>
  </div></body></html>`;

  return { subject, text, html };
}

/** True when the user's local time is now inside the hour they chose. */
export function isDigestHour(
  digestTime: string,
  timezone: string,
  now: Date,
): boolean {
  const wanted = Number(digestTime.slice(0, 2));
  let hour: number;
  try {
    hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        hour: 'numeric',
        hour12: false,
        timeZone: timezone,
      }).format(now),
    );
  } catch {
    hour = now.getUTCHours();
  }
  return hour === wanted;
}

/** ISO weekday (1 = Monday … 7 = Sunday) in the user's timezone. */
export function isoWeekday(timezone: string, now: Date): number {
  let name: string;
  try {
    name = new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      timeZone: timezone,
    }).format(now);
  } catch {
    name = new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(now);
  }
  const idx = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(
    name.slice(0, 3),
  );
  return idx < 0 ? 1 : idx + 1;
}

/** True when the digest should go out now for these settings. */
export function digestDue(
  settings: {
    digest_time: string;
    digest_days?: number[] | null;
    digest_enabled?: boolean | null;
  },
  timezone: string,
  now: Date,
): boolean {
  if (settings.digest_enabled === false) return false;
  const days = settings.digest_days?.length
    ? settings.digest_days
    : [1, 2, 3, 4, 5, 6, 7];
  if (!days.includes(isoWeekday(timezone, now))) return false;
  return isDigestHour(settings.digest_time, timezone, now);
}
