// One extraction per posting, shared by everyone who adds it.
//
// extract-role asks a model to read a posting into fields. Before it does, it
// looks the posting up here by a fingerprint of its address and text; after a
// model has read it, the fields are stored under that fingerprint. The second
// person to add the same posting gets the fields without a model call.
//
// The fingerprint covers the text as well as the address, because the same
// address can carry different text: a careers page that lists many jobs, with
// one of them pasted in, must not answer with another job's fields. A posting
// whose text has changed is simply read again.
//
// A stored extraction says what the posting says and which model read it,
// never who added it. Entries older than MAX_AGE_DAYS are not used.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { parseExtraction } from './extract.ts';

export const MAX_AGE_DAYS = 30;
/** Rows older than this are deleted when a new one is written. */
const KEEP_DAYS = 90;
/** As much of the text as the model is shown (extractionPrompt). */
const TEXT_CHARS = 30_000;

export type Extraction = NonNullable<ReturnType<typeof parseExtraction>>;

type Admin = Pick<SupabaseClient, 'from'>;

/** Query parameters that say where a visitor came from, not which posting it is. */
const TRACKING =
  /^(utm_[a-z_]+|ref|referrer|source|src|gh_src|lever-source(\[\])?|lever-origin|gclid|fbclid|msclkid|mc_[a-z]+|trk|trackingid|refid|igshid|_hs[a-z]+|hsctatracking)$/i;

/**
 * The posting's address without what varies from one visitor to the next:
 * tracking parameters, the fragment, a trailing slash, the host's case.
 * Parameters that pick the posting (gh_jid, id, jobId) stay.
 */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hash = '';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    const keep = [...u.searchParams.entries()]
      .filter(([k]) => !TRACKING.test(k))
      .sort(([a], [b]) => a.localeCompare(b));
    u.search = '';
    for (const [k, v] of keep) u.searchParams.append(k, v);
    u.pathname = u.pathname.replace(/\/+$/, '') || '/';
    return u.toString();
  } catch {
    return url.trim();
  }
}

/** The fingerprint an extraction is stored under: sha256 in hex. */
export async function extractionKey(
  url: string,
  text: string,
): Promise<string> {
  const body = `${canonicalUrl(url)}\n${text.slice(0, TEXT_CHARS).replace(/\s+/g, ' ').trim()}`;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(body),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Whether an extraction says enough to be worth keeping or using. */
function useful(e: Extraction | null): e is Extraction {
  return !!e && !!(e.title || e.company);
}

/**
 * The stored extraction for a posting, or null when there is none, it is too
 * old, or it does not read as one. Never throws: a failed lookup only means
 * the model reads the posting.
 */
export async function readExtraction(
  admin: Admin,
  key: string,
  now: number = Date.now(),
): Promise<Extraction | null> {
  try {
    const { data, error } = await admin
      .from('posting_extractions')
      .select('extraction, created_at')
      .eq('key', key)
      .maybeSingle();
    if (error || !data) return null;
    const age = now - Date.parse(String(data.created_at));
    if (!(age >= 0 && age <= MAX_AGE_DAYS * 86_400_000)) return null;
    // Through the same parser as a model reply, so a stored row can never
    // put a shape into a role that a reply could not.
    const e = parseExtraction(JSON.stringify(data.extraction));
    return useful(e) ? e : null;
  } catch {
    return null;
  }
}

/** Stores what a model read. Never throws; a failed write costs nothing. */
export async function writeExtraction(
  admin: Admin,
  key: string,
  extraction: Extraction,
  by: { provider: string; model: string },
  now: number = Date.now(),
): Promise<void> {
  if (!useful(extraction)) return;
  try {
    const { error } = await admin.from('posting_extractions').upsert(
      {
        key,
        extraction,
        provider: by.provider,
        model: by.model,
        created_at: new Date(now).toISOString(),
      },
      { onConflict: 'key' },
    );
    if (error) {
      console.warn(`posting_extractions write failed: ${error.message}`);
      return;
    }
    await admin
      .from('posting_extractions')
      .delete()
      .lt('created_at', new Date(now - KEEP_DAYS * 86_400_000).toISOString());
  } catch (e) {
    console.warn(`posting_extractions write failed: ${(e as Error).message}`);
  }
}
