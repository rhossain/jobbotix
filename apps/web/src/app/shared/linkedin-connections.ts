import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import type { LinkedInConnectionRow } from '@jobbotix/shared-types';
import { LinkedInRepo, PeopleRepo } from '../core/data/repos';
import { Button, Icon } from '../ui';
import { Toast } from './toast';

const key = (name: string, company: string) =>
  `${name}|${company}`.toLowerCase();

/**
 * The connections kept from the user's LinkedIn archive, searchable, on the
 * Contacts page. They stay out of the contacts themselves: a person becomes
 * a contact only when the user presses "Add to contacts". Nothing here
 * contacts LinkedIn; a profile opens in a new tab only when the user clicks.
 */
@Component({
  selector: 'jb-linkedin-connections',
  imports: [Button, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (linkedin.total(); as total) {
      <section
        class="jb-card mt-8 flex flex-col gap-3 p-5 md:p-6"
        aria-labelledby="li-conn-h"
      >
        <h2 id="li-conn-h" class="jb-section-title">
          From your LinkedIn file ({{ total }})
        </h2>
        <p class="text-sm text-ink-muted">
          People you are connected to on LinkedIn, from the file you imported in
          Settings. Search for a company or a name, and add the people you want
          to reach out to as contacts.
        </p>
        <input
          id="li-conn-q"
          type="search"
          class="jb-input"
          placeholder="Search a company, a name or a job title"
          aria-label="Search your LinkedIn connections"
          [value]="q()"
          (input)="search($any($event.target).value)"
        />
        @if (failed()) {
          <p class="text-sm text-bad" role="alert">{{ failed() }}</p>
        }
        <ul id="li-conn-list" class="flex flex-col divide-y divide-line">
          @for (c of rows(); track c.id) {
            <li
              class="flex flex-wrap items-center justify-between gap-3 py-2.5"
            >
              <div class="min-w-0">
                <p class="font-medium text-ink">{{ c.name }}</p>
                <p class="truncate text-sm text-ink-muted">
                  {{ c.title }}{{ c.title && c.company ? ' at ' : ''
                  }}{{ c.company }}
                </p>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                @if (c.profile_url) {
                  <a
                    class="text-sm text-brand-ink underline"
                    [href]="c.profile_url"
                    target="_blank"
                    rel="noopener"
                    >Profile</a
                  >
                }
                @if (isContact(c)) {
                  <span class="jb-tag">In contacts</span>
                } @else {
                  <button
                    type="button"
                    jbButton
                    [disabled]="adding() === c.id"
                    (click)="add(c)"
                  >
                    <jb-icon name="user-plus" /> Add to contacts
                  </button>
                }
              </div>
            </li>
          } @empty {
            <li class="py-2.5 text-sm text-ink-muted">
              {{ searching() ? 'Searching…' : 'Nobody matches.' }}
            </li>
          }
        </ul>
        @if (rows().length >= limit) {
          <p class="text-xs text-ink-faint">
            Showing the first {{ limit }}. Type more to narrow it down.
          </p>
        }
      </section>
    }
  `,
})
export class LinkedInConnections {
  protected readonly linkedin = inject(LinkedInRepo);
  private readonly people = inject(PeopleRepo);
  private readonly toast = inject(Toast);
  readonly limit = 50;

  readonly q = signal('');
  readonly rows = signal<LinkedInConnectionRow[]>([]);
  readonly searching = signal(false);
  readonly failed = signal('');
  readonly adding = signal('');
  private timer: ReturnType<typeof setTimeout> | undefined;
  private asked = 0;
  /** Settles once the first page of connections is on screen. */
  readonly ready: Promise<void>;

  /** Who is a contact already, by profile link and by name and company. */
  private readonly known = computed(() => {
    const links = new Set<string>();
    const names = new Set<string>();
    for (const c of this.people.contacts()) {
      if (c.linkedin_url)
        links.add(c.linkedin_url.toLowerCase().replace(/\/+$/, ''));
      names.add(key(c.name, c.company));
    }
    return { links, names };
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
    this.ready = this.linkedin
      .refresh()
      .then(() => this.run(''))
      .catch(() => undefined);
  }

  isContact(c: LinkedInConnectionRow): boolean {
    const { links, names } = this.known();
    return (
      (!!c.profile_url && links.has(c.profile_url.toLowerCase())) ||
      names.has(key(c.name, c.company))
    );
  }

  /** Waits for a pause in typing, then asks. */
  search(q: string) {
    this.q.set(q);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(q), 250);
  }

  async run(q: string) {
    if (!this.linkedin.total()) return;
    const mine = ++this.asked;
    this.searching.set(true);
    this.failed.set('');
    try {
      const rows = await this.linkedin.search(q, this.limit);
      // a slower, older answer must not replace a newer one
      if (mine === this.asked) this.rows.set(rows);
    } catch (e) {
      if (mine === this.asked)
        this.failed.set((e as Error).message || 'Could not search');
    } finally {
      if (mine === this.asked) this.searching.set(false);
    }
  }

  async add(c: LinkedInConnectionRow) {
    if (this.adding()) return;
    this.adding.set(c.id);
    try {
      await this.people.save(null, {
        name: c.name,
        company: c.company,
        title: c.title,
        relation: 'peer',
        linkedin_url: c.profile_url,
        notes: c.connected_on
          ? `Connected on LinkedIn since ${c.connected_on}.`
          : 'A LinkedIn connection.',
      });
      this.toast.success(`${c.name} added to your contacts`);
    } catch (e) {
      this.toast.error((e as Error).message || 'Could not add the contact');
    } finally {
      this.adding.set('');
    }
  }
}
