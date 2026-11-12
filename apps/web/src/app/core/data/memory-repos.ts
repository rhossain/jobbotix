import { Injectable, computed, inject, signal } from '@angular/core';
import { sampleReview } from './sample-review';
import {
  type MarketSignals,
  careersSystem,
  summariseRuns,
  type AtsKind,
  localAnswer,
  localPrep,
  normalisePrep,
  type PrepSheet,
  localLetter,
  localThankYou,
  localMessage,
  applyVariant,
  DEFAULT_MODEL,
  FALLBACK_MODELS,
  heuristicExtract,
  localCompanyResearch,
  keywordReport,
  localTailor,
  normaliseResume,
  OPEN_ENTITLEMENTS,
  type Entitlements,
  type VariantDiff,
  type AdminUserDetail,
  type AdminUserFilters,
  type AdminUserRow,
  type AiConnectionView,
  type AiRouteInfo,
  type ProAiAdmin,
  adminMoney,
  adminSearchExplain,
  titleSuggestions,
  adminUserDetail,
  adminUserRow,
  CREDIT_PRICES,
  NO_AI_ROUTE,
  PRICING,
  PROVIDERS,
  MODEL_ID,
  normaliseProAiAdmin,
} from '@jobbotix/shared-types';
import type {
  SourceCatalogRow,
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
  PostingSeenOn,
  PoolPostingFacts,
  InterviewRow,
  AppErrorRow,
  ContactRow,
  RoleContactRow,
  ContactTouchRow,
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
  SourcesRepo,
  WatchlistRepo,
  InterviewsRepo,
  PeopleRepo,
  AccountDataRepo,
  PlanRepo,
  type AdminPlan,
  type ImportRoleInput,
  type ContactInput,
  type MessageRequest,
  type TouchInput,
  type FollowedCompany,
  type InterviewInput,
  type LetterResult,
  type AiCheck,
  type NewAiConnection,
  type ProAiPatch,
} from './repos';
import {
  DEMO_USER_ID,
  sampleEvents,
  sampleResume,
  sampleRoles,
  sampleScreeningAnswers,
  sampleSearchProfile,
  sampleFollows,
  sampleSources,
  sampleUsage,
  sampleInterviews,
  samplePeople,
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
  /** AI connections added in the demo (no key is ever kept). */
  connections?: AiConnectionView[];
  voiceSamples: CoverLetterRow[];
  shares: ShareRow[];
  interviews: InterviewRow[];
  contacts: ContactRow[];
  links: RoleContactRow[];
  touches: ContactTouchRow[];
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
          interviews: Array.isArray(parsed.interviews)
            ? parsed.interviews
            : sampleInterviews(),
          ...(Array.isArray(parsed.contacts)
            ? {
                contacts: parsed.contacts,
                links: Array.isArray(parsed.links) ? parsed.links : [],
                touches: Array.isArray(parsed.touches) ? parsed.touches : [],
              }
            : samplePeople()),
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
    interviews: sampleInterviews(),
    ...samplePeople(),
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
    default_model: DEFAULT_MODEL,
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

/**
 * What the pool would know about two of the sample roles, so demo mode shows
 * the posting-health badges: one relisted and open for weeks, one whose
 * closing date has passed.
 */
function demoPostingFacts(): Record<string, PoolPostingFacts> {
  const ago = (d: number) =>
    new Date(Date.now() - d * 86_400_000).toISOString();
  const fact = (role_id: string, f: Partial<PoolPostingFacts>) => ({
    role_id,
    first_seen_at: null,
    posted_at: null,
    expires_at: null,
    listings: 1,
    boards: 1,
    gone_since: null,
    ...f,
  });
  return {
    'r-saltmarsh': fact('r-saltmarsh', {
      first_seen_at: ago(47),
      listings: 3,
      boards: 2,
    }),
    'r-meridian': fact('r-meridian', { expires_at: ago(1) }),
  };
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
  readonly postingFacts =
    signal<Record<string, PoolPostingFacts>>(demoPostingFacts()).asReadonly();

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

  async seenOn(role: RoleRow): Promise<PostingSeenOn[]> {
    return role.source
      ? [{ sourceId: role.source_id ?? '', name: role.source, url: role.url }]
      : [];
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
        company_research: {},
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

  async rescore(id: string): Promise<{
    score: number;
    method: 'heuristic' | 'ai';
    aiError?: string;
  }> {
    void id;
    // Scoring runs in the Edge Function against the live search profile.
    throw new Error(
      'Demo mode cannot score roles. The sample roles come with scores; sign in to score your own.',
    );
  }

  async researchCompany(id: string, opts: { refresh?: boolean } = {}) {
    void opts;
    const role = this.state().roles.find((r) => r.id === id);
    if (!role) throw new Error('Role not found');
    // Demo mode cannot reach other sites: what the posting says only.
    const research = localCompanyResearch({
      company: role.company,
      url: role.url,
      text: role.posting_text,
    });
    research.note =
      'Demo mode reads only the posting. With an Anthropic key connected, the live app searches the web for size, funding, reviews and news.';
    const now = new Date().toISOString();
    this.patch((s) => {
      const r = s.roles.find((x) => x.id === id);
      if (r) r.company_research = research as unknown as Json;
      s.events.push({
        id: newId(),
        user_id: DEMO_USER_ID,
        role_id: id,
        kind: 'generated',
        payload: { what: 'company research', method: 'local' },
        created_at: now,
      });
    });
    return { research, reused: false, shared: false };
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

  /** Demo figures in the shape of a real preview. */
  async previewSearch(roles: string[]) {
    return adminSearchExplain({
      days: 14,
      target_roles: roles,
      search_terms: roles.map((r) => r.toLowerCase()),
      warnings: [],
      pool: 1840,
      not_relevant: 1622,
      too_old: 9,
      needs_country: 0,
      excluded: [
        { reason: 'Open to other countries only', count: 84 },
        { reason: 'Junior or mid-level role', count: 21 },
      ],
      low_score: 31,
      would_file: 73,
      threshold: 30,
      by_grade: { exact: 38, variant: 9, partial: 29, described: 4, stack: 24 },
      by_source: [
        { source: 'himalayas', pool: 640, matched: 41 },
        { source: 'remoteok', pool: 310, matched: 19 },
        { source: 'weworkremotely', pool: 120, matched: 17 },
        { source: 'jobicy', pool: 350, matched: 0 },
      ],
      top: [
        { title: 'Senior Angular Engineer', company: 'Lumenstack', score: 100 },
        { title: 'Senior Frontend Engineer', company: 'Northwind', score: 78 },
        { title: 'Frontend Lead (Angular)', company: 'Kestrel', score: 63 },
      ],
      low: [{ title: 'Web Developer', company: 'Brightside', score: 18 }],
    });
  }

  /** Demo mode has no model: a few well-known jobs, nothing for the rest. */
  async suggestTitles(roles: string[]) {
    const demo: [RegExp, string[]][] = [
      [
        /front[- ]?end|angular|react|ui/i,
        ['UI Engineer', 'Web Developer', 'JavaScript Engineer'],
      ],
      [
        /qa|quality|test/i,
        ['QA Engineer', 'Test Automation Engineer', 'SDET', 'Software Tester'],
      ],
      [/product manager/i, ['Product Owner', 'Product Lead']],
    ];
    return {
      suggestions: titleSuggestions(
        roles.map((role) => {
          const hit = demo.find(([re]) => re.test(role));
          return {
            role,
            known: !!hit,
            titles: hit?.[1] ?? [],
            warning: '',
            source: hit ? ('family' as const) : ('none' as const),
          };
        }),
      ),
      aiNote: 'Demo mode suggests titles for a few sample jobs only.',
    };
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

  async readWithAi(text: string) {
    // No model in demo mode: answer with the built-in reader, loaded lazily.
    const { parseResumeText } = await import('./local-resume-reader');
    const { resume, warnings } = parseResumeText(text);
    return {
      resume,
      warnings: [
        'Demo mode has no model, so this is the built-in reader again.',
        ...warnings,
      ],
    };
  }

  // Kept for the visit only: demo data lives in this browser and a photo
  // would crowd its storage.
  private readonly _photo = signal<string | null>(null);
  readonly photo = this._photo.asReadonly();
  async loadPhoto() {
    /* nothing to fetch in demo mode */
  }
  async savePhoto(data: string) {
    this._photo.set(data);
  }
  async removePhoto() {
    this._photo.set(null);
  }

  async reviewWithAi(sections: ResumeSections) {
    // No model in demo mode: a few rule-based samples show how it works.
    return {
      changes: sampleReview(sections).map((c, i) => ({
        ...c,
        id: `demo-review-${i}`,
        decision: 'pending' as const,
      })),
      model: 'sample, no model in demo mode',
    };
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

  async setTemplate(variantId: string, template: string | null) {
    let out: ResumeVariantRow | undefined;
    this.roles.patch((s) => {
      const v = s.variants.find((x) => x.id === variantId);
      if (!v) return;
      v.template = template;
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
  readonly profile = computed<ProfileRow | null>(() => ({
    // (a demo saved before these columns existed has neither)
    ai_route: 'auto',
    support_access_until: null,
    ...this.roles.snapshot().profileRow,
  }));
  readonly models = signal<ModelChoice[]>([...FALLBACK_MODELS]);
  readonly usage = computed(() => this.roles.snapshot().usage);
  readonly connections = computed<AiConnectionView[]>(() =>
    [...(this.roles.snapshot().connections ?? [])].sort(
      (a, b) => a.position - b.position,
    ),
  );

  async loadUsage(days: number | null): Promise<AiUsageRow[]> {
    void days;
    // Demo calls of its own, plus a month of sample usage to show the page.
    return [...this.roles.snapshot().usage, ...sampleUsage()].sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    );
  }

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
    ai_route?: 'auto' | 'own';
    support_access_until?: string | null;
    resume_template?: string;
  }) {
    this.roles.patch((s) => {
      s.profileRow = {
        ...s.profileRow,
        ...patch,
        updated_at: new Date().toISOString(),
      };
    });
  }

  // The demo keeps no key and calls no provider: a connection here only
  // shows how the screens behave. Drafts are still written locally.
  async saveConnection(input: NewAiConnection) {
    const info = PROVIDERS[input.provider];
    const key = input.key.trim();
    if (!info.keyPattern.test(key))
      throw new Error(
        `That does not look like a ${info.name} API key (expected something like ${info.keyPlaceholder}).`,
      );
    if (info.needsConsent && !input.consent)
      throw new Error(
        `Confirm that you accept ${info.name}'s data terms first.`,
      );
    const model = (input.model ?? '').trim();
    if (model && !MODEL_ID.test(model))
      throw new Error('That is not a valid model name');
    this.roles.patch((s) => {
      const list = (s.connections ??= []);
      const existing = list.find((c) => c.provider === input.provider);
      const values = {
        keyHint: key.slice(-4),
        model,
        status: 'ok' as const,
        lastError: '',
        lastCheckedAt: new Date().toISOString(),
        limitedUntil: null,
      };
      if (existing) Object.assign(existing, values);
      else
        list.push({
          id: `demo-conn-${input.provider}`,
          provider: input.provider,
          position: list.length,
          ...values,
        });
    });
    return 'Demo mode: the key was checked for shape only and not kept. Drafts here are still written locally.';
  }

  async testConnection(id: string) {
    const c = this.connections().find((x) => x.id === id);
    if (!c) throw new Error('Connection not found');
    return 'Demo mode does not call the provider.';
  }

  async checkConnection(id: string): Promise<AiCheck> {
    const c = this.connections().find((x) => x.id === id);
    if (!c) throw new Error('Connection not found');
    const info = PROVIDERS[c.provider];
    const model = c.model || info.defaultModel;
    // Sample results, like the rest of the demo's data.
    return {
      summary:
        'sample result (demo mode does not call the provider): 3 of 4 passed',
      results: [
        {
          job: 'score',
          label: 'Scoring a posting',
          ok: true,
          detail: '',
          model: info.fastModel,
          ms: 900,
        },
        {
          job: 'extract',
          label: 'Reading a posting',
          ok: true,
          detail: '',
          model,
          ms: 1400,
        },
        {
          job: 'tailor',
          label: 'Tailoring a resume',
          ok: false,
          detail: 'Proposed no change Jobbotix could apply to the resume.',
          model,
          ms: 4100,
        },
        {
          job: 'letter',
          label: 'Writing a cover letter',
          ok: true,
          detail: '',
          model,
          ms: 3600,
        },
      ],
    };
  }

  async setConnectionModel(id: string, model: string) {
    if (model && !MODEL_ID.test(model))
      throw new Error('That is not a valid model name');
    this.roles.patch((s) => {
      const c = (s.connections ?? []).find((x) => x.id === id);
      if (c) c.model = model;
    });
    return '';
  }

  async reorderConnections(ids: string[]) {
    this.roles.patch((s) => {
      for (const c of s.connections ?? []) {
        const at = ids.indexOf(c.id);
        if (at >= 0) c.position = at;
      }
    });
  }

  async removeConnection(id: string) {
    this.roles.patch((s) => {
      s.connections = (s.connections ?? [])
        .filter((c) => c.id !== id)
        .sort((a, b) => a.position - b.position)
        .map((c, position) => ({ ...c, position }));
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

/**
 * Demo mode has no backend, so the demo account's plan lives here. It starts
 * open (billing off, every feature on); the admin page's plan actions change
 * it, which lets the Plan card and the upgrade prompts be tried locally.
 */
@Injectable()
export class MemoryPlanRepo extends PlanRepo {
  private readonly state = signal({
    plan: 'free' as 'free' | 'pro',
    credits: 0,
    note: '',
    preview: false,
  });
  readonly entitlements = computed<Entitlements>(() => {
    const s = this.state();
    const pro = s.plan === 'pro';
    return {
      ...OPEN_ENTITLEMENTS,
      enforced: s.preview,
      plan: s.plan,
      planName: pro ? 'Pro' : 'Free',
      status: pro ? 'active' : 'none',
      source: pro ? 'admin' : null,
      features: s.preview && !pro ? ['ai'] : OPEN_ENTITLEMENTS.features,
      limits: s.preview ? { search_profiles: pro ? 5 : 1 } : {},
      monthlyCredits: pro ? 500 : 0,
      credits: s.credits,
    };
  });
  readonly loaded = signal(true).asReadonly();

  // The Pro route in the demo: off until the admin page switches it on.
  // Nothing is ever charged; the screens only show what they would say.
  private readonly roles = inject(MemoryRolesRepo);
  readonly proAi = signal<ProAiAdmin>({
    ...normaliseProAiAdmin(null),
    trialCredits: PRICING.trialCredits,
    dailyCreditCap: 150,
    monthlyBudgetUsd: 50,
    prices: Object.fromEntries(CREDIT_PRICES.map((p) => [p.job, p.credits])),
    models: { fast: 'claude-haiku-5-5', writing: 'claude-sonnet-5-5' },
  });
  readonly route = computed<AiRouteInfo>(() => {
    const cfg = this.proAi();
    if (!cfg.enabled) return NO_AI_ROUTE;
    const s = this.state();
    return {
      enabled: true,
      prices: cfg.prices,
      creditsFirst: s.plan === 'pro',
      ownOnly: this.roles.snapshot().profileRow.ai_route === 'own',
      credits: s.credits,
      dailyLeft: cfg.dailyCreditCap,
    };
  });

  async load() {
    /* nothing to fetch */
  }

  /** The demo account as the admin page lists it. */
  adminPlan(): AdminPlan {
    const s = this.state();
    return {
      ...this.entitlements(),
      id: DEMO_USER_ID,
      note: s.note,
      preview: s.preview,
    };
  }

  patch(
    change: Partial<{
      plan: 'free' | 'pro';
      credits: number;
      note: string;
      preview: boolean;
    }>,
  ) {
    this.state.update((s) => ({ ...s, ...change }));
  }
}

@Injectable()
export class MemoryAdminRepo extends AdminRepo {
  private readonly roles = inject(MemoryRolesRepo);

  async errors(): Promise<AppErrorRow[]> {
    // demo mode reports nothing; show what a grouped report looks like
    const now = new Date().toISOString();
    return [
      {
        id: 'e-demo',
        fingerprint:
          'TypeError: Cannot read properties of undefined (reading #) @ /roles/:id',
        day: now.slice(0, 10),
        user_id: DEMO_USER_ID,
        source: 'web',
        name: 'TypeError',
        message: "Cannot read properties of undefined (reading 'score')",
        stack:
          'TypeError: Cannot read properties of undefined\n    at RoleDetail (role-detail.ts:812)',
        path: '/roles/:id',
        user_agent: 'Demo',
        count: 3,
        first_seen: now,
        last_seen: now,
      },
    ];
  }

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
      has_ai_key: (s.connections ?? []).length > 0,
      ai_providers: (s.connections ?? []).map((c) => c.provider),
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

  private readonly plan = inject(MemoryPlanRepo);

  async proAi() {
    return this.plan.proAi();
  }

  async setProAi(patch: ProAiPatch) {
    const was = this.plan.proAi();
    this.plan.proAi.set({
      ...was,
      enabled: patch.enabled ?? was.enabled,
      monthlyBudgetUsd: patch.monthly_budget_usd ?? was.monthlyBudgetUsd,
      dailyCreditCap: patch.daily_credit_cap ?? was.dailyCreditCap,
    });
    // Switching the route on gives the demo account its trial credits, once.
    if (patch.enabled && !was.enabled && !this.trialGiven) {
      this.trialGiven = true;
      const e = this.plan.entitlements();
      this.plan.patch({ credits: e.credits + was.trialCredits });
    }
    return this.plan.proAi();
  }
  private trialGiven = false;

  async plans() {
    return { enabled: false, users: [this.plan.adminPlan()] };
  }

  async setPlan(userId: string, plan: 'free' | 'pro', reason: string) {
    if (this.samples().some((u) => u.id === userId)) {
      this.samples.update((l) =>
        l.map((u) =>
          u.id === userId
            ? {
                ...u,
                plan,
                plan_name: plan === 'pro' ? 'Pro' : 'Free',
                status: plan === 'pro' ? 'active' : 'none',
              }
            : u,
        ),
      );
      this.record(userId, 'set_plan', { plan, reason });
      return;
    }
    this.plan.patch({ plan, note: reason });
  }

  async addCredits(userId: string, amount: number, reason = '') {
    const sample = this.samples().find((u) => u.id === userId);
    const credits =
      (sample ? sample.credits : this.plan.adminPlan().credits) + amount;
    if (credits < 0) throw new Error('That would take the balance below zero');
    if (sample) {
      this.samples.update((l) =>
        l.map((u) => (u.id === userId ? { ...u, credits } : u)),
      );
      this.record(userId, 'add_credits', { credits: amount, reason });
    } else this.plan.patch({ credits });
    return credits;
  }

  async setBillingPreview(_userId: string, on: boolean) {
    this.plan.patch({ preview: on });
  }

  // --- the admin console, on the demo account and two made-up ones ---------
  private readonly samples = signal<AdminUserRow[]>(
    [
      {
        id: 'demo-user-sam',
        email: 'sam@example.com',
        name: 'Sam Okafor',
        created_at: new Date(Date.now() - 21 * 86_400_000).toISOString(),
        plan: 'pro',
        plan_name: 'Pro',
        status: 'active',
        credits: 312,
        route: 'credits',
        providers: [],
        roles: 38,
        ai_calls_30d: 141,
        last_active: new Date(Date.now() - 86_400_000).toISOString(),
        support_access: true,
      },
      {
        id: 'demo-user-lee',
        email: 'lee@example.com',
        name: 'Lee Tran',
        created_at: new Date(Date.now() - 6 * 86_400_000).toISOString(),
        plan: 'free',
        plan_name: 'Free',
        status: 'none',
        credits: 20,
        route: 'own',
        providers: ['gemini'],
        roles: 9,
        ai_calls_30d: 17,
        last_active: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      },
    ].map(adminUserRow),
  );
  private readonly trail = signal<
    Record<string, AdminUserDetail['activity']['audit']>
  >({});

  private record(userId: string, action: string, detail = {}) {
    this.trail.update((t) => ({
      ...t,
      [userId]: [
        {
          action,
          admin_email: this.roles.snapshot().profileRow.email,
          detail,
          created_at: new Date().toISOString(),
        },
        ...(t[userId] ?? []),
      ],
    }));
  }

  private allUsers(): AdminUserRow[] {
    const s = this.roles.snapshot();
    const e = this.plan.entitlements();
    const connections = s.connections ?? [];
    const me = adminUserRow({
      id: s.profileRow.id,
      email: s.profileRow.email,
      name: s.profileRow.name,
      created_at: s.profileRow.created_at,
      is_admin: true,
      plan: e.plan,
      plan_name: e.planName,
      status: e.status,
      credits: e.credits,
      route:
        this.plan.proAi().enabled && e.plan !== 'free'
          ? 'credits'
          : connections.length
            ? 'own'
            : 'none',
      providers: connections.map((c) => c.provider),
      roles: s.roles.length,
      ai_calls_30d: s.usage.length,
      last_active: s.roles[0]?.status_changed_at ?? null,
      support_access:
        !!s.profileRow.support_access_until &&
        Date.parse(s.profileRow.support_access_until) > Date.now(),
    });
    return [me, ...this.samples()];
  }

  private matching(f: AdminUserFilters): AdminUserRow[] {
    const q = (f.q ?? '').trim().toLowerCase();
    return this.allUsers().filter(
      (u) =>
        (!q ||
          u.email.toLowerCase().includes(q) ||
          u.name.toLowerCase().includes(q)) &&
        (!f.plan || u.plan === f.plan) &&
        (!f.route || u.route === f.route),
    );
  }

  async users(filters: AdminUserFilters) {
    const all = this.matching(filters);
    const offset = filters.offset ?? 0;
    return {
      total: all.length,
      users: all.slice(offset, offset + (filters.limit ?? 50)),
    };
  }

  async exportUsers(filters: AdminUserFilters) {
    return this.matching(filters);
  }

  async user(id: string): Promise<AdminUserDetail | null> {
    const row = this.allUsers().find((u) => u.id === id);
    if (!row) return null;
    this.record(id, 'view_user');
    const s = this.roles.snapshot();
    const mine = id === s.profileRow.id;
    const byStatus: Record<string, number> = {};
    for (const r of mine ? s.roles : [])
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    return adminUserDetail({
      account: {
        ...row,
        timezone: mine ? s.profileRow.timezone : 'Europe/Lisbon',
        suspended_at: row.suspended ? new Date().toISOString() : null,
        suspended_reason: row.suspended ? 'Suspended in the demo' : '',
        support_access_until: row.support_access
          ? new Date(Date.now() + 5 * 86_400_000).toISOString()
          : null,
        has_resume: true,
        has_search_profile: true,
        ingest_keys: mine ? s.ingestKeys.length : 0,
      },
      auth: {
        last_sign_in_at: row.last_active,
        email_confirmed_at: row.created_at,
      },
      billing: {
        entitlements: {
          plan: row.plan,
          plan_name: row.plan_name,
          status: row.status,
          source: row.plan === 'pro' ? 'admin' : null,
          features: ['ai'],
          credits: row.credits,
          monthly_credits: row.plan === 'pro' ? 500 : 0,
        },
        subscription:
          row.plan === 'pro'
            ? {
                plan: 'pro',
                status: 'active',
                source: 'admin',
                note: 'Demo grant',
              }
            : null,
        payments: [],
        ledger: row.credits
          ? [
              {
                delta: row.credits,
                kind: row.plan === 'pro' ? 'admin' : 'trial',
                reason: row.plan === 'pro' ? 'Demo grant' : 'Trial credits',
                created_at: row.created_at,
              },
            ]
          : [],
      },
      ai: {
        connections: row.providers.map((provider) => ({
          provider,
          model: '',
          status: 'ok',
        })),
        month: row.ai_calls_30d
          ? [
              {
                job: 'score',
                provider:
                  row.route === 'own'
                    ? (row.providers[0] ?? 'anthropic')
                    : 'anthropic',
                model:
                  row.route === 'own'
                    ? 'gemini-3.5-flash-lite'
                    : 'claude-haiku-5-5',
                route: row.route === 'credits' ? 'platform' : 'own',
                calls: row.ai_calls_30d,
                tokens_in: row.ai_calls_30d * 1500,
                tokens_out: row.ai_calls_30d * 250,
                cost_usd:
                  row.route === 'credits' ? row.ai_calls_30d * 0.0003 : 0,
              },
            ]
          : [],
        trend: [],
        credits_spent_month: row.route === 'credits' ? 188 : 0,
        platform_cost_month: row.route === 'credits' ? 2.31 : 0,
      },
      activity: {
        roles_by_status: mine ? byStatus : { new: row.roles },
        last_run: new Date().toISOString(),
        runs_30d: 30,
        events_30d: { run: 30, status_change: row.roles },
        audit: this.trail()[id] ?? [],
      },
      content: row.support_access
        ? {
            roles: (mine ? s.roles : sampleRoles()).slice(0, 8).map((r) => ({
              company: r.company,
              title: r.title,
              status: r.status,
              score: r.score,
              found_at: r.found_at,
            })),
            resume: null,
          }
        : null,
    });
  }

  async money() {
    return adminMoney({
      revenue_month_usd: 0,
      revenue_last_month_usd: 0,
      active_granted: this.allUsers().filter((u) => u.plan === 'pro').length,
      ai_spend_month_usd: this.plan.proAi().enabled ? 2.31 : 0,
      over_cost: this.plan.proAi().enabled
        ? [
            {
              id: 'demo-user-sam',
              email: 'sam@example.com',
              cost_usd: 2.31,
              paid_usd: 0,
            },
          ]
        : [],
    });
  }

  private sample(userId: string, what: string): AdminUserRow {
    const u = this.samples().find((x) => x.id === userId);
    if (!u) throw new Error(`You cannot ${what} your own account.`);
    return u;
  }

  async suspend(userId: string, reason: string) {
    this.sample(userId, 'suspend');
    this.samples.update((l) =>
      l.map((u) => (u.id === userId ? { ...u, suspended: true } : u)),
    );
    this.record(userId, 'suspend', { reason });
  }

  async unsuspend(userId: string) {
    this.samples.update((l) =>
      l.map((u) => (u.id === userId ? { ...u, suspended: false } : u)),
    );
    this.record(userId, 'unsuspend');
  }

  async sendLoginLink(userId: string) {
    this.record(userId, 'send_login_link');
  }

  /** Demo figures: the shape of a real answer, for the sample accounts. */
  async explainSearch(userId: string, days = 14) {
    this.record(userId, 'explain_search');
    return adminSearchExplain({
      days,
      target_roles: ['Senior Angular Developer', 'Senior Frontend Engineer'],
      search_terms: ['angular', 'frontend'],
      warnings: [],
      pool: 1840,
      not_relevant: 1622,
      too_old: 9,
      needs_country: 0,
      excluded: [
        { reason: 'Open to other countries only', count: 84 },
        { reason: 'Junior or mid-level role', count: 21 },
        { reason: 'Hybrid role', count: 12 },
      ],
      low_score: 31,
      would_file: 61,
      threshold: 30,
      by_grade: { exact: 38, variant: 9, partial: 29, described: 4, stack: 12 },
      by_source: [
        { source: 'himalayas', pool: 640, matched: 41 },
        { source: 'remoteok', pool: 310, matched: 19 },
        { source: 'weworkremotely', pool: 120, matched: 17 },
        { source: 'ats', pool: 420, matched: 11 },
        { source: 'jobicy', pool: 350, matched: 4 },
      ],
      top: [
        { title: 'Senior Angular Engineer', company: 'Lumenstack', score: 100 },
        { title: 'Senior Frontend Engineer', company: 'Northwind', score: 78 },
        { title: 'Frontend Lead (Angular)', company: 'Kestrel', score: 63 },
      ],
      low: [{ title: 'Web Developer', company: 'Brightside', score: 18 }],
    });
  }

  async deleteUser(userId: string, confirmEmail: string) {
    const u = this.sample(userId, 'delete');
    if (confirmEmail.trim().toLowerCase() !== u.email.toLowerCase())
      throw new Error(
        "Type the account's email address to confirm the deletion.",
      );
    this.samples.update((l) => l.filter((x) => x.id !== userId));
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

@Injectable()
export class MemorySourcesRepo extends SourcesRepo {
  /** Demo: the real catalogue's shape, with made-up health. */
  async list(): Promise<SourceCatalogRow[]> {
    return sampleSources();
  }
}

@Injectable()
export class MemoryWatchlistRepo extends WatchlistRepo {
  private list: FollowedCompany[] = sampleFollows();

  async followed() {
    return [...this.list];
  }

  async follow(kind: AtsKind, slug: string, name: string) {
    if (
      this.list.some(
        (f) => f.company.ats_kind === kind && f.company.ats_slug === slug,
      )
    )
      return;
    this.list = [
      {
        company: {
          id: `demo-${kind}-${slug}`,
          ats_kind: kind,
          ats_slug: slug,
          name,
          first_seen_at: new Date().toISOString(),
          last_polled_at: null,
          last_error: null,
          open_roles: 0,
        },
        followedAt: new Date().toISOString(),
      },
      ...this.list,
    ];
  }

  async unfollow(companyId: string) {
    this.list = this.list.filter((f) => f.company.id !== companyId);
  }

  async companyFor(role: RoleRow) {
    // Demo links point at example.com, so pretend every demo company hires
    // on Greenhouse to show the follow control.
    const found = careersSystem(role.url) ?? {
      kind: 'greenhouse' as const,
      slug: role.company
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
    };
    return found.slug ? { ...found, name: role.company } : null;
  }
}

@Injectable()
export class MemoryInterviewsRepo extends InterviewsRepo {
  private readonly roles = inject(MemoryRolesRepo);
  readonly interviews = computed(() =>
    [...this.roles.snapshot().interviews].sort((a, b) =>
      (a.scheduled_at ?? '9999').localeCompare(b.scheduled_at ?? '9999'),
    ),
  );
  readonly loaded = signal(true);

  async load() {
    /* nothing to fetch */
  }

  async save(id: string | null, input: InterviewInput) {
    const now = new Date().toISOString();
    let saved: InterviewRow | undefined;
    if (id) {
      this.roles.patch((s) => {
        const row = s.interviews.find((i) => i.id === id);
        if (row) {
          Object.assign(row, input, { updated_at: now });
          saved = { ...row };
        }
      });
      if (!saved) throw new Error('Interview not found');
      return saved;
    }
    if (!input.role_id) throw new Error('Pick a role first');
    const row: InterviewRow = {
      id: crypto.randomUUID(),
      user_id: DEMO_USER_ID,
      role_id: input.role_id,
      kind: 'screen',
      title: '',
      scheduled_at: null,
      duration_min: 45,
      location: '',
      interviewers: '',
      status: 'scheduled',
      outcome: '',
      notes: '',
      debrief: '',
      thank_you: '',
      thank_you_sent_at: null,
      ...input,
      created_at: now,
      updated_at: now,
    };
    this.roles.patch((s) => s.interviews.push(row));
    // what the database trigger does: an early-pipeline role moves to Interview
    const role = this.roles.roles().find((r) => r.id === row.role_id);
    if (role && ['new', 'shortlist', 'applied'].includes(role.status))
      await this.roles.setStatus(role.id, 'interview');
    return row;
  }

  async remove(id: string) {
    this.roles.patch((s) => {
      s.interviews = s.interviews.filter((i) => i.id !== id);
    });
  }

  async draftThankYou(id: string): Promise<LetterResult> {
    const st = this.roles.snapshot();
    const iv = st.interviews.find((i) => i.id === id);
    const role = iv && st.roles.find((r) => r.id === iv.role_id);
    if (!iv || !role) throw new Error('Interview not found');
    const master = st.resumes.find((r) => r.is_master);
    const body = localThankYou({
      candidate: master ? normaliseResume(master.sections).contact.name : '',
      company: role.company,
      roleTitle: role.title,
      kind: iv.kind,
      interviewers: iv.interviewers,
      debrief: iv.debrief,
    });
    await this.save(id, { thank_you: body });
    return { body, method: 'local' };
  }
}

@Injectable()
export class MemoryPeopleRepo extends PeopleRepo {
  private readonly roles = inject(MemoryRolesRepo);
  readonly contacts = computed(() =>
    [...this.roles.snapshot().contacts].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
  );
  readonly links = computed(() => this.roles.snapshot().links);
  readonly loaded = signal(true);

  async load() {
    /* nothing to fetch */
  }

  async save(id: string | null, input: ContactInput) {
    const now = new Date().toISOString();
    if (id) {
      let saved: ContactRow | undefined;
      this.roles.patch((s) => {
        const row = s.contacts.find((c) => c.id === id);
        if (row) {
          Object.assign(row, input, { updated_at: now });
          saved = { ...row };
        }
      });
      if (!saved) throw new Error('Person not found');
      return saved;
    }
    if (!input.name?.trim()) throw new Error('Add a name');
    const row: ContactRow = {
      id: crypto.randomUUID(),
      user_id: DEMO_USER_ID,
      name: '',
      company: '',
      title: '',
      relation: 'other',
      email: '',
      linkedin_url: '',
      notes: '',
      next_touch_on: null,
      last_touch_at: null,
      ...input,
      created_at: now,
      updated_at: now,
    } as ContactRow;
    this.roles.patch((s) => s.contacts.push(row));
    return row;
  }

  async remove(id: string) {
    this.roles.patch((s) => {
      s.contacts = s.contacts.filter((c) => c.id !== id);
      s.links = s.links.filter((l) => l.contact_id !== id);
      s.touches = s.touches.filter((t) => t.contact_id !== id);
    });
  }

  async link(roleId: string, contactId: string) {
    this.roles.patch((s) => {
      if (
        !s.links.some((l) => l.role_id === roleId && l.contact_id === contactId)
      )
        s.links.push({
          role_id: roleId,
          contact_id: contactId,
          user_id: DEMO_USER_ID,
          created_at: new Date().toISOString(),
        });
    });
  }

  async unlink(roleId: string, contactId: string) {
    this.roles.patch((s) => {
      s.links = s.links.filter(
        (l) => !(l.role_id === roleId && l.contact_id === contactId),
      );
    });
  }

  async touches(contactId: string) {
    return this.roles
      .snapshot()
      .touches.filter((t) => t.contact_id === contactId)
      .sort((a, b) => b.at.localeCompare(a.at));
  }

  async logTouch(input: TouchInput, nextTouchOn?: string | null) {
    const now = new Date().toISOString();
    const at = input.at ?? now;
    this.roles.patch((s) => {
      s.touches.push({
        id: crypto.randomUUID(),
        user_id: DEMO_USER_ID,
        contact_id: input.contact_id,
        role_id: input.role_id ?? null,
        at,
        channel: input.channel,
        direction: input.direction,
        note: input.note ?? '',
        created_at: now,
      });
      const c = s.contacts.find((x) => x.id === input.contact_id);
      if (c) {
        if (!c.last_touch_at || c.last_touch_at < at) c.last_touch_at = at;
        if (nextTouchOn !== undefined) c.next_touch_on = nextTouchOn;
        c.updated_at = now;
      }
    });
  }

  async draftMessage(req: MessageRequest): Promise<LetterResult> {
    const st = this.roles.snapshot();
    const c = st.contacts.find((x) => x.id === req.contactId);
    if (!c) throw new Error('Person not found');
    const role = req.roleId ? st.roles.find((r) => r.id === req.roleId) : null;
    const master = st.resumes.find((r) => r.is_master);
    const resume = master ? normaliseResume(master.sections) : null;
    const body = localMessage({
      kind: req.kind,
      candidate: resume?.contact.name ?? '',
      headline: resume?.contact.headline ?? '',
      contact: c,
      role: role
        ? { title: role.title, company: role.company, url: role.url }
        : null,
      incoming: req.incoming,
      ask: req.ask,
    });
    return { body, method: 'local' };
  }
}

@Injectable()
export class MemoryAccountDataRepo extends AccountDataRepo {
  private readonly roles = inject(MemoryRolesRepo);

  async exportAll() {
    const s = this.roles.snapshot();
    return {
      profiles: [s.profileRow],
      search_profiles: [s.profile],
      roles: s.roles,
      role_events: s.events,
      interviews: s.interviews,
      contacts: s.contacts,
      role_contacts: s.links,
      contact_touches: s.touches,
      screening_answers: s.answers,
      cover_letters: s.voiceSamples,
      resumes: s.resumes,
      resume_variants: s.variants,
      saved_views: s.views,
      shares: s.shares,
      ai_usage: s.usage,
    } as Record<string, unknown[]>;
  }

  async importRoles(list: ImportRoleInput[]) {
    let added = 0;
    let duplicates = 0;
    this.roles.patch((s) => {
      const urls = new Set(s.roles.map((r) => r.url.toLowerCase()));
      const pairs = new Set(
        s.roles.map((r) => `${r.company}|${r.title}`.toLowerCase()),
      );
      const now = new Date().toISOString();
      for (const r of list) {
        const pair = `${r.company}|${r.title}`.toLowerCase();
        if (urls.has(r.url.toLowerCase()) || pairs.has(pair)) {
          duplicates++;
          continue;
        }
        urls.add(r.url.toLowerCase());
        pairs.add(pair);
        s.roles.push({
          ...s.roles[0],
          ...blankRole(),
          ...r,
          id: newId(),
          user_id: DEMO_USER_ID,
          source: 'Imported',
          found_at: now,
          status_changed_at: now,
          created_at: now,
          updated_at: now,
        });
        added++;
      }
    });
    return { added, duplicates, failed: 0 };
  }

  async deleteAccount() {
    // demo mode: start over from the samples
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* nothing stored */
    }
    location.assign('/');
  }
}

/** The fields a role has before anything is known about it. */
function blankRole(): Partial<RoleRow> {
  return {
    remote_scope: '',
    type: 'full_time',
    posted_at: null,
    stack: [],
    score: 0,
    score_breakdown: {},
    reasons: [],
    gaps: [],
    ai_match: false,
    cover_letter: '',
    posting_text: '',
    posting_hash: '',
    follow_up_days: 0,
    prep: {},
    posting_id: null,
    source_id: null,
    remote_policy: 'unknown',
    hiring_countries: [],
  };
}
