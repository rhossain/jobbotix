import { Injectable, computed, inject, signal } from '@angular/core';
import {
  type MarketSignals,
  summariseRuns,
  localAnswer,
  localPrep,
  normalisePrep,
  type PrepSheet,
  localLetter,
  applyVariant,
  heuristicExtract,
  keywordReport,
  localTailor,
  normaliseResume,
  type VariantDiff,
} from '@jobbotix/shared-types';
import type {
  AiUsageRow,
  CoverLetterRow,
  ShareRow,
  SharedView,
  IngestKeyRow,
  ProfileRow,
  Json,
  RoleEventRow,
  RoleRow,
  ResumeRow,
  ResumeSections,
  ResumeVariantRow,
  RoleStatus,
  RunSummary,
  SavedViewRow,
  ScreeningAnswerRow,
  SearchProfileRow,
} from '@jobbotix/shared-types';
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
} from './repos';
import {
  DEMO_USER_ID,
  sampleEvents,
  sampleResume,
  sampleRoles,
  sampleScreeningAnswers,
  sampleSearchProfile,
} from './sample-data';

const STORAGE_KEY = 'jobbotix.demo.v1';

interface DemoState {
  roles: RoleRow[];
  events: RoleEventRow[];
  answers: ScreeningAnswerRow[];
  profile: SearchProfileRow;
  views: SavedViewRow[];
  resumes: ResumeRow[];
  variants: ResumeVariantRow[];
  profileRow: ProfileRow;
  ingestKeys: IngestKeyRow[];
  usage: AiUsageRow[];
  voiceSamples: CoverLetterRow[];
  shares: ShareRow[];
}

/** Reads the demo state from localStorage; falls back to the sample data. */
function loadState(): DemoState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DemoState;
      if (
        Array.isArray(parsed.roles) &&
        Array.isArray(parsed.events) &&
        parsed.profile
      )
        return {
          ...parsed,
          views: Array.isArray(parsed.views) ? parsed.views : [],
          resumes: Array.isArray(parsed.resumes)
            ? parsed.resumes
            : seedResumes(),
          voiceSamples: Array.isArray(parsed.voiceSamples)
            ? parsed.voiceSamples
            : [],
          shares: Array.isArray(parsed.shares) ? parsed.shares : [],
        };
    }
  } catch {
    /* private window or blocked storage: run from the samples */
  }
  return {
    roles: sampleRoles(),
    events: sampleEvents(),
    answers: sampleScreeningAnswers(),
    profile: sampleSearchProfile(),
    views: [],
    resumes: seedResumes(),
    variants: [],
    profileRow: seedProfile(),
    ingestKeys: [],
    usage: [],
    voiceSamples: [],
    shares: [],
  };
}

function seedProfile(): ProfileRow {
  const now = new Date().toISOString();
  return {
    id: DEMO_USER_ID,
    email: 'demo@jobbotix.local',
    name: 'Demo user',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    invite_code: null,
    anthropic_key_ref: null,
    default_model: 'claude-sonnet-4-5',
    is_admin: true,
    created_at: now,
    updated_at: now,
  };
}

function seedResumes(): ResumeRow[] {
  const at = new Date(Date.now() - 7 * 86_400_000).toISOString();
  return [
    {
      id: 'resume-master-1',
      user_id: DEMO_USER_ID,
      name: 'Master',
      is_master: true,
      sections: sampleResume() as unknown as Json,
      created_at: at,
      updated_at: at,
    },
  ];
}

function saveState(state: DemoState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* best effort */
  }
}

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random()}`;

/**
 * Demo-mode data: everything lives in signals, mirrored to localStorage so a
 * reload keeps the user's edits. Behaviour (status events, reminders) matches
 * what the database triggers do in the real implementation.
 */
@Injectable()
export class MemoryRolesRepo extends RolesRepo {
  private readonly state = signal<DemoState>(loadState());

  readonly roles = computed(() =>
    [...this.state().roles].sort((a, b) =>
      b.found_at.localeCompare(a.found_at),
    ),
  );
  readonly loaded = signal(true);
  readonly lastRun = computed<RunSummary | null>(() =>
    summariseRuns(this.state().events.filter((e) => e.kind === 'run')),
  );
  readonly reminders = computed(() =>
    this.state().events.filter((e) => e.kind === 'reminder'),
  );

  async load() {
    // What pg_cron's flag_follow_ups() does nightly on the hosted project.
    this.patch((s) => {
      for (const m of [7, 14]) {
        for (const r of s.roles) {
          if (r.status !== 'applied' || r.follow_up_days >= m) continue;
          if (
            Date.now() - new Date(r.status_changed_at).getTime() <
            m * 86_400_000
          )
            continue;
          r.follow_up_days = m;
          s.events.push({
            id: newId(),
            user_id: DEMO_USER_ID,
            role_id: r.id,
            kind: 'reminder',
            payload: { reason: 'follow_up', days: m },
            created_at: new Date().toISOString(),
          });
        }
      }
    });
  }

  async setStatus(id: string, status: RoleStatus) {
    this.patch((s) => {
      const role = s.roles.find((r) => r.id === id);
      if (!role || role.status === status) return;
      const now = new Date().toISOString();
      role.follow_up_days = 0;
      s.events.push({
        id: newId(),
        user_id: DEMO_USER_ID,
        role_id: id,
        kind: 'status_change',
        payload: { from: role.status, to: status },
        created_at: now,
      });
      // leaving shortlist clears its stale reminder, as pg_cron would stop re-flagging it
      if (role.status === 'shortlist')
        s.events = s.events.filter(
          (e) => !(e.kind === 'reminder' && e.role_id === id),
        );
      role.status = status;
      role.status_changed_at = now;
      role.updated_at = now;
    });
  }

  async setNotes(id: string, notes: string) {
    this.patch((s) => {
      const role = s.roles.find((r) => r.id === id);
      if (role) {
        role.notes = notes;
        role.updated_at = new Date().toISOString();
      }
    });
  }

  async setCoverLetter(id: string, body: string) {
    this.patch((s) => {
      const role = s.roles.find((r) => r.id === id);
      if (role) {
        role.cover_letter = body;
        role.updated_at = new Date().toISOString();
      }
    });
  }

  async eventsFor(roleId: string) {
    return this.state()
      .events.filter((e) => e.role_id === roleId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async statusEvents(days: number) {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    return this.state()
      .events.filter((e) => e.kind === 'status_change' && e.created_at >= since)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  async screeningAnswersFor(roleId: string) {
    return this.state()
      .answers.filter((a) => a.role_id === roleId)
      .sort((a, b) => a.position - b.position);
  }

  async dismissReminder(eventId: string) {
    this.patch((s) => {
      s.events = s.events.filter((e) => e.id !== eventId);
    });
  }

  async addFromUrl(url: string, text = '') {
    const existing = this.state().roles.find((r) => r.url === url);
    if (existing) return { id: existing.id, existed: true };
    // Demo mode cannot fetch other sites from the browser; it extracts from pasted text.
    const ex = heuristicExtract(url, `<title></title>${text}`);
    const id = newId();
    const now = new Date().toISOString();
    this.patch((s) => {
      s.roles.push({
        id,
        user_id: DEMO_USER_ID,
        company: ex.company || 'Unknown company',
        title: ex.title || 'Untitled role',
        url,
        source: 'Added by hand',
        location: ex.location,
        remote_scope: ex.location,
        type: ex.type,
        salary: ex.salary,
        posted_at: null,
        found_at: now,
        stack: ex.stack,
        score: 0,
        score_breakdown: {},
        reasons: [],
        gaps: [],
        ai_match: false,
        status: 'new',
        cover_letter: '',
        notes: '',
        posting_text: ex.postingText,
        posting_hash: '',
        status_changed_at: now,
        follow_up_days: 0,
        posting_id: null,
        source_id: null,
        remote_policy: 'unknown',
        hiring_countries: [],
        prep: {},
        created_at: now,
        updated_at: now,
      });
      s.events.push({
        id: newId(),
        user_id: DEMO_USER_ID,
        role_id: id,
        kind: 'ingested',
        payload: { source: 'manual', method: 'heuristic' },
        created_at: now,
      });
    });
    return { id, existed: false };
  }

  /** Shared with MemorySearchProfileRepo so one storage key holds everything. */
  patch(mutate: (draft: DemoState) => void) {
    const draft: DemoState = structuredClone(this.state());
    mutate(draft);
    this.state.set(draft);
    saveState(draft);
  }

  snapshot() {
    return this.state();
  }
}

@Injectable()
export class MemorySearchProfileRepo extends SearchProfileRepo {
  private readonly roles = inject(MemoryRolesRepo);

  readonly profile = computed<SearchProfileRow | null>(
    () => this.roles.snapshot().profile,
  );
  readonly loaded = signal(true);

  async load() {
    /* nothing to fetch */
  }

  async save(input: SearchProfileInput) {
    this.roles.patch((s) => {
      s.profile = {
        ...s.profile,
        ...input,
        updated_at: new Date().toISOString(),
      };
    });
  }

  async createIngestKey(label: string) {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const key =
      'jbx_demo_' +
      Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    this.roles.patch((s) => {
      s.ingestKeys.push({
        id: newId(),
        user_id: DEMO_USER_ID,
        key_hash: 'demo',
        label,
        last_used_at: null,
        revoked_at: null,
        created_at: new Date().toISOString(),
      });
    });
    return key;
  }
}

@Injectable()
export class MemorySavedViewsRepo extends SavedViewsRepo {
  private readonly roles = inject(MemoryRolesRepo);
  readonly views = computed(() => this.roles.snapshot().views);

  async load() {
    /* nothing to fetch */
  }

  async save(name: string, filters: Json, sort: string) {
    this.roles.patch((s) => {
      s.views = [
        ...s.views.filter((v) => v.name !== name),
        {
          id: newId(),
          user_id: DEMO_USER_ID,
          name,
          filters,
          sort,
          created_at: new Date().toISOString(),
        },
      ];
    });
  }

  async remove(id: string) {
    this.roles.patch((s) => {
      s.views = s.views.filter((v) => v.id !== id);
    });
  }
}

@Injectable()
export class MemoryResumesRepo extends ResumesRepo {
  private readonly roles = inject(MemoryRolesRepo);
  readonly resumes = computed(() =>
    [...this.roles.snapshot().resumes].sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    ),
  );
  readonly master = computed(
    () => this.resumes().find((r) => r.is_master) ?? null,
  );
  readonly loaded = signal(true);

  async load() {
    /* nothing to fetch */
  }

  async saveMaster(sections: ResumeSections, name = 'Master') {
    const id = newId();
    const now = new Date().toISOString();
    this.roles.patch((s) => {
      for (const r of s.resumes) r.is_master = false;
      s.resumes.push({
        id,
        user_id: DEMO_USER_ID,
        name,
        is_master: true,
        sections: normaliseResume(sections) as unknown as Json,
        created_at: now,
        updated_at: now,
      });
      // keep the last 20 versions
      s.resumes = s.resumes
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 20);
    });
    return id;
  }

  async restore(id: string) {
    this.roles.patch((s) => {
      for (const r of s.resumes) r.is_master = r.id === id;
    });
  }

  async remove(id: string) {
    this.roles.patch((s) => {
      const target = s.resumes.find((r) => r.id === id);
      if (!target || target.is_master) return;
      s.resumes = s.resumes.filter((r) => r.id !== id);
    });
  }
}

@Injectable()
export class MemoryVariantsRepo extends VariantsRepo {
  private readonly roles = inject(MemoryRolesRepo);

  async variantFor(roleId: string) {
    return (
      this.roles.snapshot().variants.find((v) => v.role_id === roleId) ?? null
    );
  }

  async generate(roleId: string, model?: string) {
    void model;
    const st = this.roles.snapshot();
    const role = st.roles.find((r) => r.id === roleId);
    const master = st.resumes.find((r) => r.is_master);
    if (!role) throw new Error('Role not found');
    if (!master) throw new Error('Save a master resume first');
    const sections = normaliseResume(master.sections);
    const postingText =
      role.posting_text ||
      [role.title, role.company, ...role.stack, ...role.reasons].join('\n');
    const proposals = localTailor(sections, {
      company: role.company,
      title: role.title,
      text: postingText,
      stack: role.stack,
    });
    const existing = await this.variantFor(roleId);
    const prior =
      (existing?.diff as unknown as VariantDiff | null)?.changes ?? [];
    const changes = proposals.map((c) => {
      const same = prior.find(
        (p) => p.path === c.path && p.kind === c.kind && p.after === c.after,
      );
      return {
        ...c,
        id: newId(),
        decision: same?.decision ?? ('pending' as const),
      };
    });
    const diff: VariantDiff = { baseResumeId: master.id, changes };
    const applied = applyVariant(sections, diff);
    const now = new Date().toISOString();
    const row: ResumeVariantRow = {
      id: existing?.id ?? newId(),
      user_id: DEMO_USER_ID,
      role_id: roleId,
      base_resume_id: master.id,
      sections: applied as unknown as Json,
      diff: diff as unknown as Json,
      keyword_report: keywordReport(postingText, applied) as unknown as Json,
      pdf_path: null,
      status: 'draft',
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    this.roles.patch((s) => {
      s.variants = [...s.variants.filter((v) => v.role_id !== roleId), row];
      s.events.push({
        id: newId(),
        user_id: DEMO_USER_ID,
        role_id: roleId,
        kind: 'generated',
        payload: { what: 'resume variant', method: 'local' },
        created_at: now,
      });
    });
    return row;
  }

  async saveDiff(
    variantId: string,
    diff: VariantDiff,
    sections: ResumeSections,
  ) {
    let out: ResumeVariantRow | undefined;
    this.roles.patch((s) => {
      const v = s.variants.find((x) => x.id === variantId);
      if (!v) return;
      const role = s.roles.find((r) => r.id === v.role_id);
      const postingText =
        role?.posting_text ||
        [role?.title, role?.company, ...(role?.stack ?? [])].join('\n');
      v.diff = diff as unknown as Json;
      v.sections = sections as unknown as Json;
      v.keyword_report = keywordReport(
        postingText,
        sections,
      ) as unknown as Json;
      v.updated_at = new Date().toISOString();
      out = { ...v };
    });
    if (!out) throw new Error('Variant not found');
    return out;
  }

  async approve(variantId: string) {
    let out: ResumeVariantRow | undefined;
    this.roles.patch((s) => {
      const v = s.variants.find((x) => x.id === variantId);
      if (!v) return;
      v.status = 'approved';
      v.updated_at = new Date().toISOString();
      out = { ...v };
    });
    if (!out) throw new Error('Variant not found');
    return out;
  }
}

@Injectable()
export class MemorySettingsRepo extends SettingsRepo {
  private readonly roles = inject(MemoryRolesRepo);
  readonly profile = computed<ProfileRow | null>(
    () => this.roles.snapshot().profileRow,
  );
  readonly models = signal<ModelChoice[]>([
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5 (fast, cheapest)' },
    { id: 'claude-sonnet-4-5', label: 'Sonnet 4.5 (default)' },
    { id: 'claude-opus-4-1', label: 'Opus 4.1 (best, priciest)' },
  ]);
  readonly usage = computed(() => this.roles.snapshot().usage);
  readonly ingestKeys = computed(() =>
    [...this.roles.snapshot().ingestKeys].sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    ),
  );

  async load() {
    /* nothing to fetch */
  }

  async updateProfile(patch: {
    name?: string;
    timezone?: string;
    default_model?: string;
  }) {
    this.roles.patch((s) => {
      s.profileRow = {
        ...s.profileRow,
        ...patch,
        updated_at: new Date().toISOString(),
      };
    });
  }

  async setAnthropicKey(key: string) {
    if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key.trim()))
      throw new Error(
        'That does not look like an Anthropic API key (they start with sk-ant-).',
      );
    // demo never stores the key; only the fact that one was set
    this.roles.patch((s) => {
      s.profileRow = {
        ...s.profileRow,
        anthropic_key_ref: 'demo',
        updated_at: new Date().toISOString(),
      };
    });
    return key.trim().slice(-4);
  }

  async clearAnthropicKey() {
    this.roles.patch((s) => {
      s.profileRow = {
        ...s.profileRow,
        anthropic_key_ref: null,
        updated_at: new Date().toISOString(),
      };
    });
  }

  async revokeIngestKey(id: string) {
    this.roles.patch((s) => {
      const k = s.ingestKeys.find((x) => x.id === id);
      if (k) k.revoked_at = new Date().toISOString();
    });
  }
}

@Injectable()
export class MemoryLettersRepo extends LettersRepo {
  private readonly roles = inject(MemoryRolesRepo);
  readonly voiceSamples = computed(() => this.roles.snapshot().voiceSamples);

  async load() {
    /* nothing to fetch */
  }

  async addVoiceSample(body: string) {
    const text = body.trim();
    if (!text) return;
    this.roles.patch((s) => {
      if (s.voiceSamples.length >= 3) s.voiceSamples.shift();
      const now = new Date().toISOString();
      s.voiceSamples.push({
        id: crypto.randomUUID(),
        user_id: DEMO_USER_ID,
        role_id: null,
        body: text,
        word_count: text.split(/\s+/).length,
        status: 'draft',
        voice_sample: true,
        created_at: now,
        updated_at: now,
      });
    });
  }

  async removeVoiceSample(id: string) {
    this.roles.patch((s) => {
      s.voiceSamples = s.voiceSamples.filter((v) => v.id !== id);
    });
  }

  async generate(roleId: string, opts?: { model?: string; rewrite?: boolean }) {
    const st = this.roles.snapshot();
    const role = st.roles.find((r) => r.id === roleId);
    const master = st.resumes.find((r) => r.is_master);
    if (!role) throw new Error('Role not found');
    if (!master) throw new Error('Save a master resume first');
    const body = localLetter({
      resume: normaliseResume(master.sections),
      posting: {
        company: role.company,
        title: role.title,
        text: role.posting_text,
        stack: role.stack,
        reasons: role.reasons,
        gaps: role.gaps,
      },
      voiceSamples: st.voiceSamples.map((v) => v.body),
      current: opts?.rewrite ? role.cover_letter : '',
    });
    this.roles.patch((s) => {
      const r = s.roles.find((x) => x.id === roleId);
      if (r) {
        r.cover_letter = body;
        r.updated_at = new Date().toISOString();
      }
      s.events.push({
        id: crypto.randomUUID(),
        user_id: DEMO_USER_ID,
        role_id: roleId,
        kind: 'generated',
        payload: { what: 'cover letter', method: 'local' },
        created_at: new Date().toISOString(),
      });
    });
    return { body, method: 'local' as const };
  }
}

@Injectable()
export class MemoryScreeningRepo extends ScreeningRepo {
  private readonly roles = inject(MemoryRolesRepo);

  async addQuestion(roleId: string, question: string) {
    const q = question.trim();
    if (!q) return;
    this.roles.patch((s) => {
      const position = s.answers.filter((a) => a.role_id === roleId).length;
      s.answers.push({
        id: crypto.randomUUID(),
        user_id: DEMO_USER_ID,
        role_id: roleId,
        question: q,
        answer: '',
        position,
        created_at: new Date().toISOString(),
      });
    });
  }

  async updateAnswer(id: string, answer: string) {
    this.roles.patch((s) => {
      const a = s.answers.find((x) => x.id === id);
      if (a) a.answer = answer;
    });
  }

  async remove(id: string) {
    this.roles.patch((s) => {
      s.answers = s.answers.filter((x) => x.id !== id);
    });
  }

  async answer(roleId: string, opts?: { ids?: string[]; model?: string }) {
    const st = this.roles.snapshot();
    const role = st.roles.find((r) => r.id === roleId);
    const master = st.resumes.find((r) => r.is_master);
    if (!role) throw new Error('Role not found');
    if (!master) throw new Error('Save a master resume first');
    const resume = normaliseResume(master.sections);
    const posting = {
      company: role.company,
      title: role.title,
      text: role.posting_text,
      stack: role.stack,
    };
    const wanted = opts?.ids ? new Set(opts.ids) : null;
    let answered = 0;
    this.roles.patch((s) => {
      for (const a of s.answers) {
        if (a.role_id !== roleId) continue;
        if (wanted ? !wanted.has(a.id) : a.answer.trim()) continue;
        a.answer = localAnswer(a.question, resume, posting);
        answered++;
      }
      if (answered)
        s.events.push({
          id: crypto.randomUUID(),
          user_id: DEMO_USER_ID,
          role_id: roleId,
          kind: 'generated',
          payload: {
            what: 'screening answers',
            count: answered,
            method: 'local',
          },
          created_at: new Date().toISOString(),
        });
    });
    return { answered, method: 'local' as const };
  }
}

@Injectable()
export class MemoryPrepRepo extends PrepRepo {
  private readonly roles = inject(MemoryRolesRepo);

  async generate(roleId: string, model?: string) {
    void model;
    const st = this.roles.snapshot();
    const role = st.roles.find((r) => r.id === roleId);
    const master = st.resumes.find((r) => r.is_master);
    if (!role) throw new Error('Role not found');
    if (!master) throw new Error('Save a master resume first');
    const previous = normalisePrep(role.prep);
    const sheet = localPrep(normaliseResume(master.sections), {
      company: role.company,
      title: role.title,
      text: role.posting_text,
      stack: role.stack,
      reasons: role.reasons,
      gaps: role.gaps,
    });
    sheet.userNotes = previous.userNotes;
    const practised = new Set(
      previous.questions.filter((q) => q.practised).map((q) => q.question),
    );
    sheet.questions = sheet.questions.map((q) => ({
      ...q,
      practised: practised.has(q.question),
    }));
    await this.save(roleId, sheet);
    this.roles.patch((s) => {
      s.events.push({
        id: crypto.randomUUID(),
        user_id: DEMO_USER_ID,
        role_id: roleId,
        kind: 'generated',
        payload: { what: 'interview prep', method: 'local' },
        created_at: new Date().toISOString(),
      });
    });
    return sheet;
  }

  async save(roleId: string, prep: PrepSheet) {
    this.roles.patch((s) => {
      const r = s.roles.find((x) => x.id === roleId);
      if (r) r.prep = prep as unknown as Json;
    });
  }
}

@Injectable()
export class MemoryAdminRepo extends AdminRepo {
  private readonly roles = inject(MemoryRolesRepo);

  async overview() {
    const s = this.roles.snapshot();
    const runs = s.events.filter((e) => e.kind === 'run');
    const user = {
      id: s.profileRow.id,
      email: s.profileRow.email,
      name: s.profileRow.name,
      is_admin: true,
      created_at: s.profileRow.created_at,
      timezone: s.profileRow.timezone,
      has_ai_key: !!s.profileRow.anthropic_key_ref,
      roles: s.roles.length,
      applied: s.roles.filter((r) =>
        ['applied', 'interview', 'offer', 'rejected'].includes(r.status),
      ).length,
      last_run: runs.length
        ? runs
            .map((e) => e.created_at)
            .sort()
            .reverse()[0]
        : null,
      runs_30d: runs.length,
      ai_calls_30d: s.usage.length,
      ingest_keys: s.ingestKeys.filter((k) => !k.revoked_at).length,
    };
    return {
      users: [user],
      totals: {
        users: 1,
        roles: s.roles.length,
        events: s.events.length,
        runs_30d: runs.length,
        ai_calls_30d: s.usage.length,
        db_bytes: new TextEncoder().encode(JSON.stringify(s)).length,
        open_requests: 0,
        open_codes: 0,
      },
    };
  }

  async requests() {
    return [];
  }

  async inviteRequest() {
    throw new Error('Invite requests need the hosted project');
    return '';
  }

  async signupOpen() {
    return false;
  }

  async setSignupOpen() {
    throw new Error('The sign-up switch needs the hosted project');
  }
}

@Injectable()
export class MemorySharesRepo extends SharesRepo {
  private readonly roles = inject(MemoryRolesRepo);
  readonly shares = computed(() => this.roles.snapshot().shares);

  async load() {
    /* nothing to fetch */
  }

  async create(kind: 'role' | 'board', roleId?: string) {
    const live = this.shares().find(
      (s) =>
        !s.revoked_at &&
        s.kind === kind &&
        (s.role_id ?? null) === (roleId ?? null),
    );
    if (live) return live.token;
    const token = crypto.randomUUID().replace(/-/g, '').slice(0, 24);
    this.roles.patch((s) => {
      s.shares.push({
        id: crypto.randomUUID(),
        user_id: DEMO_USER_ID,
        token,
        kind,
        role_id: roleId ?? null,
        created_at: new Date().toISOString(),
        revoked_at: null,
        views: 0,
      });
    });
    return token;
  }

  async revoke(id: string) {
    this.roles.patch((s) => {
      const sh = s.shares.find((x) => x.id === id);
      if (sh) sh.revoked_at = new Date().toISOString();
    });
  }

  async view(token: string): Promise<SharedView | null> {
    const st = this.roles.snapshot();
    const sh = st.shares.find((x) => x.token === token && !x.revoked_at);
    if (!sh) return null;
    const owner = st.profileRow.name || 'A Jobbotix user';
    if (sh.kind === 'role') {
      const r = st.roles.find((x) => x.id === sh.role_id);
      if (!r) return null;
      return {
        kind: 'role',
        owner,
        created_at: sh.created_at,
        role: {
          company: r.company,
          title: r.title,
          url: r.url,
          location: r.location,
          remote_scope: r.remote_scope,
          type: r.type,
          salary: r.salary,
          stack: r.stack,
          score: r.score,
          reasons: r.reasons,
          gaps: r.gaps,
          ai_match: r.ai_match,
          status: r.status,
          cover_letter: r.cover_letter,
          found_at: r.found_at,
          posting_text: r.posting_text.slice(0, 4000),
        },
      };
    }
    return {
      kind: 'board',
      owner,
      created_at: sh.created_at,
      roles: st.roles
        .filter((r) => r.status !== 'skipped')
        .sort((a, b) => b.score - a.score)
        .map((r) => ({
          company: r.company,
          title: r.title,
          url: r.url,
          score: r.score,
          status: r.status,
          type: r.type,
          remote_scope: r.remote_scope,
          status_changed_at: r.status_changed_at,
        })),
    };
  }
}

@Injectable()
export class MemoryMarketRepo extends MarketRepo {
  private readonly roles = inject(MemoryRolesRepo);

  /** One user in demo: the same aggregates, flagged as not yet shared. */
  async signals(): Promise<MarketSignals> {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const rs = this.roles.snapshot().roles.filter((r) => r.found_at >= since);
    const count = new Map<string, number>();
    for (const r of rs)
      for (const s of r.stack) {
        const k = s.trim().toLowerCase();
        count.set(k, (count.get(k) ?? 0) + 1);
      }
    const scope = (s: string) =>
      /worldwide|anywhere/i.test(s)
        ? 'Worldwide'
        : /overlap|utc|gmt|est|pst|cet|time ?zone/i.test(s)
          ? 'Timezone overlap'
          : /remote/i.test(s)
            ? 'Remote, region-limited'
            : s
              ? 'Other'
              : 'Unstated';
    const remote = new Map<string, number>();
    for (const r of rs)
      remote.set(
        scope(r.remote_scope),
        (remote.get(scope(r.remote_scope)) ?? 0) + 1,
      );
    const scores = rs.map((r) => r.score).sort((a, b) => a - b);
    const mid = Math.floor(scores.length / 2);
    return {
      since,
      users: 1,
      roles: rs.length,
      enough: false,
      stacks: [...count.entries()]
        .filter(([, c]) => c >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([name, c]) => ({ name, count: c })),
      remote: [...remote.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([s, c]) => ({ scope: s, count: c })),
      ai_share: rs.length
        ? Math.round((100 * rs.filter((r) => r.ai_match).length) / rs.length)
        : 0,
      contract_share: rs.length
        ? Math.round(
            (100 * rs.filter((r) => r.type === 'contract').length) / rs.length,
          )
        : 0,
      median_score: scores.length
        ? scores.length % 2
          ? scores[mid]
          : (scores[mid - 1] + scores[mid]) / 2
        : 0,
    };
  }
}
