// Company research shared between accounts for 30 days.
//
// A research with web search, paid for from Jobbotix's own key, is stored
// here under the company's normalised name. The next account that asks about
// the same company within SHARE_DAYS gets it without a model call and
// without spending credits; "Refresh" (or picking a model) always searches
// again.
//
// Only what is about the company is stored: the fields the model filled in
// and the pages it cited. The posting the first person was looking at, its
// address and anything read from its text stay on that person's role. A
// research done on an account's own key is that account's and is not shared.
//
// Two companies can share a name. When the posting lives on the company's
// own site, a stored research for another site is not used; otherwise the
// summary says which company it is about, and Refresh is one press away.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  hostOf,
  normaliseCompanyResearch,
  type CompanyResearch,
} from './company.ts';
import { normaliseCompany } from './sources/normalise.ts';

export const SHARE_DAYS = 30;
/** Rows older than this are deleted when a new one is written. */
const KEEP_DAYS = 90;

type Admin = Pick<SupabaseClient, 'from'>;

/** What a company is stored under; '' when the name is too thin to share on. */
export function researchKey(company: string): string {
  const key = normaliseCompany(company ?? '');
  return key.length >= 2 && key.length <= 120 ? key : '';
}

/** The same site, give or take a subdomain: careers.acme.com and acme.com. */
function sameSite(a: string, b: string): boolean {
  const x = hostOf(a);
  const y = hostOf(b);
  return !!x && !!y && (x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`));
}

/**
 * The part of a research that is about the company and nobody's posting, or
 * null when it should not be shared: no web search behind it, or no summary.
 */
export function sharable(
  research: CompanyResearch,
  from: { postingUrl: string; webSearch: boolean },
): Record<string, unknown> | null {
  if (!from.webSearch || !research.summary.trim()) return null;
  const posting = from.postingUrl.replace(/[#?].*$/, '').replace(/\/$/, '');
  return {
    summary: research.summary,
    website: research.website,
    headquarters: research.headquarters,
    founded: research.founded,
    size: research.size,
    funding: research.funding,
    remoteHiring: research.remoteHiring,
    product: research.product,
    engineering: research.engineering,
    reputation: research.reputation,
    recentNews: research.recentNews,
    redFlags: research.redFlags,
    sources: research.sources.filter(
      (s) =>
        !posting || s.url.replace(/[#?].*$/, '').replace(/\/$/, '') !== posting,
    ),
  };
}

export interface SharedResearch {
  research: CompanyResearch;
  model: string;
  researchedAt: string;
}

/**
 * The stored research for a company, or null when there is none, it is older
 * than SHARE_DAYS, or it is about another site than `site` (the company's own
 * site, when the posting lives on it). Never throws.
 */
export async function readResearch(
  admin: Admin,
  company: string,
  opts: { site?: string; now?: number } = {},
): Promise<SharedResearch | null> {
  const key = researchKey(company);
  if (!key) return null;
  try {
    const { data, error } = await admin
      .from('company_research_cache')
      .select('research, model, researched_at')
      .eq('company_key', key)
      .maybeSingle();
    if (error || !data) return null;
    const at = Date.parse(String(data.researched_at));
    const age = (opts.now ?? Date.now()) - at;
    if (!(age >= 0 && age <= SHARE_DAYS * 86_400_000)) return null;
    // Through the same reader as research stored on a role.
    const research = normaliseCompanyResearch(data.research);
    if (!research.summary) return null;
    if (opts.site && research.website && !sameSite(opts.site, research.website))
      return null;
    return {
      research,
      model: String(data.model ?? ''),
      researchedAt: new Date(at).toISOString(),
    };
  } catch {
    return null;
  }
}

/** Stores a research for everyone. Never throws; a failed write costs nothing. */
export async function writeResearch(
  admin: Admin,
  company: string,
  research: CompanyResearch,
  from: { postingUrl: string; webSearch: boolean; model: string },
  now: number = Date.now(),
): Promise<void> {
  const key = researchKey(company);
  const body = sharable(research, from);
  if (!key || !body) return;
  try {
    const { error } = await admin.from('company_research_cache').upsert(
      {
        company_key: key,
        research: body,
        model: from.model,
        researched_at: new Date(now).toISOString(),
      },
      { onConflict: 'company_key' },
    );
    if (error) {
      console.warn(`company_research_cache write failed: ${error.message}`);
      return;
    }
    await admin
      .from('company_research_cache')
      .delete()
      .lt(
        'researched_at',
        new Date(now - KEEP_DAYS * 86_400_000).toISOString(),
      );
  } catch (e) {
    console.warn(
      `company_research_cache write failed: ${(e as Error).message}`,
    );
  }
}

/** "3 November 2026", for the note under a shared research. */
export function sharedNote(company: string, researchedAt: string): string {
  const on = new Date(researchedAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `Jobbotix researched ${company} on ${on}, so this needed no new search and used no credits. Refresh to search again.`;
}
