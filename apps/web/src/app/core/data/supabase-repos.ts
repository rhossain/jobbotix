import { Injectable, computed, inject, signal } from '@angular/core';
import type {
  Json,
  ResumeRow,
  ResumeSections,
  RoleEventRow,
  SavedViewRow,
  RoleRow,
  RoleStatus,
  RunSummary,
  SearchProfileRow,
} from '@jobbotix/shared-types';
import { Auth } from '../auth';
import { injectSupabase } from '../supabase';
import {
  ResumesRepo,
  RolesRepo,
  SavedViewsRepo,
  SearchProfileInput,
  SearchProfileRepo,
} from './repos';

/**
 * Real data layer: supabase-js with RLS doing the per-user filtering. Reads go
 * straight to the tables; status changes rely on the database trigger to log
 * events and stamp status_changed_at.
 */
@Injectable()
export class SupabaseRolesRepo extends RolesRepo {
  private readonly supabase = injectSupabase();
  private readonly _roles = signal<RoleRow[]>([]);
  private readonly _reminders = signal<RoleEventRow[]>([]);
  private readonly _lastRun = signal<RunSummary | null>(null);

  readonly roles = this._roles.asReadonly();
  readonly loaded = signal(false);
  readonly lastRun = this._lastRun.asReadonly();
  readonly reminders = this._reminders.asReadonly();

  async load() {
    const [roles, run, reminders] = await Promise.all([
      this.supabase
        .from('roles')
        .select('*')
        .order('found_at', { ascending: false })
        .limit(1000),
      this.supabase
        .from('role_events')
        .select('*')
        .eq('kind', 'run')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      this.supabase
        .from('role_events')
        .select('*')
        .eq('kind', 'reminder')
        .order('created_at', { ascending: false })
        .limit(50),
    ]);
    this._roles.set(roles.data ?? []);
    this._reminders.set(reminders.data ?? []);
    if (run.data) {
      const p = run.data.payload as Record<string, number | string>;
      this._lastRun.set({
        at: String(p['at'] ?? run.data.created_at),
        searched: Number(p['searched'] ?? 0),
        added: Number(p['added'] ?? 0),
        excluded: Number(p['excluded'] ?? 0),
      });
    }
    this.loaded.set(true);
  }

  async setStatus(id: string, status: RoleStatus) {
    const { data, error } = await this.supabase
      .from('roles')
      .update({ status })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    this.replace(data);
    if (status !== 'shortlist')
      this._reminders.update((rs) => rs.filter((r) => r.role_id !== id));
  }

  async setNotes(id: string, notes: string) {
    const { data, error } = await this.supabase
      .from('roles')
      .update({ notes })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    this.replace(data);
  }

  async setCoverLetter(id: string, cover_letter: string) {
    const { data, error } = await this.supabase
      .from('roles')
      .update({ cover_letter })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    this.replace(data);
  }

  async eventsFor(roleId: string) {
    const { data } = await this.supabase
      .from('role_events')
      .select('*')
      .eq('role_id', roleId)
      .order('created_at', { ascending: false });
    return data ?? [];
  }

  async screeningAnswersFor(roleId: string) {
    const { data } = await this.supabase
      .from('screening_answers')
      .select('*')
      .eq('role_id', roleId)
      .order('position');
    return data ?? [];
  }

  async dismissReminder(eventId: string) {
    await this.supabase.from('role_events').delete().eq('id', eventId);
    this._reminders.update((rs) => rs.filter((r) => r.id !== eventId));
  }

  async addFromUrl(url: string, text = '') {
    const { data, error } = await this.supabase.functions.invoke<{
      id: string;
      existed: boolean;
      error?: string;
    }>('extract-role', {
      body: text ? { url, text } : { url },
    });
    if (error) throw new Error(await describeFunctionError(error));
    if (!data?.id) throw new Error(data?.error ?? 'Could not add the role');
    await this.load();
    return { id: data.id, existed: data.existed };
  }

  private replace(row: RoleRow) {
    this._roles.update((rs) => rs.map((r) => (r.id === row.id ? row : r)));
  }
}

@Injectable()
export class SupabaseSearchProfileRepo extends SearchProfileRepo {
  private readonly supabase = injectSupabase();
  private readonly auth = inject(Auth);
  private readonly _profile = signal<SearchProfileRow | null>(null);

  readonly profile = computed(() => this._profile());
  readonly loaded = signal(false);

  async load() {
    const { data } = await this.supabase
      .from('search_profiles')
      .select('*')
      .eq('active', true)
      .maybeSingle();
    this._profile.set(data ?? null);
    this.loaded.set(true);
  }

  async save(input: SearchProfileInput) {
    const current = this._profile();
    if (current) {
      const { data, error } = await this.supabase
        .from('search_profiles')
        .update(input)
        .eq('id', current.id)
        .select('*')
        .single();
      if (error) throw error;
      this._profile.set(data);
      return;
    }
    const userId = this.auth.user()?.id;
    if (!userId) throw new Error('Not signed in');
    const { data, error } = await this.supabase
      .from('search_profiles')
      .insert({ ...input, user_id: userId, active: true })
      .select('*')
      .single();
    if (error) throw error;
    this._profile.set(data);
  }

  async createIngestKey(label: string) {
    const { data, error } = await this.supabase.rpc('create_ingest_key', {
      p_label: label,
    });
    if (error) throw error;
    return data ?? '';
  }
}

@Injectable()
export class SupabaseSavedViewsRepo extends SavedViewsRepo {
  private readonly supabase = injectSupabase();
  private readonly auth = inject(Auth);
  private readonly _views = signal<SavedViewRow[]>([]);
  readonly views = this._views.asReadonly();

  async load() {
    const { data } = await this.supabase
      .from('saved_views')
      .select('*')
      .order('created_at');
    this._views.set(data ?? []);
  }

  async save(name: string, filters: Json, sort: string) {
    const userId = this.auth.user()?.id;
    if (!userId) throw new Error('Not signed in');
    const existing = this._views().find((v) => v.name === name);
    if (existing) {
      const { error } = await this.supabase
        .from('saved_views')
        .update({ filters, sort })
        .eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await this.supabase
        .from('saved_views')
        .insert({ user_id: userId, name, filters, sort });
      if (error) throw error;
    }
    await this.load();
  }

  async remove(id: string) {
    const { error } = await this.supabase
      .from('saved_views')
      .delete()
      .eq('id', id);
    if (error) throw error;
    this._views.update((vs) => vs.filter((v) => v.id !== id));
  }
}

/** supabase-js wraps non-2xx responses; surface the function's own message. */
async function describeFunctionError(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = (await ctx.json()) as { error?: string };
      if (body?.error) return body.error;
    } catch {
      /* fall through */
    }
  }
  return (error as Error).message || 'Request failed';
}

@Injectable()
export class SupabaseResumesRepo extends ResumesRepo {
  private readonly supabase = injectSupabase();
  private readonly auth = inject(Auth);
  private readonly _resumes = signal<ResumeRow[]>([]);
  readonly resumes = this._resumes.asReadonly();
  readonly master = computed(
    () => this._resumes().find((r) => r.is_master) ?? null,
  );
  readonly loaded = signal(false);

  async load() {
    const { data } = await this.supabase
      .from('resumes')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    this._resumes.set(data ?? []);
    this.loaded.set(true);
  }

  async saveMaster(sections: ResumeSections, name = 'Master') {
    const userId = this.auth.user()?.id;
    if (!userId) throw new Error('Not signed in');
    await this.supabase
      .from('resumes')
      .update({ is_master: false })
      .eq('user_id', userId)
      .eq('is_master', true);
    const { data, error } = await this.supabase
      .from('resumes')
      .insert({
        user_id: userId,
        name,
        is_master: true,
        sections: sections as unknown as Json,
      })
      .select('id')
      .single();
    if (error || !data) throw error ?? new Error('insert failed');
    await this.load();
    return data.id;
  }

  async restore(id: string) {
    const userId = this.auth.user()?.id;
    if (!userId) throw new Error('Not signed in');
    await this.supabase
      .from('resumes')
      .update({ is_master: false })
      .eq('user_id', userId)
      .eq('is_master', true);
    const { error } = await this.supabase
      .from('resumes')
      .update({ is_master: true })
      .eq('id', id);
    if (error) throw error;
    await this.load();
  }

  async remove(id: string) {
    const { error } = await this.supabase
      .from('resumes')
      .delete()
      .eq('id', id)
      .eq('is_master', false);
    if (error) throw error;
    this._resumes.update((rs) => rs.filter((r) => r.id !== id));
  }
}
