// Builds the email a Help chat request becomes. Kept apart from the function
// so it can be tested without a network or a database.

export const SUPPORT_MAX_MESSAGE = 2000;
export const SUPPORT_MAX_CONVERSATION = 4000;
export const SUPPORT_MAX_PAGE = 300;
/** Requests one account may send in 24 hours. */
export const SUPPORT_DAILY_LIMIT = 5;

export interface SupportInput {
  message: string;
  page: string;
  conversation: string;
}

export interface SupportSender {
  email: string;
  name: string;
  plan: string;
  userId: string;
}

/** The request as the browser sent it, cut to size; null when unusable. */
export function readSupportInput(body: unknown): SupportInput | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const message = str(b.message).trim().slice(0, SUPPORT_MAX_MESSAGE);
  if (!message) return null;
  return {
    message,
    // A path inside the app, never a full address someone could plant.
    page: /^\/[\w\-/.]*$/.test(str(b.page))
      ? str(b.page).slice(0, SUPPORT_MAX_PAGE)
      : '',
    conversation: str(b.conversation).trim().slice(0, SUPPORT_MAX_CONVERSATION),
  };
}

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** One line for the subject: the start of the question, no line breaks. */
export function supportSubject(message: string): string {
  const line = message.replace(/\s+/g, ' ').trim();
  const short = line.length > 70 ? `${line.slice(0, 67).trimEnd()}…` : line;
  return `Help request: ${short}`;
}

export function supportEmail(
  input: SupportInput,
  from: SupportSender,
  appUrl: string,
): { subject: string; text: string; html: string } {
  const pageUrl = input.page ? `${appUrl}${input.page}` : '';
  const who = from.name ? `${from.name} <${from.email}>` : from.email;
  const text = [
    input.message,
    '',
    '---',
    `From: ${who}`,
    `Plan: ${from.plan}`,
    pageUrl ? `Page: ${pageUrl}` : 'Page: not given',
    `Account: ${from.userId}`,
    '',
    'Help chat before this:',
    input.conversation || '(nothing; they went straight to support)',
    '',
    'Reply to this email to answer them.',
  ].join('\n');

  const p = (s: string) =>
    `<p style="margin:0 0 12px;white-space:pre-wrap">${escapeHtml(s)}</p>`;
  const html = [
    '<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#1b2b27">',
    p(input.message),
    '<hr style="border:0;border-top:1px solid #d9e2df;margin:16px 0">',
    '<p style="margin:0 0 4px;font-size:13px;color:#5b6b66">',
    `From: ${escapeHtml(who)}<br>Plan: ${escapeHtml(from.plan)}<br>`,
    pageUrl
      ? `Page: <a href="${escapeHtml(pageUrl)}">${escapeHtml(input.page)}</a><br>`
      : 'Page: not given<br>',
    `Account: ${escapeHtml(from.userId)}</p>`,
    '<p style="margin:16px 0 4px;font-size:13px;font-weight:600;color:#5b6b66">Help chat before this</p>',
    `<pre style="margin:0;font-size:13px;white-space:pre-wrap;color:#5b6b66">${escapeHtml(
      input.conversation || '(nothing; they went straight to support)',
    )}</pre>`,
    '<p style="margin:16px 0 0;font-size:13px;color:#5b6b66">Reply to this email to answer them.</p>',
    '</div>',
  ].join('');

  return { subject: supportSubject(input.message), text, html };
}
