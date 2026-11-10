import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  INTERVIEW_KINDS,
  INTERVIEW_KIND_LABELS,
  INTERVIEW_OUTCOME_LABELS,
  calendarEvent,
  formatInterviewTime,
  googleCalendarUrl,
  interviewLabel,
  toIcs,
  type InterviewKind,
  type InterviewOutcome,
  type InterviewRow,
  type RoleRow,
} from '@jobbotix/shared-types';
import { InterviewsRepo } from '../../core/data/repos';
import { ModelPicker } from '../../shared/model-picker';
import { Toast } from '../../shared/toast';
import {
  Button,
  Confirm,
  CopyButton,
  EmptyState,
  Field,
  FieldControl,
  Icon,
  Sheet,
} from '../../ui';

interface Draft {
  kind: InterviewKind;
  title: string;
  /** datetime-local value, in the browser's time zone */
  when: string;
  duration_min: number;
  location: string;
  interviewers: string;
  notes: string;
}

const EMPTY: Draft = {
  kind: 'screen',
  title: '',
  when: '',
  duration_min: 45,
  location: '',
  interviewers: '',
  notes: '',
};

/** "2026-11-12T14:00" in local time, from an ISO timestamp. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** The Interviews tab: rounds with times, calendar files, debriefs and thank-you notes. */
@Component({
  selector: 'jb-interviews-panel',
  imports: [
    Button,
    CopyButton,
    EmptyState,
    Field,
    FieldControl,
    Icon,
    ModelPicker,
    Sheet,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="flex flex-col gap-5">
      @if (rounds().length) {
        <div class="flex flex-wrap items-center justify-between gap-3">
          <p class="text-sm text-ink-muted">
            {{ rounds().length }}
            {{ rounds().length === 1 ? 'round' : 'rounds' }}; times in
            {{ zone }}.
          </p>
          <button type="button" jbButton (click)="openNew()">
            <jb-icon name="plus" /> Add round
          </button>
        </div>
        <ol class="flex flex-col gap-4">
          @for (iv of rounds(); track iv.id) {
            <li class="jb-card p-5 md:p-6">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <h3 class="font-semibold text-ink">{{ label(iv) }}</h3>
                  <p
                    class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted"
                  >
                    <span class="inline-flex items-center gap-1.5">
                      <jb-icon name="calendar" [size]="15" />
                      {{
                        iv.scheduled_at ? when(iv.scheduled_at) : 'No time set'
                      }}
                      @if (iv.scheduled_at) {
                        · {{ iv.duration_min }} min
                      }
                    </span>
                    @if (iv.interviewers) {
                      <span class="inline-flex items-center gap-1.5">
                        <jb-icon name="users" [size]="15" />{{
                          iv.interviewers
                        }}
                      </span>
                    }
                  </p>
                  @if (iv.location) {
                    <p class="mt-1 text-sm wrap-anywhere">
                      @if (isLink(iv.location)) {
                        <a
                          class="inline-flex items-center gap-1.5 text-brand-ink underline decoration-line underline-offset-2"
                          [href]="iv.location"
                          target="_blank"
                          rel="noopener"
                          ><jb-icon name="link" [size]="15" />Join link</a
                        >
                      } @else {
                        <span class="text-ink-muted">{{ iv.location }}</span>
                      }
                    </p>
                  }
                </div>
                <span
                  class="jb-tag shrink-0"
                  [class.jb-tag-ai]="phase(iv) === 'upcoming'"
                  [class.jb-tag-bad]="iv.status === 'cancelled'"
                  >{{ phaseLabel(iv) }}</span
                >
              </div>

              @if (iv.notes) {
                <p class="mt-3 text-sm whitespace-pre-line text-ink">
                  {{ iv.notes }}
                </p>
              }

              <div class="mt-4 flex flex-wrap items-center gap-2">
                @if (iv.scheduled_at && iv.status !== 'cancelled') {
                  <button
                    type="button"
                    jbButton
                    size="sm"
                    (click)="downloadIcs(iv)"
                  >
                    <jb-icon name="download" [size]="16" /> Calendar file
                  </button>
                  <a
                    jbButton
                    size="sm"
                    [href]="gcal(iv)"
                    target="_blank"
                    rel="noopener"
                  >
                    Google Calendar
                    <jb-icon name="arrow-up-right" [size]="16" />
                  </a>
                }
                @if (phase(iv) === 'ended' && iv.status === 'scheduled') {
                  <button
                    type="button"
                    jbButton
                    size="sm"
                    (click)="patch(iv, { status: 'done' })"
                  >
                    <jb-icon name="check" [size]="16" /> Mark done
                  </button>
                }
                <button
                  type="button"
                  jbButton="ghost"
                  size="sm"
                  (click)="openEdit(iv)"
                >
                  <jb-icon name="pencil" [size]="16" /> Edit
                </button>
                <button
                  type="button"
                  jbButton="ghost"
                  size="sm"
                  iconOnly
                  [attr.aria-label]="'Delete ' + label(iv)"
                  title="Delete"
                  (click)="remove(iv)"
                >
                  <jb-icon name="trash" [size]="16" />
                </button>
              </div>

              @if (phase(iv) !== 'upcoming' && iv.status !== 'cancelled') {
                <div
                  class="mt-5 grid gap-5 border-t border-line pt-5 lg:grid-cols-2"
                >
                  <div class="flex flex-col gap-2">
                    <div class="flex items-center justify-between gap-2">
                      <label
                        class="text-sm font-semibold text-ink"
                        [for]="'debrief-' + iv.id"
                        >Debrief</label
                      >
                      <span class="text-xs text-ink-faint" role="status">{{
                        saving()[iv.id + ':debrief']
                      }}</span>
                    </div>
                    <textarea
                      jbInput
                      [autogrow]="true"
                      rows="5"
                      class="text-sm"
                      [id]="'debrief-' + iv.id"
                      placeholder="What they asked, what went well, what to fix next time, what they said about next steps"
                      [value]="iv.debrief"
                      (input)="typed(iv, 'debrief', $any($event.target).value)"
                    ></textarea>
                    <label class="mt-1 flex items-center gap-2 text-sm">
                      Outcome
                      <select
                        jbInput
                        class="jb-input-inline w-auto"
                        [value]="iv.outcome"
                        (change)="
                          patch(iv, { outcome: $any($event.target).value })
                        "
                      >
                        @for (o of outcomes; track o) {
                          <option [value]="o" [selected]="o === iv.outcome">
                            {{ outcomeLabels[o] }}
                          </option>
                        }
                      </select>
                    </label>
                  </div>

                  <div class="flex flex-col gap-2">
                    <div class="flex items-center justify-between gap-2">
                      <label
                        class="text-sm font-semibold text-ink"
                        [for]="'thanks-' + iv.id"
                        >Thank-you note</label
                      >
                      <span class="text-xs text-ink-faint" role="status">{{
                        iv.thank_you_sent_at
                          ? 'Sent'
                          : saving()[iv.id + ':thank_you']
                      }}</span>
                    </div>
                    @if (iv.thank_you) {
                      <textarea
                        jbInput
                        [autogrow]="true"
                        rows="6"
                        class="text-sm"
                        [id]="'thanks-' + iv.id"
                        [value]="iv.thank_you"
                        (input)="
                          typed(iv, 'thank_you', $any($event.target).value)
                        "
                      ></textarea>
                      <div class="flex flex-wrap items-center gap-2">
                        <jb-copy-button size="sm" [text]="iv.thank_you" />
                        @if (!iv.thank_you_sent_at) {
                          <button
                            type="button"
                            jbButton="ghost"
                            size="sm"
                            (click)="patch(iv, { thank_you_sent_at: now() })"
                          >
                            <jb-icon name="send" [size]="16" /> Mark sent
                          </button>
                        }
                        <button
                          type="button"
                          jbButton="ghost"
                          size="sm"
                          [busy]="drafting() === iv.id"
                          [disabled]="!!drafting()"
                          (click)="draft(iv)"
                        >
                          <jb-icon name="rotate-cw" [size]="16" /> Redraft
                        </button>
                      </div>
                    } @else {
                      <p
                        class="text-sm text-ink-muted"
                        [id]="'thanks-' + iv.id"
                      >
                        Send one within a day. Write the debrief first and the
                        draft can mention something you discussed.
                      </p>
                      <div class="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          jbButton="primary"
                          size="sm"
                          [busy]="drafting() === iv.id"
                          [disabled]="!!drafting()"
                          (click)="draft(iv)"
                        >
                          <jb-icon name="sparkles" [size]="16" /> Draft note
                        </button>
                        <jb-model-picker [(value)]="model" job="thank_you" />
                      </div>
                    }
                  </div>
                </div>
              }
            </li>
          }
        </ol>
      } @else {
        <jb-empty-state title="No interview rounds yet" icon="calendar">
          Add each round as it is booked: Jobbotix shows it on Today and in your
          morning email, gives you a calendar file, and keeps your debrief and
          thank-you note with it.
          <div actions>
            <button type="button" jbButton="primary" (click)="openNew()">
              <jb-icon name="plus" /> Add round
            </button>
          </div>
        </jb-empty-state>
      }
    </div>

    <jb-sheet
      [(open)]="formOpen"
      [title]="editing() ? 'Edit round' : 'Add a round'"
    >
      <form
        id="iv-form"
        class="flex flex-col gap-4"
        (submit)="$event.preventDefault(); submit()"
      >
        <jb-field label="Kind">
          <select
            jbInput
            id="iv-kind"
            [value]="form().kind"
            (change)="set('kind', $any($event.target).value)"
          >
            @for (k of kinds; track k) {
              <option [value]="k" [selected]="k === form().kind">
                {{ kindLabels[k] }}
              </option>
            }
          </select>
        </jb-field>
        <jb-field
          label="Name"
          [optional]="true"
          hint="Your own label, such as “Pairing with the CTO”"
        >
          <input
            jbInput
            id="iv-title"
            maxlength="120"
            [value]="form().title"
            (input)="set('title', $any($event.target).value)"
          />
        </jb-field>
        <div class="grid grid-cols-[1fr_7rem] gap-3">
          <jb-field
            label="When"
            [optional]="true"
            [hint]="'Your time (' + zone + ')'"
          >
            <input
              jbInput
              id="iv-when"
              type="datetime-local"
              [value]="form().when"
              (input)="set('when', $any($event.target).value)"
            />
          </jb-field>
          <jb-field label="Minutes">
            <input
              jbInput
              id="iv-duration"
              type="number"
              min="5"
              max="600"
              step="5"
              [value]="form().duration_min"
              (input)="set('duration_min', +$any($event.target).value)"
            />
          </jb-field>
        </div>
        <jb-field
          label="Where"
          [optional]="true"
          hint="A meeting link, a phone number or an address"
        >
          <input
            jbInput
            id="iv-location"
            maxlength="1000"
            [value]="form().location"
            (input)="set('location', $any($event.target).value)"
          />
        </jb-field>
        <jb-field
          label="With"
          [optional]="true"
          hint="Names and roles, separated by commas"
        >
          <input
            jbInput
            id="iv-people"
            maxlength="500"
            [value]="form().interviewers"
            (input)="set('interviewers', $any($event.target).value)"
          />
        </jb-field>
        <jb-field
          label="Notes"
          [optional]="true"
          hint="What to prepare or bring up"
        >
          <textarea
            jbInput
            id="iv-notes"
            rows="3"
            [value]="form().notes"
            (input)="set('notes', $any($event.target).value)"
          ></textarea>
        </jb-field>
        @if (editing(); as e) {
          <label class="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              [checked]="e.status === 'cancelled'"
              (change)="cancelled.set($any($event.target).checked)"
            />
            This round was cancelled
          </label>
        }
      </form>
      <div footer class="flex justify-end gap-2">
        <button type="button" jbButton="ghost" (click)="formOpen.set(false)">
          Cancel
        </button>
        <button
          type="submit"
          form="iv-form"
          jbButton="primary"
          [busy]="busy()"
          [disabled]="busy()"
        >
          {{ editing() ? 'Save' : 'Add round' }}
        </button>
      </div>
    </jb-sheet>
  `,
})
export class InterviewsPanel {
  private readonly repo = inject(InterviewsRepo);
  private readonly toast = inject(Toast);
  private readonly confirm = inject(Confirm);
  readonly role = input.required<RoleRow>();

  readonly kinds = INTERVIEW_KINDS;
  readonly kindLabels = INTERVIEW_KIND_LABELS;
  readonly outcomes = Object.keys(
    INTERVIEW_OUTCOME_LABELS,
  ) as InterviewOutcome[];
  readonly outcomeLabels = INTERVIEW_OUTCOME_LABELS;
  readonly zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  readonly label = interviewLabel;

  readonly rounds = computed(() =>
    this.repo
      .interviews()
      .filter((i) => i.role_id === this.role().id)
      .sort((a, b) =>
        (a.scheduled_at ?? '9999').localeCompare(b.scheduled_at ?? '9999'),
      ),
  );

  readonly formOpen = signal(false);
  readonly editing = signal<InterviewRow | null>(null);
  readonly form = signal<Draft>({ ...EMPTY });
  readonly cancelled = signal(false);
  readonly busy = signal(false);
  readonly drafting = signal<string | null>(null);
  readonly model = signal('');
  /** "Saving…" / "Saved" per round and field. */
  readonly saving = signal<Record<string, string>>({});
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor() {
    if (!this.repo.loaded()) void this.repo.load().catch(() => undefined);
  }

  now() {
    return new Date().toISOString();
  }

  when(iso: string) {
    return formatInterviewTime(iso, this.zone);
  }

  isLink(s: string) {
    return /^https?:\/\//i.test(s.trim());
  }

  phase(iv: InterviewRow): 'upcoming' | 'ended' | 'undated' {
    if (!iv.scheduled_at) return iv.status === 'done' ? 'ended' : 'undated';
    const end = Date.parse(iv.scheduled_at) + iv.duration_min * 60_000;
    return iv.status === 'done' || end <= Date.now() ? 'ended' : 'upcoming';
  }

  phaseLabel(iv: InterviewRow) {
    if (iv.status === 'cancelled') return 'Cancelled';
    if (iv.outcome) return this.outcomeLabels[iv.outcome];
    const p = this.phase(iv);
    if (p === 'upcoming') return 'Upcoming';
    if (p === 'undated') return 'Not booked';
    return iv.status === 'done' ? 'Done' : 'Ended';
  }

  gcal(iv: InterviewRow) {
    const e = calendarEvent(iv, this.role(), location.origin);
    return e ? googleCalendarUrl(e) : '';
  }

  downloadIcs(iv: InterviewRow) {
    const e = calendarEvent(iv, this.role(), location.origin);
    if (!e) return;
    const blob = new Blob([toIcs(e)], { type: 'text/calendar;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download =
      `${this.role().company.replace(/[^\w-]+/g, '-')}-${iv.kind}.ics`.toLowerCase();
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  set<K extends keyof Draft>(key: K, value: Draft[K]) {
    this.form.update((f) => ({ ...f, [key]: value }));
  }

  openNew() {
    this.editing.set(null);
    const n = this.rounds().length;
    this.form.set({ ...EMPTY, kind: n === 0 ? 'screen' : 'technical' });
    this.formOpen.set(true);
  }

  openEdit(iv: InterviewRow) {
    this.editing.set(iv);
    this.cancelled.set(iv.status === 'cancelled');
    this.form.set({
      kind: iv.kind,
      title: iv.title,
      when: toLocalInput(iv.scheduled_at),
      duration_min: iv.duration_min,
      location: iv.location,
      interviewers: iv.interviewers,
      notes: iv.notes,
    });
    this.formOpen.set(true);
  }

  async submit() {
    const f = this.form();
    const editing = this.editing();
    const input = {
      kind: f.kind,
      title: f.title.trim(),
      scheduled_at: f.when ? new Date(f.when).toISOString() : null,
      duration_min: Math.min(
        600,
        Math.max(5, Math.round(f.duration_min) || 45),
      ),
      location: f.location.trim(),
      interviewers: f.interviewers.trim(),
      notes: f.notes.trim(),
      ...(editing
        ? {
            status: this.cancelled()
              ? ('cancelled' as const)
              : editing.status === 'cancelled'
                ? ('scheduled' as const)
                : editing.status,
          }
        : { role_id: this.role().id }),
    };
    this.busy.set(true);
    try {
      await this.repo.save(editing?.id ?? null, input);
      this.formOpen.set(false);
      this.toast.show(editing ? 'Round saved' : 'Round added');
    } catch (e) {
      this.toast.show((e as Error).message || 'Could not save the round');
    } finally {
      this.busy.set(false);
    }
  }

  async patch(iv: InterviewRow, change: Partial<InterviewRow>) {
    try {
      await this.repo.save(iv.id, change);
    } catch (e) {
      this.toast.show((e as Error).message || 'Could not save');
    }
  }

  typed(iv: InterviewRow, field: 'debrief' | 'thank_you', value: string) {
    const key = `${iv.id}:${field}`;
    this.saving.update((s) => ({ ...s, [key]: 'Saving…' }));
    clearTimeout(this.timers.get(key));
    this.timers.set(
      key,
      setTimeout(async () => {
        try {
          await this.repo.save(iv.id, { [field]: value });
          this.saving.update((s) => ({ ...s, [key]: 'Saved' }));
        } catch {
          this.saving.update((s) => ({ ...s, [key]: '' }));
          this.toast.show('Could not save');
        }
      }, 600),
    );
  }

  async draft(iv: InterviewRow) {
    this.drafting.set(iv.id);
    try {
      const r = await this.repo.draftThankYou(iv.id, this.model() || undefined);
      this.toast.show(
        r.method === 'ai'
          ? 'Note drafted; read it over before sending'
          : 'Note drafted from a template; fill in the bracket',
      );
    } catch (e) {
      this.toast.show((e as Error).message || 'Could not draft the note');
    } finally {
      this.drafting.set(null);
    }
  }

  async remove(iv: InterviewRow) {
    const ok = await this.confirm.ask({
      title: `Delete “${interviewLabel(iv)}”?`,
      body: 'Its debrief and thank-you note go with it.',
      action: 'Delete round',
      danger: true,
    });
    if (!ok) return;
    try {
      await this.repo.remove(iv.id);
      this.toast.show('Round deleted');
    } catch {
      this.toast.show('Could not delete the round');
    }
  }
}
