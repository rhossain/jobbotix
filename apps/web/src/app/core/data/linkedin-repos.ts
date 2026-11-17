import { Injectable, signal } from '@angular/core';
import { companyKey, type LinkedInConnectionRow } from '@jobbotix/shared-types';
import { injectSupabase } from '../supabase';
import { LinkedInRepo, type LinkedInConnectionInput } from './repos';

/** Rows sent in one request when a new archive's list is saved. */
const BATCH = 500;

/**
 * The words of a search, safe to put in a filter: the characters that mean
 * something to the API's filter syntax or to a LIKE pattern are dropped.
 */
export function searchWords(q: string): string {
  return q
    .replace(/[%_*,()"'\\:.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/** The keys of the companies asked about, without blanks or repeats. */
export function companyKeys(companies: string[]): string[] {
  return [...new Set(companies.map(companyKey).filter(Boolean))].slice(0, 200);
}

function byCompany(
  rows: LinkedInConnectionRow[],
): Map<string, LinkedInConnectionRow[]> {
  const out = new Map<string, LinkedInConnectionRow[]>();
  for (const r of rows) {
    const key = r.company_key ?? companyKey(r.company);
    const list = out.get(key);
    if (list) list.push(r);
    else out.set(key, [r]);
  }
  return out;
}

const matches = (c: LinkedInConnectionInput, words: string) => {
  const w = words.toLowerCase();
  return [c.name, c.company, c.title].some((v) => v.toLowerCase().includes(w));
};

@Injectable()
export class SupabaseLinkedInRepo extends LinkedInRepo {
  private readonly supabase = injectSupabase();
  private readonly _total = signal<number | null>(null);
  readonly total = this._total.asReadonly();

  private async userId() {
    const user = (await this.supabase.auth.getUser()).data.user;
    if (!user) throw new Error('Sign in first');
    return user.id;
  }

  async refresh() {
    const { count, error } = await this.supabase
      .from('linkedin_connections')
      .select('id', { count: 'exact', head: true });
    // The app can be ahead of the database: no table yet means none kept.
    if (error?.code === 'PGRST205') {
      this._total.set(0);
      return;
    }
    if (error) throw new Error(error.message);
    this._total.set(count ?? 0);
  }

  async replaceConnections(list: LinkedInConnectionInput[]) {
    const user_id = await this.userId();
    // The archive is the whole list as it stands today, so it takes the
    // place of the old one: people no longer connected are not kept.
    const gone = await this.supabase
      .from('linkedin_connections')
      .delete()
      .eq('user_id', user_id);
    if (gone.error) throw new Error(gone.error.message);
    let saved = 0;
    let failed = 0;
    for (let i = 0; i < list.length; i += BATCH) {
      const batch = list.slice(i, i + BATCH);
      const { error } = await this.supabase
        .from('linkedin_connections')
        .insert(batch.map((c) => ({ ...c, user_id })));
      if (error) failed += batch.length;
      else saved += batch.length;
    }
    await this.refresh();
    return { saved, failed };
  }

  async search(q: string, limit = 50) {
    const words = searchWords(q);
    let query = this.supabase
      .from('linkedin_connections')
      .select('*')
      .order('name')
      .limit(Math.min(Math.max(limit, 1), 200));
    if (words)
      query = query.or(
        ['name', 'company', 'title']
          .map((col) => `${col}.ilike.%${words}%`)
          .join(','),
      );
    const { data, error } = await query;
    if (error?.code === 'PGRST205') return [];
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async atCompanies(companies: string[]) {
    const keys = companyKeys(companies);
    if (!keys.length) return new Map<string, LinkedInConnectionRow[]>();
    const { data, error } = await this.supabase
      .from('linkedin_connections')
      .select('*')
      .in('company_key', keys)
      .order('name')
      .limit(1000);
    // The app can be ahead of the database (no table, or no company_key
    // column yet): then nobody is known anywhere, and nothing is shown.
    if (error) return new Map<string, LinkedInConnectionRow[]>();
    return byCompany(data ?? []);
  }

  async deleteConnections() {
    const user_id = await this.userId();
    const { error } = await this.supabase
      .from('linkedin_connections')
      .delete()
      .eq('user_id', user_id);
    if (error) throw new Error(error.message);
    this._total.set(0);
  }
}

/**
 * Demo mode: the list lives in this tab's memory only. It is never written
 * to the browser's storage, so closing the tab forgets it.
 */
@Injectable()
export class MemoryLinkedInRepo extends LinkedInRepo {
  private rows: LinkedInConnectionRow[] = [];
  private readonly _total = signal<number | null>(0);
  readonly total = this._total.asReadonly();

  async refresh() {
    this._total.set(this.rows.length);
  }

  async replaceConnections(list: LinkedInConnectionInput[]) {
    const now = new Date().toISOString();
    this.rows = list.map((c, i) => ({
      ...c,
      id: `demo-linkedin-${i}`,
      user_id: 'demo',
      created_at: now,
    }));
    this._total.set(this.rows.length);
    return { saved: this.rows.length, failed: 0 };
  }

  async search(q: string, limit = 50) {
    const words = searchWords(q);
    return this.rows
      .filter((c) => !words || matches(c, words))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, Math.min(Math.max(limit, 1), 200));
  }

  async atCompanies(companies: string[]) {
    const keys = new Set(companyKeys(companies));
    return byCompany(
      this.rows
        .filter((c) => keys.has(companyKey(c.company)))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  async deleteConnections() {
    this.rows = [];
    this._total.set(0);
  }
}
