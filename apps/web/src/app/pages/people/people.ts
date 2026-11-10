import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  CONTACT_RELATIONS,
  CONTACT_RELATION_LABELS,
  daysBetweenDays,
  isoDay,
  type ContactRelation,
  type ContactRow,
} from '@jobbotix/shared-types';
import { PeopleRepo, RolesRepo } from '../../core/data/repos';
import { ContactForm } from '../../shared/contact-form';
import { RelativeDayPipe } from '../../shared/format';
import { Button, EmptyState, Icon, PageHeader, Skeleton } from '../../ui';

/** Everyone in the search: recruiters, hiring managers, people who can refer you. */
@Component({
  selector: 'jb-people',
  imports: [
    Button,
    ContactForm,
    EmptyState,
    Icon,
    PageHeader,
    RelativeDayPipe,
    RouterLink,
    Skeleton,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <jb-page-header
      title="People"
      lead="Recruiters, hiring managers and people who can refer you. Set a date to get back to each one and Today reminds you."
    >
      <div actions>
        <button type="button" jbButton="primary" (click)="adding.set(true)">
          <jb-icon name="user-plus" /> Add a person
        </button>
      </div>
    </jb-page-header>

    @if (!repo.loaded()) {
      <div class="mt-8"><jb-skeleton shape="card" [count]="3" /></div>
    } @else if (!repo.contacts().length) {
      <div class="mt-8">
        <jb-empty-state title="No people yet" icon="users">
          Add the recruiter who wrote to you, the hiring manager on a posting,
          or a former colleague at a company you like. Jobbotix drafts the
          message, logs what you sent and tells you when to follow up.
          <div actions>
            <button type="button" jbButton="primary" (click)="adding.set(true)">
              <jb-icon name="user-plus" /> Add a person
            </button>
          </div>
        </jb-empty-state>
      </div>
    } @else {
      <div class="mt-8 flex flex-wrap items-center gap-2">
        <input
          type="search"
          class="jb-input min-w-0 flex-1 basis-60"
          placeholder="Search name, company, title"
          aria-label="Search people"
          [value]="q()"
          (input)="q.set($any($event.target).value)"
        />
        <select
          class="jb-input w-auto"
          aria-label="Who they are"
          (change)="relation.set($any($event.target).value)"
        >
          <option value="" [selected]="relation() === ''">Everyone</option>
          @for (r of relations; track r) {
            <option [value]="r" [selected]="relation() === r">
              {{ relationLabels[r] }}
            </option>
          }
        </select>
        <label
          class="inline-flex min-h-10 items-center gap-2.5 text-sm text-ink"
        >
          <input
            type="checkbox"
            role="switch"
            class="jb-switch"
            [checked]="dueOnly()"
            (change)="dueOnly.set($any($event.target).checked)"
          />
          Due only
        </label>
      </div>

      <ul class="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
        @for (c of rows(); track c.id) {
          <li>
            <a
              class="jb-card jb-card-interactive flex h-full flex-col gap-2 p-4 no-underline md:p-5"
              [routerLink]="['/people', c.id]"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="font-semibold text-ink">{{ c.name }}</p>
                  <p class="truncate text-sm text-ink-muted">
                    {{ c.title }}{{ c.title && c.company ? ' at ' : ''
                    }}{{ c.company }}
                  </p>
                </div>
                <span class="jb-tag shrink-0">{{
                  relationLabels[c.relation]
                }}</span>
              </div>
              <p class="mt-auto flex flex-wrap gap-x-3 text-xs text-ink-faint">
                @if (due(c); as d) {
                  <span
                    class="font-medium"
                    [class.text-warn]="d.days <= 0"
                    [class.text-bad]="d.days < -2"
                    >{{ d.label }}</span
                  >
                }
                <span>
                  @if (c.last_touch_at) {
                    Last touch {{ c.last_touch_at | relativeDay }}
                  } @else {
                    No messages yet
                  }
                </span>
                @if (roleCount().get(c.id); as n) {
                  <span>{{ n }} {{ n === 1 ? 'role' : 'roles' }}</span>
                }
              </p>
            </a>
          </li>
        } @empty {
          <li class="text-sm text-ink-muted">Nobody matches.</li>
        }
      </ul>
    }

    <jb-contact-form [(open)]="adding" (saved)="opened($event)" />
  `,
})
export class PeoplePage {
  protected readonly repo = inject(PeopleRepo);
  private readonly roles = inject(RolesRepo);
  private readonly router = inject(Router);
  readonly relations = CONTACT_RELATIONS;
  readonly relationLabels = CONTACT_RELATION_LABELS;
  readonly adding = signal(false);
  readonly q = signal('');
  readonly relation = signal<ContactRelation | ''>('');
  readonly dueOnly = signal(false);
  private readonly today = isoDay(new Date());

  readonly roleCount = computed(() => {
    const ids = new Set(this.roles.roles().map((r) => r.id));
    const m = new Map<string, number>();
    for (const l of this.repo.links())
      if (ids.has(l.role_id))
        m.set(l.contact_id, (m.get(l.contact_id) ?? 0) + 1);
    return m;
  });

  readonly rows = computed(() => {
    const q = this.q().trim().toLowerCase();
    const rel = this.relation();
    return this.repo
      .contacts()
      .filter((c) => !rel || c.relation === rel)
      .filter(
        (c) =>
          !this.dueOnly() ||
          (!!c.next_touch_on && c.next_touch_on <= this.today),
      )
      .filter(
        (c) =>
          !q ||
          [c.name, c.company, c.title, c.notes]
            .join(' ')
            .toLowerCase()
            .includes(q),
      )
      .sort(
        (a, b) =>
          (a.next_touch_on ?? '9999').localeCompare(
            b.next_touch_on ?? '9999',
          ) || a.name.localeCompare(b.name),
      );
  });

  constructor() {
    if (!this.repo.loaded()) void this.repo.load().catch(() => undefined);
    void this.roles.load();
  }

  due(c: ContactRow): { days: number; label: string } | null {
    if (!c.next_touch_on) return null;
    const days = daysBetweenDays(this.today, c.next_touch_on);
    const label =
      days === 0
        ? 'Get back to them today'
        : days < 0
          ? `Overdue by ${-days} ${days === -1 ? 'day' : 'days'}`
          : days === 1
            ? 'Get back to them tomorrow'
            : `Get back to them in ${days} days`;
    return { days, label };
  }

  opened(c: ContactRow) {
    void this.router.navigate(['/people', c.id]);
  }
}
