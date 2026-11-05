import { Injectable, computed, inject, signal } from '@angular/core';
import type {
  Json,
  RoleEventRow,
  RoleRow,
  RoleStatus,
  RunSummary,
  SavedViewRow,
  ScreeningAnswerRow,
  SearchProfileRow,
} from '@jobbotix/shared-types';
import {
  RolesRepo,
  SavedViewsRepo,
  SearchProfileInput,
  SearchProfileRepo,
} from './repos';
import {
  DEMO_USER_ID,
  sampleEvents,
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
  };
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
