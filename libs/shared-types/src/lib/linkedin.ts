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

/** The number LinkedIn gives a job, from any of the links it shows for one. */
export function linkedInJobId(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return null;
  // /jobs/view/4012345678, /jobs/view/senior-engineer-at-acme-4012345678,
  // /comm/jobs/view/…, and ?currentJobId= on search and collection pages
  let path = u.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    /* a stray % in the path: read it as it is */
  }
  const inPath = /\/jobs\/view\/(?:[^/?#]*-)?(\d{6,})(?:[/?#]|$)/.exec(path);
  if (inPath) return inPath[1];
  const current = u.searchParams.get('currentJobId') ?? '';
  return /^\d{6,}$/.test(current) ? current : null;
}

/** The one address a LinkedIn job is kept under; null when it is not one. */
export function linkedInJobUrl(raw: string): string | null {
  const id = linkedInJobId(raw);
  return id ? `https://www.linkedin.com/jobs/view/${id}/` : null;
}

/**
 * The link to keep on a job. LinkedIn shows the same job under many
 * addresses (a search page with ?currentJobId=, a collection, an email
 * link), most of them long and full of tracking codes; all of them become
 * the job's own short address, so the same job is recognised however it
 * was reached. Any other link is kept as it was typed.
 */
export function jobLinkToKeep(raw: string): string {
  return linkedInJobUrl(raw) ?? raw.trim();
}

/** Shortest pasted text that reads as a job post (extract-role's floor). */
export const LINKEDIN_TEXT_MIN = 80;

/** Said wherever a LinkedIn link arrives without the post's text. */
export const LINKEDIN_PASTE_MESSAGE =
  'Jobbotix does not open pages on LinkedIn, because LinkedIn does not allow it. Open the job on LinkedIn, select the text of the post, copy it, and paste it into "Text of the job post".';
