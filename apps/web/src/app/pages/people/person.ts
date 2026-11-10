import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  CONTACT_RELATION_LABELS,
  MESSAGE_KINDS,
  MESSAGE_KIND_LABELS,
  TOUCH_CHANNELS,
  TOUCH_CHANNEL_LABELS,
  addDays,
  daysBetweenDays,
  isoDay,
  suggestedMessage,
  type ContactTouchRow,
  type MessageKind,
  type TouchChannel,
  type TouchDirection,
} from '@jobbotix/shared-types';
import { PeopleRepo, RolesRepo } from '../../core/data/repos';
import { ContactForm } from '../../shared/contact-form';
import { RelativeDayPipe } from '../../shared/format';
import { ModelPicker } from '../../shared/model-picker';
import { Toast } from '../../shared/toast';
import {
  BackLink,
  Button,
  Confirm,
  CopyButton,
  EmptyState,
  FieldControl,
  Icon,
} from '../../ui';

/** One person: who they are, the roles they relate to, messages to send, and every touch. */
@Component({
  selector: 'jb-person',
  imports: [
    BackLink,
    Button,
    ContactForm,
    CopyButton,
    EmptyState,
    FieldControl,
    Icon,
    ModelPicker,
    RelativeDayPipe,
    RouterLink,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <jb-back-link link="/people" label="People" />
    @if (contact(); as c) {
      <header
        class="mt-4 flex flex-col gap-4 md:flex-row md:items-start md:justify-between"
      >
        <div class="min-w-0">
          <h1 class="text-2xl font-semibold text-ink md:text-3xl">
            {{ c.name }}
          </h1>
          <p class="mt-1 text-ink-muted md:text-lg">
            {{ c.title }}{{ c.title && c.company ? ' at ' : '' }}{{ c.company }}
          </p>
          <div class="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span class="jb-tag">{{ relationLabels[c.relation] }}</span>
            @if (c.email) {
              <a
                class="text-brand-ink underline decoration-line underline-offset-2"
                [href]="'mailto:' + c.email"
                >{{ c.email }}</a
              >
            }
            @if (c.linkedin_url) {
              <a
                class="inline-flex items-center gap-1 text-brand-ink underline decoration-line underline-offset-2"
                [href]="c.linkedin_url"
                target="_blank"
                rel="noopener"
                >LinkedIn <jb-icon name="arrow-up-right" [size]="14"
              /></a>
            }
          </div>
        </div>
        <div class="flex gap-2">
          <button type="button" jbButton (click)="editing.set(true)">
            <jb-icon name="pencil" /> Edit
          </button>
          <button
            type="button"
            jbButton="ghost"
            iconOnly
            aria-label="Delete this person"
            title="Delete"
            (click)="remove()"
          >
            <jb-icon name="trash" />
          </button>
        </div>
      </header>

      <div
        class="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]"
      >
        <div class="flex min-w-0 flex-col gap-6">
          <section class="jb-card p-5 md:p-6" aria-labelledby="msg-h">
            <h2 id="msg-h" class="font-semibold text-ink">Draft a message</h2>
            <div class="mt-3 grid gap-3 sm:grid-cols-2">
              <label class="flex flex-col gap-1.5 text-sm font-medium">
                Kind
                <select
                  class="jb-input"
                  (change)="kind.set($any($event.target).value)"
                >
                  @for (k of kinds; track k) {
                    <option [value]="k" [selected]="k === kind()">
                      {{ kindLabels[k] }}
                    </option>
                  }
                </select>
              </label>
              <label class="flex flex-col gap-1.5 text-sm font-medium">
                About
                <select
                  class="jb-input"
                  (change)="roleId.set($any($event.target).value || null)"
                >
                  <option value="" [selected]="!roleId()">
                    No particular role
                  </option>
                  @for (r of linkedRoles(); track r.id) {
                    <option [value]="r.id" [selected]="r.id === roleId()">
                      {{ r.title }} at {{ r.company }}
                    </option>
                  }
                </select>
              </label>
            </div>
            @if (kind() === 'recruiter_reply') {
              <label class="mt-3 flex flex-col gap-1.5 text-sm font-medium">
                Their message
                <textarea
                  jbInput
                  rows="3"
                  class="text-sm"
                  placeholder="Paste what the recruiter wrote"
                  [value]="incoming()"
                  (input)="incoming.set($any($event.target).value)"
                ></textarea>
              </label>
            }
            <label class="mt-3 flex flex-col gap-1.5 text-sm font-medium">
              <span
                >What you want to say
                <span class="font-normal text-ink-faint">(optional)</span></span
              >
              <textarea
                jbInput
                rows="2"
                class="text-sm"
                placeholder="e.g. mention we met at NgConf; ask about the team's move to signals"
                [value]="ask()"
                (input)="ask.set($any($event.target).value)"
              ></textarea>
            </label>
            <div class="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                jbButton="primary"
                [busy]="drafting()"
                [disabled]="drafting()"
                (click)="draft()"
              >
                <jb-icon name="sparkles" />
                {{ message() ? 'Draft again' : 'Draft' }}
              </button>
              <jb-model-picker [(value)]="model" job="message" />
            </div>
            @if (message()) {
              <textarea
                jbInput
                [autogrow]="true"
                rows="6"
                class="mt-4 text-sm"
                aria-label="Drafted message"
                [value]="message()"
                (input)="message.set($any($event.target).value)"
              ></textarea>
              <div class="mt-2 flex flex-wrap items-center gap-2">
                <jb-copy-button size="sm" [text]="message()" />
                <button type="button" jbButton size="sm" (click)="logSent()">
                  <jb-icon name="send" [size]="16" /> I sent it
                </button>
                <span class="text-xs text-ink-muted"
                  >Logs it and sets a check-in a week from today.</span
                >
              </div>
            }
          </section>

          <section aria-labelledby="touch-h">
            <h2
              id="touch-h"
              class="flex items-center gap-2 text-lg font-semibold text-ink"
            >
              Activity <span class="jb-count">{{ touches().length }}</span>
            </h2>
            <form
              class="jb-card mt-3 flex flex-col gap-3 p-4 md:p-5"
              (submit)="$event.preventDefault(); log()"
            >
              <div class="flex flex-wrap items-center gap-2 text-sm">
                <select
                  class="jb-input w-auto"
                  aria-label="Direction"
                  (change)="direction.set($any($event.target).value)"
                >
                  <option value="out" [selected]="direction() === 'out'">
                    I reached out
                  </option>
                  <option value="in" [selected]="direction() === 'in'">
                    They replied
                  </option>
                </select>
                <select
                  class="jb-input w-auto"
                  aria-label="Channel"
                  (change)="channel.set($any($event.target).value)"
                >
                  @for (ch of channels; track ch) {
                    <option [value]="ch" [selected]="ch === channel()">
                      {{ channelLabels[ch] }}
                    </option>
                  }
                </select>
              </div>
              <textarea
                jbInput
                rows="2"
                class="text-sm"
                aria-label="What happened"
                placeholder="What was said, what comes next"
                [value]="note()"
                (input)="note.set($any($event.target).value)"
              ></textarea>
              <div>
                <button
                  type="submit"
                  jbButton
                  size="sm"
                  [busy]="logging()"
                  [disabled]="logging()"
                >
                  <jb-icon name="plus" [size]="16" /> Log it
                </button>
              </div>
            </form>
            @if (touches().length) {
              <ol class="mt-4 flex flex-col gap-3">
                @for (t of touches(); track t.id) {
                  <li class="flex gap-3 text-sm">
                    <span
                      class="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full"
                      [class.bg-brand-tint]="t.direction === 'in'"
                      [class.text-brand-ink]="t.direction === 'in'"
                      [class.bg-sunken]="t.direction === 'out'"
                      aria-hidden="true"
                    >
                      <jb-icon
                        [name]="t.direction === 'in' ? 'inbox' : 'send'"
                        [size]="15"
                      />
                    </span>
                    <div class="min-w-0">
                      <p class="text-ink">
                        <b class="font-semibold">{{
                          t.direction === 'in'
                            ? 'They replied'
                            : 'You reached out'
                        }}</b>
                        · {{ channelLabels[t.channel] }} ·
                        <span class="text-ink-muted">{{
                          t.at | relativeDay
                        }}</span>
                        @if (roleName(t.role_id); as rn) {
                          · <span class="text-ink-muted">{{ rn }}</span>
                        }
                      </p>
                      @if (t.note) {
                        <p class="mt-0.5 whitespace-pre-line text-ink-muted">
                          {{ t.note }}
                        </p>
                      }
                    </div>
                  </li>
                }
              </ol>
            }
          </section>
        </div>

        <aside class="flex flex-col gap-6">
          <section class="jb-card p-4 md:p-5" aria-labelledby="next-h">
            <h2 id="next-h" class="font-semibold text-ink">Get back to them</h2>
            <p
              class="mt-1 text-sm"
              [class.text-warn]="dueDays() !== null && (dueDays() ?? 1) <= 0"
              [class.text-ink-muted]="
                dueDays() === null || (dueDays() ?? 0) > 0
              "
            >
              {{ dueLabel() }}
            </p>
            <input
              class="jb-input mt-3"
              type="date"
              aria-label="Date to get back to them"
              [value]="c.next_touch_on ?? ''"
              (change)="setNext($any($event.target).value || null)"
            />
            <div class="mt-2 flex flex-wrap gap-1.5">
              @for (o of quick; track o.days) {
                <button
                  type="button"
                  jbButton="ghost"
                  size="sm"
                  (click)="setNext(inDays(o.days))"
                >
                  {{ o.label }}
                </button>
              }
              @if (c.next_touch_on) {
                <button
                  type="button"
                  jbButton="ghost"
                  size="sm"
                  (click)="setNext(null)"
                >
                  Clear
                </button>
              }
            </div>
          </section>

          <section class="jb-card p-4 md:p-5" aria-labelledby="roles-h">
            <h2 id="roles-h" class="font-semibold text-ink">Roles</h2>
            @if (linkedRoles().length) {
              <ul class="mt-3 flex flex-col gap-2 text-sm">
                @for (r of linkedRoles(); track r.id) {
                  <li class="flex items-start justify-between gap-2">
                    <a
                      class="min-w-0 text-ink underline decoration-line underline-offset-2 hover:text-brand-ink"
                      [routerLink]="['/roles', r.id]"
                      >{{ r.title }}
                      <span class="text-ink-muted">at {{ r.company }}</span></a
                    >
                    <button
                      type="button"
                      jbButton="ghost"
                      size="sm"
                      iconOnly
                      [attr.aria-label]="'Unlink ' + r.title"
                      title="Unlink"
                      (click)="unlink(r.id)"
                    >
                      <jb-icon name="x" [size]="15" />
                    </button>
                  </li>
                }
              </ul>
            } @else {
              <p class="mt-1 text-sm text-ink-muted">
                Not linked to a role yet.
              </p>
            }
            @if (linkable().length) {
              <select
                class="jb-input mt-3"
                aria-label="Link a role"
                (change)="linkRole($any($event.target))"
              >
                <option value="">Link a role…</option>
                @for (r of linkable(); track r.id) {
                  <option [value]="r.id">
                    {{ r.title }} at {{ r.company }}
                  </option>
                }
              </select>
            }
          </section>

          @if (c.notes) {
            <section class="jb-card p-4 md:p-5">
              <h2 class="font-semibold text-ink">Notes</h2>
              <p class="mt-2 whitespace-pre-line text-sm text-ink">
                {{ c.notes }}
              </p>
            </section>
          }
        </aside>
      </div>

      <jb-contact-form [(open)]="editing" [contact]="c" />
    } @else if (repo.loaded()) {
      <div class="mt-8">
        <jb-empty-state title="Person not found" icon="users">
          They may have been deleted.
          <div actions><a jbButton routerLink="/people">All people</a></div>
        </jb-empty-state>
      </div>
    }
  `,
})
export class PersonPage {
  protected readonly repo = inject(PeopleRepo);
  private readonly roles = inject(RolesRepo);
  private readonly toast = inject(Toast);
  private readonly confirm = inject(Confirm);
  private readonly router = inject(Router);
  readonly id = input.required<string>();

  readonly relationLabels = CONTACT_RELATION_LABELS;
  readonly kinds = MESSAGE_KINDS;
  readonly kindLabels = MESSAGE_KIND_LABELS;
  readonly channels = TOUCH_CHANNELS;
  readonly channelLabels = TOUCH_CHANNEL_LABELS;
  readonly quick = [
    { days: 3, label: 'In 3 days' },
    { days: 7, label: 'In a week' },
    { days: 14, label: 'In 2 weeks' },
  ];
  private readonly today = isoDay(new Date());

  readonly contact = computed(() =>
    this.repo.contacts().find((c) => c.id === this.id()),
  );
  /** True once the person is loaded; edits to them do not re-run setup. */
  private readonly found = computed(() => !!this.contact());
  readonly touches = signal<ContactTouchRow[]>([]);
  readonly linkedRoles = computed(() => {
    const ids = new Set(
      this.repo
        .links()
        .filter((l) => l.contact_id === this.id())
        .map((l) => l.role_id),
    );
    return this.roles.roles().filter((r) => ids.has(r.id));
  });
  /** Roles not linked yet, the person's company first. */
  readonly linkable = computed(() => {
    const linked = new Set(this.linkedRoles().map((r) => r.id));
    const company = (this.contact()?.company ?? '').toLowerCase().trim();
    return this.roles
      .roles()
      .filter((r) => !linked.has(r.id) && r.status !== 'skipped')
      .sort((a, b) => {
        const am = company && a.company.toLowerCase().includes(company) ? 0 : 1;
        const bm = company && b.company.toLowerCase().includes(company) ? 0 : 1;
        return am - bm || a.company.localeCompare(b.company);
      })
      .slice(0, 60);
  });

  readonly dueDays = computed(() => {
    const d = this.contact()?.next_touch_on;
    return d ? daysBetweenDays(this.today, d) : null;
  });
  readonly dueLabel = computed(() => {
    const d = this.dueDays();
    if (d === null) return 'No date set.';
    if (d === 0) return 'Today.';
    if (d < 0) return `Overdue by ${-d} ${d === -1 ? 'day' : 'days'}.`;
    return d === 1 ? 'Tomorrow.' : `In ${d} days.`;
  });

  readonly editing = signal(false);
  readonly kind = signal<MessageKind>('outreach');
  readonly roleId = signal<string | null>(null);
  readonly incoming = signal('');
  readonly ask = signal('');
  readonly message = signal('');
  readonly model = signal('');
  readonly drafting = signal(false);
  readonly direction = signal<TouchDirection>('out');
  readonly channel = signal<TouchChannel>('email');
  readonly note = signal('');
  readonly logging = signal(false);

  constructor() {
    if (!this.repo.loaded()) void this.repo.load().catch(() => undefined);
    void this.roles.load();
    // per person: load the activity and pick sensible message defaults
    effect(() => {
      const id = this.id();
      if (!this.found()) return;
      untracked(() => {
        const c = this.contact();
        if (!c) return;
        void this.repo.touches(id).then((t) => {
          if (this.id() !== id) return;
          this.touches.set(t);
          this.kind.set(suggestedMessage(c.relation, t[0]?.direction ?? null));
        });
        this.roleId.set(this.linkedRoles()[0]?.id ?? null);
        this.channel.set(c.linkedin_url && !c.email ? 'linkedin' : 'email');
        this.message.set('');
      });
    });
    const focus = inject(ActivatedRoute).snapshot.queryParamMap.get('draft');
    if (focus)
      queueMicrotask(() => document.getElementById('msg-h')?.scrollIntoView());
  }

  inDays(days: number) {
    return addDays(this.today, days);
  }

  roleName(id: string | null) {
    if (!id) return '';
    const r = this.roles.roles().find((x) => x.id === id);
    return r ? `${r.title} at ${r.company}` : '';
  }

  async setNext(day: string | null) {
    try {
      await this.repo.save(this.id(), { next_touch_on: day });
      this.toast.show(day ? 'Reminder set' : 'Reminder cleared');
    } catch {
      this.toast.show('Could not save');
    }
  }

  async linkRole(select: HTMLSelectElement) {
    const roleId = select.value;
    select.value = '';
    if (!roleId) return;
    try {
      await this.repo.link(roleId, this.id());
    } catch {
      this.toast.show('Could not link the role');
    }
  }

  async unlink(roleId: string) {
    try {
      await this.repo.unlink(roleId, this.id());
    } catch {
      this.toast.show('Could not unlink the role');
    }
  }

  async draft() {
    this.drafting.set(true);
    try {
      const r = await this.repo.draftMessage({
        contactId: this.id(),
        kind: this.kind(),
        roleId: this.roleId(),
        incoming: this.incoming(),
        ask: this.ask(),
        model: this.model() || undefined,
      });
      this.message.set(r.body);
      this.toast.show(
        r.method === 'ai'
          ? 'Drafted; read it over before sending'
          : 'Drafted from a template; fill in the brackets',
      );
    } catch (e) {
      this.toast.show((e as Error).message || 'Could not draft the message');
    } finally {
      this.drafting.set(false);
    }
  }

  async logSent() {
    await this.saveTouch(
      {
        direction: 'out',
        channel: this.channel(),
        note: `${this.kindLabels[this.kind()]}:\n${this.message()}`.slice(
          0,
          10000,
        ),
      },
      this.inDays(7),
    );
    this.message.set('');
  }

  async log() {
    await this.saveTouch(
      {
        direction: this.direction(),
        channel: this.channel(),
        note: this.note().trim(),
      },
      // a reply puts the ball in your court: today; a message sent: a week
      this.direction() === 'in' ? this.today : this.inDays(7),
    );
    this.note.set('');
  }

  private async saveTouch(
    t: { direction: TouchDirection; channel: TouchChannel; note: string },
    next: string,
  ) {
    this.logging.set(true);
    try {
      await this.repo.logTouch(
        { contact_id: this.id(), role_id: this.roleId(), ...t },
        next,
      );
      this.touches.set(await this.repo.touches(this.id()));
      this.toast.show(
        t.direction === 'in'
          ? 'Logged; reply to them today'
          : 'Logged; check in a week from today',
      );
    } catch {
      this.toast.show('Could not log it');
    } finally {
      this.logging.set(false);
    }
  }

  async remove() {
    const c = this.contact();
    if (!c) return;
    const ok = await this.confirm.ask({
      title: `Delete ${c.name}?`,
      body: 'Their activity goes with them. Roles are not touched.',
      action: 'Delete person',
      danger: true,
    });
    if (!ok) return;
    try {
      await this.repo.remove(c.id);
      this.toast.show(`Deleted ${c.name}`);
      void this.router.navigateByUrl('/people');
    } catch {
      this.toast.show('Could not delete');
    }
  }
}
