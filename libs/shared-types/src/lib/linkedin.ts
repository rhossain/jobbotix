/**
 * LinkedIn links. Jobbotix never opens a LinkedIn page and never reads one:
 * LinkedIn's User Agreement does not allow software to do either. A job
 * found on LinkedIn is added from text the user copies and pastes
 * themselves, and the link is kept on the job.
 * supabase/functions/_shared/linkedin.ts is a copy; keep the two in step.
 */

/** linkedin.com and its subdomains, and LinkedIn's short links (lnkd.in). */
const LINKEDIN_HOST = /(^|\.)(linkedin\.com|lnkd\.in)$/;

/** Any page on LinkedIn. Jobbotix must never fetch one or read one. */
export function isLinkedInUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    return LINKEDIN_HOST.test(u.hostname.toLowerCase().replace(/\.$/, ''));
  } catch {
    return false;
  }
}

/** Shortest pasted text that reads as a job post (extract-role's floor). */
export const LINKEDIN_TEXT_MIN = 80;

/** Said wherever a LinkedIn link arrives without the post's text. */
export const LINKEDIN_PASTE_MESSAGE =
  'Jobbotix does not open pages on LinkedIn, because LinkedIn does not allow it. Open the job on LinkedIn, select the text of the post, copy it, and paste it into "Text of the job post".';
