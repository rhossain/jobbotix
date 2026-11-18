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
import { Router, RouterLink } from '@angular/router';
import {
  companyKey,
  linkedInPeopleSearchUrl,
  type ContactRow,
  type LinkedInConnectionRow,
  type RoleRow,
} from '@jobbotix/shared-types';
import { LinkedInRepo, PeopleRepo } from '../../core/data/repos';
import { Toast } from '../../shared/toast';
import { Button, Icon } from '../../ui';
import { environment } from '../../../environments/environment';

/** People listed on the card; the rest are found under Contacts. */
const SHOWN = 5;

const sameLink = (a: string, b: string) =>
  !!a && a.toLowerCase().replace(/\/+$/, '') === b.toLowerCase();

/**
 * The LinkedIn card on a job: the connections from the user's own LinkedIn
 * file who work at this company, a way to ask one of them for a referral,
 * and a link that opens LinkedIn's people search for the company. Jobbotix
 * never contacts LinkedIn: the list comes from the imported file, and the
 * links open LinkedIn in the user's own browser when they click.
 */
@Component({
  selector: 'jb-role-connections',
  imports: [Button, Icon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
  template: `
    @if (company()) {
      <section class="jb-card p-4 md:p-5" aria-labelledby="role-li-h">
        <h2 id="role-li-h" class="font-semibold text-ink">On LinkedIn</h2>
        @if (known().length) {
          <p
            id="role-li-known"
            class="mt-1 text-sm wrap-anywhere text-ink-muted"
          >
            You know {{ known().length }}
            {{ known().length === 1 ? 'person' : 'people' }} at {{ company() }},
            from your LinkedIn file.
          </p>
          <ul class="mt-3 flex flex-col gap-3 text-sm">
            @for (c of known().slice(0, shown); track c.id) {
              <li class="min-w-0">
                <span class="block font-medium wrap-anywhere text-ink">{{
                  c.name
                }}</span>
                @if (c.title) {
                  <span class="block text-xs wrap-anywhere text-ink-muted">{{
                    c.title
                  }}</span>
                }
                <span class="mt-1.5 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    jbButton
                    size="sm"
                    [disabled]="asking() === c.id"
                    (click)="askForReferral(c)"
                  >
                    <jb-icon name="send" [size]="15" /> Ask for a referral
                  </button>
                  @if (c.profile_url) {
                    <a
                      class="text-xs text-brand-ink underline"
                      [href]="c.profile_url"
                      target="_blank"
                      rel="noopener"
                      >Profile</a
                    >
                  }
                </span>
              </li>
            }
          </ul>
          @if (known().length > shown) {
            <p class="mt-3 text-xs text-ink-faint">
              and {{ known().length - shown }} more. Search for them under
              <a routerLink="/people" class="underline">Contacts</a>.
            </p>
          }
        } @else if (canImport && linkedin.total() === 0) {
          <p
            id="role-li-hint"
            class="mt-1 text-sm wrap-anywhere text-ink-muted"
          >
            Import your LinkedIn file in
            <a routerLink="/settings/linkedin" class="text-brand-ink underline"
              >Settings</a
            >
            and Jobbotix shows here who you already know at
            {{ company() }}.
          </p>
        }
        <a
          id="role-li-search"
          class="mt-3 inline-flex items-center gap-1.5 text-sm wrap-anywhere text-brand-ink underline"
          [href]="peopleSearch()"
          target="_blank"
          rel="noopener"
          >Find people at {{ company() }} on LinkedIn
          <jb-icon name="arrow-up-right" [size]="14"
        /></a>
        <p class="mt-1 text-xs text-ink-faint">
          Opens LinkedIn in a new tab. Jobbotix does not read LinkedIn.
        </p>
      </section>
    }
  `,
})
export class RoleConnections {
  protected readonly linkedin = inject(LinkedInRepo);
  private readonly people = inject(PeopleRepo);
  private readonly router = inject(Router);
  private readonly toast = inject(Toast);
  readonly role = input.required<RoleRow>();
  readonly shown = SHOWN;
  readonly canImport = environment.linkedinImport;

  /** The company's name, or '' when the job does not say which company. */
  readonly company = computed(() => {
    const name = this.role().company.trim();
    return /^unknown company$/i.test(name) || !companyKey(name) ? '' : name;
  });
  readonly peopleSearch = computed(() =>
    linkedInPeopleSearchUrl(this.company()),
  );
  readonly known = signal<LinkedInConnectionRow[]>([]);
  readonly asking = signal('');
  private asked = 0;
  /** Settles when the list for the current company has been looked up. */
  ready: Promise<void> = Promise.resolve();

  constructor() {
    effect(() => {
      const company = this.company();
      untracked(() => {
        this.ready = this.lookUp(company);
      });
    });
  }

  private async lookUp(company: string) {
    const mine = ++this.asked;
    if (!company) {
      this.known.set([]);
      return;
    }
    try {
      if (this.linkedin.total() === null) await this.linkedin.refresh();
      const found = this.linkedin.total()
        ? await this.linkedin.atCompanies([company])
        : null;
      if (mine === this.asked)
        this.known.set(found?.get(companyKey(company)) ?? []);
    } catch {
      if (mine === this.asked) this.known.set([]);
    }
  }

  /** The contact this connection already is, if any. */
  private contactFor(c: LinkedInConnectionRow): ContactRow | undefined {
    return this.people
      .contacts()
      .find(
        (p) =>
          sameLink(p.linkedin_url, c.profile_url) ||
          (p.name.toLowerCase() === c.name.toLowerCase() &&
            companyKey(p.company) === companyKey(c.company)),
      );
  }

  /**
   * Makes the connection a contact tied to this job (once), then opens the
   * contact where the referral message is drafted. The user sends it
   * themselves; Jobbotix sends nothing.
   */
  async askForReferral(c: LinkedInConnectionRow) {
    if (this.asking()) return;
    this.asking.set(c.id);
    try {
      if (!this.people.loaded()) await this.people.load();
      const role = this.role();
      const contact =
        this.contactFor(c) ??
        (await this.people.save(null, {
          name: c.name,
          company: c.company,
          title: c.title,
          relation: 'referrer',
          linkedin_url: c.profile_url,
          notes: c.connected_on
            ? `Connected on LinkedIn since ${c.connected_on}.`
            : 'A LinkedIn connection.',
        }));
      const linked = this.people
        .links()
        .some((l) => l.role_id === role.id && l.contact_id === contact.id);
      if (!linked) await this.people.link(role.id, contact.id);
      await this.router.navigate(['/people', contact.id], {
        queryParams: { draft: 1 },
      });
    } catch (e) {
      this.toast.error((e as Error).message || 'Could not add the contact');
    } finally {
      this.asking.set('');
    }
  }
}
