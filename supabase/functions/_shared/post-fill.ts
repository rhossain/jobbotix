// A job that came into the pipeline without its post (imported from a
// LinkedIn archive or a spreadsheet) has a company, a title and a link, and
// little else. When the user pastes the post, what is read from it fills the
// blanks. It never overwrites what the job already says: the company and
// title came from the user's own file, and anything else already there was
// put there by the user or by an earlier read.

import type { ExtractedRole } from './extract.ts';

/** The fields of a stored job that a pasted post can fill. */
export interface StoredPost {
  company: string;
  title: string;
  location: string;
  remote_scope: string;
  type: ExtractedRole['type'];
  salary: string;
  stack: string[];
  posted_at: string | null;
  posting_text: string;
}

const PLACEHOLDER = /^(unknown company|untitled role)$/i;
const blank = (s: string) => !s.trim() || PLACEHOLDER.test(s.trim());

/**
 * The job as it should be saved once its post has been read. `byModel` says
 * a model read the post: only then is its word on the job type taken over
 * the stored one, because the pattern reader falls back to "full time".
 */
export function fillFromPost(
  stored: StoredPost,
  read: ExtractedRole,
  posted: string | null,
  byModel: boolean,
): StoredPost {
  return {
    company: blank(stored.company)
      ? read.company || stored.company
      : stored.company,
    title: blank(stored.title) ? read.title || stored.title : stored.title,
    location: stored.location.trim() ? stored.location : read.location,
    remote_scope: stored.remote_scope.trim()
      ? stored.remote_scope
      : read.location,
    type: byModel ? read.type : stored.type,
    salary: stored.salary.trim() ? stored.salary : read.salary,
    stack: stored.stack.length ? stored.stack : read.stack,
    posted_at: stored.posted_at ?? posted,
    posting_text: read.postingText,
  };
}
