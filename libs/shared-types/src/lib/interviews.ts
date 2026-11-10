// Interview rounds: labels, what is coming up, which rounds still need a
// debrief, a calendar file and a Google Calendar link per round, and the
// thank-you note (a prompt for the user's key and a local template).
//
// No imports, so it runs unchanged in the app and in the Edge Functions
// (supabase/functions/_shared/interviews.ts is a copy; keep the two in step).

export type InterviewKind =
  | 'screen'
  | 'technical'
  | 'take_home'
  | 'system_design'
  | 'behavioural'
  | 'final'
  | 'other';
export type InterviewStatus = 'scheduled' | 'done' | 'cancelled';
export type InterviewOutcome = '' | 'waiting' | 'passed' | 'rejected';

export const INTERVIEW_KINDS: readonly InterviewKind[] = [
  'screen',
  'technical',
  'take_home',
  'system_design',
  'behavioural',
  'final',
  'other',
] as const;

export const INTERVIEW_KIND_LABELS: Record<InterviewKind, string> = {
  screen: 'Recruiter screen',
  technical: 'Technical interview',
  take_home: 'Take-home task',
  system_design: 'System design',
  behavioural: 'Behavioural',
  final: 'Final round',
  other: 'Interview',
};

export const INTERVIEW_OUTCOME_LABELS: Record<InterviewOutcome, string> = {
  '': 'No outcome yet',
  waiting: 'Waiting to hear',
  passed: 'Passed',
  rejected: 'Not moving forward',
};

/** The fields of an interview these helpers read. */
export interface InterviewLike {
  id: string;
  role_id: string;
  kind: InterviewKind;
  title: string;
  scheduled_at: string | null;
  duration_min: number;
  location: string;
  interviewers: string;
  status: InterviewStatus;
  debrief: string;
}

const MIN = 60_000;

/** "Final round" or the user's own label. */
export function interviewLabel(
  i: Pick<InterviewLike, 'kind' | 'title'>,
): string {
  return i.title.trim() || INTERVIEW_KIND_LABELS[i.kind] || 'Interview';
}

/** Scheduled rounds that start from an hour ago to `days` ahead, soonest first. */
export function upcomingInterviews<T extends InterviewLike>(
  list: T[],
  now: Date,
  days = 7,
): T[] {
  const from = now.getTime() - 60 * MIN;
  const to = now.getTime() + days * 24 * 60 * MIN;
  return list
    .filter((i) => i.status === 'scheduled' && i.scheduled_at)
    .filter((i) => {
      const t = Date.parse(i.scheduled_at as string);
      return t >= from && t <= to;
    })
    .sort((a, b) =>
      (a.scheduled_at as string).localeCompare(b.scheduled_at as string),
    );
}

/**
 * Rounds that ended in the last two weeks and have no debrief yet: the
 * moment to write down what was asked while it is fresh.
 */
export function needsDebrief<T extends InterviewLike>(
  list: T[],
  now: Date,
): T[] {
  const n = now.getTime();
  return list
    .filter(
      (i) => i.status !== 'cancelled' && i.scheduled_at && !i.debrief.trim(),
    )
    .filter((i) => {
      const end = Date.parse(i.scheduled_at as string) + i.duration_min * MIN;
      return end <= n && n - end <= 14 * 24 * 60 * MIN;
    })
    .sort((a, b) =>
      (b.scheduled_at as string).localeCompare(a.scheduled_at as string),
    );
}

/** The next scheduled round for each role, by role id. */
export function nextInterviewByRole<T extends InterviewLike>(
  list: T[],
  now: Date,
): Map<string, T> {
  const out = new Map<string, T>();
  for (const i of upcomingInterviews(list, now, 365)) {
    if (!out.has(i.role_id)) out.set(i.role_id, i);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export interface CalendarEvent {
  uid: string;
  title: string;
  start: Date;
  durationMin: number;
  location: string;
  description: string;
}

export function calendarEvent(
  i: InterviewLike,
  role: { company: string; title: string },
  appUrl = '',
): CalendarEvent | null {
  if (!i.scheduled_at) return null;
  const lines = [
    `${role.title} at ${role.company}`,
    i.interviewers.trim() ? `With: ${i.interviewers.trim()}` : '',
    appUrl ? `Prep and notes: ${appUrl}/roles/${i.role_id}` : '',
  ].filter(Boolean);
  return {
    uid: `${i.id}@jobbotix.com`,
    title: `${interviewLabel(i)}: ${role.company}`,
    start: new Date(i.scheduled_at),
    durationMin: i.duration_min || 45,
    location: i.location.trim(),
    description: lines.join('\n'),
  };
}

const icsDate = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

const icsText = (s: string) =>
  s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');

/** RFC 5545 folding: lines over 75 octets continue on the next line after a space. */
function fold(line: string): string {
  const bytes = new TextEncoder();
  if (bytes.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  for (const ch of line) {
    if (bytes.encode(cur + ch).length > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/** An .ics file with the round and a reminder 30 minutes before. */
export function toIcs(e: CalendarEvent, now = new Date()): string {
  const end = new Date(e.start.getTime() + e.durationMin * MIN);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Jobbotix//Interviews//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `DTSTAMP:${icsDate(now)}`,
    `DTSTART:${icsDate(e.start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsText(e.title)}`,
    e.location ? `LOCATION:${icsText(e.location)}` : '',
    e.description ? `DESCRIPTION:${icsText(e.description)}` : '',
    /^https?:\/\//.test(e.location) ? `URL:${e.location}` : '',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Interview in 30 minutes',
    'TRIGGER:-PT30M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** A link that opens Google Calendar with the round filled in. */
export function googleCalendarUrl(e: CalendarEvent): string {
  const end = new Date(e.start.getTime() + e.durationMin * MIN);
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates: `${icsDate(e.start)}/${icsDate(end)}`,
    details: e.description,
    location: e.location,
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

/** "Tue 12 Nov, 14:00" in the given time zone. */
export function formatInterviewTime(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  };
  try {
    return d.toLocaleString('en-GB', { ...opts, timeZone });
  } catch {
    return d.toLocaleString('en-GB', { ...opts, timeZone: 'UTC' }) + ' UTC';
  }
}

// ---------------------------------------------------------------------------
// Thank-you note
// ---------------------------------------------------------------------------

export interface ThankYouContext {
  candidate: string;
  company: string;
  roleTitle: string;
  kind: InterviewKind;
  interviewers: string;
  /** The user's own notes on how it went; the model may use them, never quote them. */
  debrief: string;
  /** 0-3 letters the user wrote, to steer tone. */
  voiceSamples?: string[];
}

export const THANK_YOU_MAX_WORDS = 140;

/** First names from "Ana Ruiz (EM), Ben Ode" → ["Ana", "Ben"]. */
export function firstNames(interviewers: string): string[] {
  return interviewers
    .split(/,|;|\band\b|&|\//i)
    .map((s) => s.replace(/\(.*?\)/g, '').trim())
    .filter(Boolean)
    .map((s) => s.split(/\s+/)[0])
    .filter((s) => /^[\p{L}][\p{L}'-]*$/u.test(s))
    .slice(0, 4);
}

function greeting(interviewers: string): string {
  const names = firstNames(interviewers);
  if (!names.length) return 'Hello,';
  if (names.length === 1) return `Hi ${names[0]},`;
  return `Hi ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]},`;
}

/** A short note the user edits; the one bracket marks what only they can fill in. */
export function localThankYou(ctx: ThankYouContext): string {
  const what =
    ctx.kind === 'take_home'
      ? `for reviewing my take-home task for the ${ctx.roleTitle} role`
      : `for taking the time to speak with me about the ${ctx.roleTitle} role`;
  return [
    greeting(ctx.interviewers),
    '',
    `Thank you ${what} at ${ctx.company}. I especially enjoyed discussing [one thing from the conversation].`,
    '',
    `It left me even more keen on the role and on how your team works. If there is anything else that would help as you decide on next steps, I am happy to share it.`,
    '',
    'Best regards,',
    ctx.candidate || '',
  ]
    .join('\n')
    .trim();
}

export function thankYouPrompt(ctx: ThankYouContext): string {
  const samples = (ctx.voiceSamples ?? []).filter((s) => s.trim());
  return [
    `Write a short thank-you email after a job interview. Plain text, 70-${THANK_YOU_MAX_WORDS} words, no subject line, no placeholders in square brackets.`,
    `Start with "${greeting(ctx.interviewers)}" on its own line. Thank them for the ${INTERVIEW_KIND_LABELS[ctx.kind].toLowerCase()} for the ${ctx.roleTitle} role at ${ctx.company}. Mention one specific thing from the candidate's notes below, in your own words, and connect it to why they want the role. Never invent topics that are not in the notes; if the notes are empty, keep it general. No flattery, no repeating the resume, no exclamation marks. End with a one-line sign-off and the candidate's name.`,
    samples.length
      ? `Match the voice of these letters the candidate wrote (sentence length, directness, warmth), not their content:\n${samples.map((s, i) => `--- sample ${i + 1} ---\n${s.trim()}`).join('\n')}\n--- end samples ---`
      : 'Voice: direct, warm, brief. First person.',
    `Candidate: ${ctx.candidate || 'the candidate'}`,
    `Interviewers: ${ctx.interviewers.trim() || 'not recorded'}`,
    `Candidate's notes on how it went:\n${ctx.debrief.trim() || '(none)'}`,
    'Return only the email body.',
  ].join('\n\n');
}

/** Strips a subject line and code fences the model may add anyway. */
export function parseThankYouReply(reply: string): string {
  return reply
    .replace(/^```[a-z]*\n?|```$/gm, '')
    .replace(/^subject:.*\n+/i, '')
    .trim();
}
