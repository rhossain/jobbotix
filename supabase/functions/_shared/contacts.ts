// People in the job search: who they are to you, who is due a message, and
// the short messages to send them (a cold note, a referral ask, a reply to a
// recruiter, a check-in), as a prompt for the user's key and a local draft.
//
// No imports, so it runs unchanged in the app and in the Edge Functions
// (supabase/functions/_shared/contacts.ts is a copy; keep the two in step).

export type ContactRelation =
  'recruiter' | 'hiring_manager' | 'referrer' | 'peer' | 'other';
export type TouchChannel =
  'email' | 'linkedin' | 'call' | 'message' | 'meeting' | 'other';
export type TouchDirection = 'out' | 'in';
export type MessageKind =
  'outreach' | 'referral' | 'recruiter_reply' | 'check_in';

export const CONTACT_RELATIONS: readonly ContactRelation[] = [
  'recruiter',
  'hiring_manager',
  'referrer',
  'peer',
  'other',
] as const;

export const CONTACT_RELATION_LABELS: Record<ContactRelation, string> = {
  recruiter: 'Recruiter',
  hiring_manager: 'Hiring manager',
  referrer: 'Can refer me',
  peer: 'Works there',
  other: 'Other',
};

export const TOUCH_CHANNELS: readonly TouchChannel[] = [
  'email',
  'linkedin',
  'call',
  'message',
  'meeting',
  'other',
] as const;

export const TOUCH_CHANNEL_LABELS: Record<TouchChannel, string> = {
  email: 'Email',
  linkedin: 'LinkedIn',
  call: 'Call',
  message: 'Message',
  meeting: 'Meeting',
  other: 'Other',
};

export const MESSAGE_KINDS: readonly MessageKind[] = [
  'outreach',
  'referral',
  'recruiter_reply',
  'check_in',
] as const;

export const MESSAGE_KIND_LABELS: Record<MessageKind, string> = {
  outreach: 'First message',
  referral: 'Ask for a referral',
  recruiter_reply: 'Reply to a recruiter',
  check_in: 'Check in',
};

/**
 * The message that fits, before the user picks another: answer a recruiter
 * who wrote last, check in after your own message, otherwise by who they are.
 */
export function suggestedMessage(
  relation: ContactRelation,
  lastTouch: TouchDirection | null,
): MessageKind {
  if (lastTouch === 'in')
    return relation === 'recruiter' ? 'recruiter_reply' : 'check_in';
  if (lastTouch === 'out') return 'check_in';
  if (relation === 'recruiter') return 'recruiter_reply';
  if (relation === 'referrer' || relation === 'peer') return 'referral';
  return 'outreach';
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** "2026-11-10" for a date in the given time zone (default: the runtime's). */
export function isoDay(d: Date, timeZone?: string): string {
  try {
    return d.toLocaleDateString('en-CA', { timeZone });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Adds whole days to a "YYYY-MM-DD" date. */
export function addDays(day: string, n: number): string {
  const t = Date.parse(`${day}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** People whose next-touch date is today or earlier, most overdue first. */
export function dueContacts<
  T extends { next_touch_on: string | null; name: string },
>(list: T[], today: string): T[] {
  return list
    .filter((c) => !!c.next_touch_on && (c.next_touch_on as string) <= today)
    .sort(
      (a, b) =>
        (a.next_touch_on as string).localeCompare(b.next_touch_on as string) ||
        a.name.localeCompare(b.name),
    );
}

/** Whole days from `from` to `to` ("YYYY-MM-DD"); negative when `to` is earlier. */
export function daysBetweenDays(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export interface MessageContext {
  kind: MessageKind;
  candidate: string;
  /** "Senior Frontend Engineer, 15 years in Angular" from the resume. */
  headline: string;
  contact: {
    name: string;
    title: string;
    company: string;
    relation: ContactRelation;
    notes: string;
  };
  /** The role the message is about, if any. */
  role?: { title: string; company: string; url: string } | null;
  /** The recruiter's message being answered (recruiter_reply). */
  incoming?: string;
  /** What the user wants said, in their words; optional. */
  ask?: string;
  /** 0-3 letters the user wrote, to steer tone. */
  voiceSamples?: string[];
}

export const MESSAGE_MAX_WORDS = 120;

const firstName = (name: string) => name.trim().split(/\s+/)[0] || '';

/** A short draft the user edits; brackets mark what only they know. */
export function localMessage(ctx: MessageContext): string {
  const hi = firstName(ctx.contact.name)
    ? `Hi ${firstName(ctx.contact.name)},`
    : 'Hi,';
  const company = ctx.role?.company || ctx.contact.company || 'your company';
  const role = ctx.role?.title;
  // "Senior Frontend Engineer | AI-Augmented Development" → the first part
  const head = ctx.headline
    .split(/\s[|·•–—-]\s|\s\|/)[0]
    .replace(/^(a|an)\s+/i, '')
    .trim();
  const me = head
    ? `I'm ${/^[aeiou]/i.test(head) ? 'an' : 'a'} ${head}`
    : "I'm a frontend engineer";
  const sign = ctx.candidate ? `\n${ctx.candidate}` : '';
  switch (ctx.kind) {
    case 'referral':
      return `${hi}

${role ? `I'm applying for the ${role} role at ${company}${ctx.role?.url ? ` (${ctx.role.url})` : ''}` : `I'm interested in frontend roles at ${company}`}. ${me}, and [one line on why this team or product].

Would you be comfortable referring me, or pointing me to the right person? I can send my resume and a two-line summary to make it easy. No problem at all if not.

Thanks,${sign}`;
    case 'recruiter_reply':
      return `${hi}

Thanks for reaching out${role ? ` about the ${role} role` : ''}. ${me} and I'm open to hearing more.

I'm looking for fully remote work${role ? '' : ' in frontend (Angular first)'}; could you share the salary range and whether the role is open to candidates in [your country]? Happy to set up a call this week.

Best,${sign}`;
    case 'check_in':
      return `${hi}

Following up on my last note${role ? ` about the ${role} role at ${company}` : ''}. [One new thing: an update, a question, or something useful to them].

No rush; I'd appreciate any update when you have a moment.

Best,${sign}`;
    default:
      return `${hi}

${me}${ctx.contact.title ? ` and saw that you're ${/^(a|an|the)\s/i.test(ctx.contact.title) ? '' : 'the '}${ctx.contact.title} at ${company}` : ` and I'm following ${company}`}. [One line on why you're writing to them in particular].

${role ? `I'm applying for the ${role} role and would value 15 minutes to hear how the team works.` : "If the team is hiring frontend engineers, I'd value 15 minutes to hear how it works."}

Thanks,${sign}`;
  }
}

export function messagePrompt(ctx: MessageContext): string {
  const samples = (ctx.voiceSamples ?? []).filter((s) => s.trim());
  const purpose: Record<MessageKind, string> = {
    outreach:
      'a first message to someone the candidate has not spoken to, asking for a short conversation about the team',
    referral:
      'a message asking this person to refer the candidate for the role, or to point them to the right person; make it easy to say no',
    recruiter_reply:
      "a reply to the recruiter's message below: interested, asks for the salary range and whether the role is open to the candidate's location, offers times for a call",
    check_in:
      'a short follow-up to an earlier message that adds one new, useful thing and asks for an update without pressure',
  };
  return [
    `Write ${purpose[ctx.kind]}. Plain text for email or LinkedIn, at most ${MESSAGE_MAX_WORDS} words, no subject line, no placeholders in square brackets.`,
    `Start with "Hi ${firstName(ctx.contact.name) || 'there'}," on its own line. Every claim about the candidate must come from the headline below; never invent shared history with the contact. No flattery, no exclamation marks. End with a one-line sign-off and the candidate's name.`,
    samples.length
      ? `Match the voice of these letters the candidate wrote (sentence length, directness, warmth), not their content:\n${samples.map((s, i) => `--- sample ${i + 1} ---\n${s.trim()}`).join('\n')}\n--- end samples ---`
      : 'Voice: direct, warm, brief. First person.',
    `Candidate: ${ctx.candidate || 'the candidate'}${ctx.headline ? `, ${ctx.headline}` : ''}`,
    `Contact: ${ctx.contact.name}${ctx.contact.title ? `, ${ctx.contact.title}` : ''}${ctx.contact.company ? ` at ${ctx.contact.company}` : ''}`,
    ctx.contact.notes.trim()
      ? `What the candidate knows about them:\n${ctx.contact.notes.trim()}`
      : '',
    ctx.role
      ? `Role: ${ctx.role.title} at ${ctx.role.company}${ctx.role.url ? ` (${ctx.role.url})` : ''}`
      : '',
    ctx.incoming?.trim()
      ? `The recruiter's message:\n${ctx.incoming.trim()}`
      : '',
    ctx.ask?.trim()
      ? `What the candidate wants to say:\n${ctx.ask.trim()}`
      : '',
    'Return only the message.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Strips a subject line and code fences the model may add anyway. */
export function parseMessageReply(reply: string): string {
  return reply
    .replace(/^```[a-z]*\n?|```$/gm, '')
    .replace(/^subject:.*\n+/i, '')
    .trim();
}
