import { Injectable, computed, inject, signal } from '@angular/core';
import {
  applyVariant,
  heuristicExtract,
  keywordReport,
  localTailor,
  normaliseResume,
  type VariantDiff,
} from '@jobbotix/shared-types';
import type {
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
  ResumesRepo,
  RolesRepo,
  SavedViewsRepo,
  VariantsRepo,
  SearchProfileInput,
  SearchProfileRepo,
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
  readonly lastRun = computed<RunSummary | null>(() => {
    const run = this.state()
      .events.filter((e) => e.kind === 'run')
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (!run) return null;
    const p = run.payload as Record<string, number | string>;
    return {
      at: String(p['at'] ?? run.created_at),
      searched: Number(p['searched'] ?? 0),
      added: Number(p['added'] ?? 0),
      excluded: Number(p['excluded'] ?? 0),
    };
  });
  readonly reminders = computed(() =>
    this.state().events.filter((e) => e.kind === 'reminder'),
  );

  async load() {
    /* nothing to fetch */
  }

  async setStatus(id: string, status: RoleStatus) {
    this.patch((s) => {
      const role = s.roles.find((r) => r.id === id);
      if (!role || role.status === status) return;
      const now = new Date().toISOString();
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
    void label;
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return (
      'jbx_demo_' +
      Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    );
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

  async generate(roleId: string) {
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
