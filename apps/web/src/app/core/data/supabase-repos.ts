import { Injectable, computed, inject, signal } from '@angular/core';
import {
  ATS_LABEL,
  careersSystem,
  normaliseCompanyResearch,
  normaliseResume,
  summariseRuns,
  type AtsKind,
  type CompanyRow,
} from '@jobbotix/shared-types';
import type {
  CompanyResearch,
  MarketSignals,
  PrepSheet,
  SharedView,
  VariantDiff,
} from '@jobbotix/shared-types';
import type {
  AiUsageRow,
  CoverLetterRow,
  ShareRow,
  InviteRequestRow,
  IngestKeyRow,
  Json,
  ProfileRow,
  ResumeRow,
  ResumeSections,
  ResumeVariantRow,
  RoleEventRow,
  SavedViewRow,
  RoleRow,
  RoleStatus,
  PostingSeenOn,
  RunSummary,
  SearchProfileRow,
} from '@jobbotix/shared-types';
import type { ResumeAiResult } from '@jobbotix/shared-types/resume-import';
import { Auth } from '../auth';
import { injectSupabase } from '../supabase';
import {
  ModelChoice,
  ResumesRepo,
  RolesRepo,
  SavedViewsRepo,
  SettingsRepo,
  VariantsRepo,
  SearchProfileInput,
  SearchProfileRepo,
  LettersRepo,
  ScreeningRepo,
  PrepRepo,
  AdminRepo,
  SharesRepo,
  MarketRepo,
  SourcesRepo,
  WatchlistRepo,
  type FollowedCompany,
  type AdminTotals,
  type AdminUser,
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
        .limit(60),
      this.supabase
        .from('role_events')
        .select('*')
        .eq('kind', 'reminder')
        .order('created_at', { ascending: false })
        .limit(50),
    ]);
    this._roles.set(roles.data ?? []);
    this._reminders.set(reminders.data ?? []);
    this._lastRun.set(summariseRuns(run.data ?? []));
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

  async seenOn(role: RoleRow): Promise<PostingSeenOn[]> {
    const own = role.source
      ? [{ sourceId: role.source_id ?? '', name: role.source, url: role.url }]
      : [];
    if (!role.posting_id) return own;
    const { data } = await this.supabase
      .from('posting_sources')
      .select('source_id, url, first_seen_at, source_catalog(name)')
      .eq('posting_id', role.posting_id)
      .order('first_seen_at', { ascending: true });
    const rows = (data ?? []) as unknown as {
      source_id: string;
      url: string;
      source_catalog: { name: string } | { name: string }[] | null;
    }[];
    if (!rows.length) return own;
    return rows.map((r) => {
      const c = Array.isArray(r.source_catalog)
        ? r.source_catalog[0]
        : r.source_catalog;
      return {
        sourceId: r.source_id,
        name: c?.name ?? r.source_id,
        url: r.url,
      };
    });
  }

  async statusEvents(days: number) {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const { data } = await this.supabase
      .from('role_events')
      .select('*')
      .eq('kind', 'status_change')
      .gte('created_at', since)
      .order('created_at');
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

  async rescore(id: string) {
    const { data, error } = await this.supabase.functions.invoke<{
      role?: RoleRow;
      method?: 'heuristic' | 'ai';
      aiError?: string;
      error?: string;
    }>('score-role', { body: { roleId: id } });
    if (error) throw new Error(await describeFunctionError(error));
    if (!data?.role) throw new Error(data?.error ?? 'Could not score the role');
    this.replace(data.role);
    return {
      score: data.role.score,
      method: data.method ?? 'heuristic',
      aiError: data.aiError,
    };
  }

  async researchCompany(
    id: string,
    opts: { model?: string; refresh?: boolean } = {},
  ) {
    const { data, error } = await this.supabase.functions.invoke<{
      research?: CompanyResearch;
      reused?: boolean;
      error?: string;
    }>('research-company', { body: { roleId: id, ...opts } });
    if (error) throw new Error(await describeFunctionError(error));
    if (!data?.research)
      throw new Error(data?.error ?? 'Could not research the company');
    const research = normaliseCompanyResearch(data.research);
    const role = this._roles().find((r) => r.id === id);
    if (role)
      this.replace({ ...role, company_research: research as unknown as Json });
    return { research, reused: !!data.reused };
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
  // The request never got an answer (offline, blocked, or the function is
  // not deployed); supabase-js's own wording means nothing to a user.
  if ((error as Error)?.name === 'FunctionsFetchError')
    return "Couldn't reach the server. Check your connection and try again.";
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

  async readWithAi(text: string, model?: string) {
    const { data, error } = await this.supabase.functions.invoke<
      Partial<ResumeAiResult> & { model?: string; error?: string }
    >('parse-resume', { body: model ? { text, model } : { text } });
    if (error) throw new Error(await describeFunctionError(error));
    if (!data?.resume)
      throw new Error(data?.error ?? 'Could not read the resume');
    return {
      resume: normaliseResume(data.resume),
      warnings: data.warnings ?? [],
      model: data.model,
    };
  }
}

@Injectable()
export class SupabaseVariantsRepo extends VariantsRepo {
  private readonly supabase = injectSupabase();

  async variantFor(roleId: string) {
    const { data } = await this.supabase
      .from('resume_variants')
      .select('*')
      .eq('role_id', roleId)
      .maybeSingle();
    return data ?? null;
  }

  async generate(roleId: string, model?: string) {
    const { data, error } = await this.supabase.functions.invoke<{
      variant?: ResumeVariantRow;
      method?: 'ai' | 'local';
      model?: string;
      error?: string;
    }>('tailor-resume', {
      body: model ? { roleId, model } : { roleId },
    });
    if (error) throw new Error(await describeFunctionError(error));
    if (!data?.variant)
      throw new Error(data?.error ?? 'Could not generate the variant');
    return { ...data.variant, method: data.method, model: data.model };
  }

  async saveDiff(
    variantId: string,
    diff: VariantDiff,
    sections: ResumeSections,
  ) {
    const { data, error } = await this.supabase
      .from('resume_variants')
      .update({
        diff: diff as unknown as Json,
        sections: sections as unknown as Json,
      })
      .eq('id', variantId)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  async approve(variantId: string) {
    const { data, error } = await this.supabase
      .from('resume_variants')
      .update({ status: 'approved' })
      .eq('id', variantId)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }
}

@Injectable()
export class SupabaseSettingsRepo extends SettingsRepo {
  private readonly supabase = injectSupabase();
  private readonly auth = inject(Auth);
  private readonly _profile = signal<ProfileRow | null>(null);
  private readonly _models = signal<ModelChoice[]>([]);
  private readonly _usage = signal<AiUsageRow[]>([]);
  private readonly _keys = signal<IngestKeyRow[]>([]);
  readonly profile = this._profile.asReadonly();
  readonly models = this._models.asReadonly();
  readonly usage = this._usage.asReadonly();
  readonly ingestKeys = this._keys.asReadonly();

  async load() {
    const userId = this.auth.user()?.id;
    if (!userId) return;
    const [profile, usage, keys] = await Promise.all([
      this.supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      this.supabase
        .from('ai_usage')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500),
      this.supabase
        .from('ingest_keys')
        .select('*')
        .order('created_at', { ascending: false }),
    ]);
    this._profile.set(profile.data ?? null);
    this._usage.set(usage.data ?? []);
    this._keys.set(keys.data ?? []);
    // settings.models is admin-only; fall back to the built-in list for everyone else
    this._models.set([
      { id: 'claude-haiku-4-5', label: 'Haiku 4.5 (fast, cheapest)' },
      { id: 'claude-sonnet-4-5', label: 'Sonnet 4.5 (default)' },
      { id: 'claude-opus-4-1', label: 'Opus 4.1 (best, priciest)' },
    ]);
  }

  async updateProfile(patch: {
    name?: string;
    timezone?: string;
    default_model?: string;
  }) {
    const userId = this.auth.user()?.id;
    if (!userId) throw new Error('Not signed in');
    const { data, error } = await this.supabase
      .from('profiles')
      .update(patch)
      .eq('id', userId)
      .select('*')
      .single();
    if (error) throw error;
    this._profile.set(data);
    await this.auth.refreshProfile();
  }

  async setAnthropicKey(key: string) {
    const { data, error } = await this.supabase.functions.invoke<{
      stored: boolean;
      last4?: string;
      error?: string;
    }>('set-anthropic-key', { body: { key } });
    if (error) throw new Error(await describeFunctionError(error));
    await this.load();
    return data?.last4 ?? '';
  }

  async clearAnthropicKey() {
    const { error } = await this.supabase.functions.invoke(
      'set-anthropic-key',
      { method: 'DELETE' },
    );
    if (error) throw new Error(await describeFunctionError(error));
    await this.load();
  }

  async revokeIngestKey(id: string) {
    const { error } = await this.supabase
      .from('ingest_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
    await this.load();
  }
}

@Injectable()
export class SupabaseLettersRepo extends LettersRepo {
  private readonly supabase = injectSupabase();
  readonly voiceSamples = signal<CoverLetterRow[]>([]);

  async load() {
    const { data } = await this.supabase
      .from('cover_letters')
      .select('*')
      .eq('voice_sample', true)
      .order('created_at', { ascending: true });
    this.voiceSamples.set(data ?? []);
  }

  async addVoiceSample(body: string) {
    const text = body.trim();
    if (!text) return;
    const user = (await this.supabase.auth.getUser()).data.user;
    if (!user) throw new Error('Sign in first');
    const oldest = this.voiceSamples()[0];
    if (this.voiceSamples().length >= 3 && oldest)
      await this.supabase.from('cover_letters').delete().eq('id', oldest.id);
    const { error } = await this.supabase.from('cover_letters').insert({
      user_id: user.id,
      body: text,
      voice_sample: true,
    });
    if (error) throw new Error(error.message);
    await this.load();
  }

  async removeVoiceSample(id: string) {
    await this.supabase.from('cover_letters').delete().eq('id', id);
    await this.load();
  }

  async generate(roleId: string, opts?: { model?: string; rewrite?: boolean }) {
    const { data, error } = await this.supabase.functions.invoke<{
      body?: string;
      method?: 'ai' | 'local';
      model?: string;
      error?: string;
    }>('draft-letter', { body: { roleId, ...opts } });
    if (error) throw new Error(await describeFunctionError(error));
    if (!data?.body)
      throw new Error(data?.error ?? 'Could not draft the letter');
    return {
      body: data.body,
      method: data.method ?? 'local',
      model: data.model,
    };
  }
}

@Injectable()
export class SupabaseScreeningRepo extends ScreeningRepo {
  private readonly supabase = injectSupabase();

  async addQuestion(roleId: string, question: string) {
    const q = question.trim();
    if (!q) return;
    const user = (await this.supabase.auth.getUser()).data.user;
    if (!user) throw new Error('Sign in first');
    const { count } = await this.supabase
      .from('screening_answers')
      .select('id', { count: 'exact', head: true })
      .eq('role_id', roleId);
    const { error } = await this.supabase.from('screening_answers').insert({
      user_id: user.id,
      role_id: roleId,
      question: q,
      position: count ?? 0,
    });
    if (error) throw new Error(error.message);
  }

  async updateAnswer(id: string, answer: string) {
    const { error } = await this.supabase
      .from('screening_answers')
      .update({ answer })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  async remove(id: string) {
    await this.supabase.from('screening_answers').delete().eq('id', id);
  }

  async answer(roleId: string, opts?: { ids?: string[]; model?: string }) {
    const { data, error } = await this.supabase.functions.invoke<{
      answered?: number;
      method?: 'ai' | 'local';
      model?: string;
      error?: string;
    }>('answer-screening', { body: { roleId, ...opts } });
    if (error) throw new Error(await describeFunctionError(error));
    if (data?.error) throw new Error(data.error);
    return {
      answered: data?.answered ?? 0,
      method: data?.method ?? 'local',
      model: data?.model,
    };
  }
}

@Injectable()
export class SupabasePrepRepo extends PrepRepo {
  private readonly supabase = injectSupabase();

  async generate(roleId: string, model?: string) {
    const { data, error } = await this.supabase.functions.invoke<{
      prep?: PrepSheet;
      error?: string;
    }>('prep-role', { body: model ? { roleId, model } : { roleId } });
    if (error) throw new Error(await describeFunctionError(error));
    if (!data?.prep)
      throw new Error(data?.error ?? 'Could not build the sheet');
    return data.prep;
  }

  async save(roleId: string, prep: PrepSheet) {
    const { error } = await this.supabase
      .from('roles')
      .update({ prep: prep as unknown as Json })
      .eq('id', roleId);
    if (error) throw new Error(error.message);
  }
}

@Injectable()
export class SupabaseAdminRepo extends AdminRepo {
  private readonly supabase = injectSupabase();

  async overview() {
    const { data, error } = await this.supabase.rpc('admin_overview');
    if (error) throw new Error(error.message);
    const v = (data ?? {}) as { users?: AdminUser[]; totals?: AdminTotals };
    return {
      users: v.users ?? [],
      totals: v.totals ?? {
        users: 0,
        roles: 0,
        events: 0,
        runs_30d: 0,
        ai_calls_30d: 0,
        db_bytes: 0,
        open_requests: 0,
        open_codes: 0,
      },
    };
  }

  async requests(): Promise<InviteRequestRow[]> {
    const { data } = await this.supabase
      .from('invite_requests')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    return data ?? [];
  }

  async inviteRequest(id: string) {
    const { data: req } = await this.supabase
      .from('invite_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (!req) throw new Error('Request not found');
    const { data: code, error } = await this.supabase.rpc(
      'admin_create_invite',
      {
        p_note: `request from ${req.email}`,
      },
    );
    if (error || !code)
      throw new Error(error?.message ?? 'Could not create a code');
    const { error: uErr } = await this.supabase
      .from('invite_requests')
      .update({ invited_code: code })
      .eq('id', id);
    if (uErr) throw new Error(uErr.message);
    return code;
  }

  async signupOpen() {
    const { data } = await this.supabase.rpc('signup_is_open');
    return data === true;
  }

  async setSignupOpen(open: boolean) {
    const { error } = await this.supabase.rpc('admin_set_open_signup', {
      p_open: open,
    });
    if (error) throw new Error(error.message);
  }
}

@Injectable()
export class SupabaseSharesRepo extends SharesRepo {
  private readonly supabase = injectSupabase();
  readonly shares = signal<ShareRow[]>([]);

  async load() {
    const { data } = await this.supabase
      .from('shares')
      .select('*')
      .order('created_at', { ascending: false });
    this.shares.set(data ?? []);
  }

  async create(kind: 'role' | 'board', roleId?: string) {
    await this.load();
    const live = this.shares().find(
      (s) =>
        !s.revoked_at &&
        s.kind === kind &&
        (s.role_id ?? null) === (roleId ?? null),
    );
    if (live) return live.token;
    const user = (await this.supabase.auth.getUser()).data.user;
    if (!user) throw new Error('Sign in first');
    const { data, error } = await this.supabase
      .from('shares')
      .insert({ user_id: user.id, kind, role_id: roleId ?? null })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    await this.load();
    return data.token;
  }

  async revoke(id: string) {
    await this.supabase
      .from('shares')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id);
    await this.load();
  }

  async view(token: string) {
    const { data } = await this.supabase.rpc('shared_view', { p_token: token });
    return (data as SharedView | null) ?? null;
  }
}

@Injectable()
export class SupabaseMarketRepo extends MarketRepo {
  private readonly supabase = injectSupabase();

  async signals() {
    const { data, error } = await this.supabase.rpc('market_signals');
    if (error) throw new Error(error.message);
    return data as unknown as MarketSignals;
  }
}

@Injectable()
export class SupabaseSourcesRepo extends SourcesRepo {
  private readonly supabase = injectSupabase();

  async list() {
    const { data, error } = await this.supabase
      .from('source_catalog')
      .select('*')
      .order('enabled', { ascending: false })
      .order('name');
    if (error) throw new Error(error.message);
    return data ?? [];
  }
}

@Injectable()
export class SupabaseWatchlistRepo extends WatchlistRepo {
  private readonly supabase = injectSupabase();

  async followed(): Promise<FollowedCompany[]> {
    const { data, error } = await this.supabase
      .from('company_follows')
      .select('created_at, companies(*)')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (
      (data ?? []) as unknown as {
        created_at: string;
        companies: CompanyRow | CompanyRow[] | null;
      }[]
    )
      .map((r) => ({
        company: Array.isArray(r.companies) ? r.companies[0] : r.companies,
        followedAt: r.created_at,
      }))
      .filter((f): f is FollowedCompany => !!f.company);
  }

  async follow(kind: AtsKind, slug: string, name: string) {
    const { error } = await this.supabase.rpc('follow_company', {
      p_kind: kind,
      p_slug: slug,
      p_name: name,
    });
    if (error) throw new Error(error.message);
  }

  async unfollow(companyId: string) {
    const { error } = await this.supabase
      .from('company_follows')
      .delete()
      .eq('company_id', companyId);
    if (error) throw new Error(error.message);
  }

  async companyFor(role: RoleRow) {
    if (role.posting_id) {
      const { data } = await this.supabase
        .from('postings')
        .select('ats_kind, ats_slug, company')
        .eq('id', role.posting_id)
        .maybeSingle();
      const kind = data?.ats_kind as AtsKind | null;
      if (data && kind && kind in ATS_LABEL && data.ats_slug)
        return { kind, slug: data.ats_slug, name: data.company };
    }
    const found = careersSystem(role.url);
    return found ? { ...found, name: role.company } : null;
  }
}
