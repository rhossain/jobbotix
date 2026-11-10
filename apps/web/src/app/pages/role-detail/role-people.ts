import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { CONTACT_RELATION_LABELS, type RoleRow } from '@jobbotix/shared-types';
import { PeopleRepo } from '../../core/data/repos';
import { ContactForm } from '../../shared/contact-form';
import { Toast } from '../../shared/toast';
import { Button, Icon } from '../../ui';

/** The People card on a role: who you know there, and a way to ask for a referral. */
@Component({
  selector: 'jb-role-people',
  imports: [Button, ContactForm, Icon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
  template: `
    <section class="jb-card p-4 md:p-5" aria-labelledby="role-people-h">
      <div class="flex items-center justify-between gap-2">
        <h2 id="role-people-h" class="font-semibold text-ink">People</h2>
        <button
          type="button"
          jbButton="ghost"
          size="sm"
          (click)="adding.set(true)"
        >
          <jb-icon name="user-plus" [size]="16" /> Add
        </button>
      </div>
      @if (linked().length) {
        <ul class="mt-3 flex flex-col gap-2.5 text-sm">
          @for (c of linked(); track c.id) {
            <li class="flex items-start justify-between gap-2">
              <a
                class="min-w-0 no-underline"
                [routerLink]="['/people', c.id]"
                [queryParams]="{ draft: 1 }"
              >
                <span class="block font-medium text-ink hover:underline">{{
                  c.name
                }}</span>
                <span class="block text-xs text-ink-muted"
                  >{{ relationLabels[c.relation]
                  }}{{ c.title ? ' · ' + c.title : '' }}</span
                >
              </a>
              <button
                type="button"
                jbButton="ghost"
                size="sm"
                iconOnly
                [attr.aria-label]="'Unlink ' + c.name"
                title="Unlink"
                (click)="unlink(c.id)"
              >
                <jb-icon name="x" [size]="15" />
              </button>
            </li>
          }
        </ul>
      } @else {
        <p class="mt-1 text-sm wrap-anywhere text-ink-muted">
          Know someone at {{ role().company }}? A referral is read before a cold
          application.
        </p>
      }
      @if (atCompany().length) {
        <select
          class="jb-input mt-3 w-full min-w-0"
          aria-label="Link someone you already know"
          (change)="link($any($event.target))"
        >
          <option value="">Link someone at {{ role().company }}…</option>
          @for (c of atCompany(); track c.id) {
            <option [value]="c.id">{{ c.name }}</option>
          }
        </select>
      }
    </section>
    <jb-contact-form
      [(open)]="adding"
      [defaults]="{
        company: role().company,
        relation: 'referrer',
        roleId: role().id,
      }"
    />
  `,
})
export class RolePeople {
  private readonly repo = inject(PeopleRepo);
  private readonly toast = inject(Toast);
  readonly role = input.required<RoleRow>();
  readonly relationLabels = CONTACT_RELATION_LABELS;
  readonly adding = signal(false);

  readonly linked = computed(() => {
    const ids = new Set(
      this.repo
        .links()
        .filter((l) => l.role_id === this.role().id)
        .map((l) => l.contact_id),
    );
    return this.repo.contacts().filter((c) => ids.has(c.id));
  });

  /** People at the same company who are not linked yet. */
  readonly atCompany = computed(() => {
    const linked = new Set(this.linked().map((c) => c.id));
    const company = this.role().company.toLowerCase().trim();
    return this.repo
      .contacts()
      .filter(
        (c) =>
          !linked.has(c.id) &&
          !!c.company &&
          (c.company.toLowerCase().includes(company) ||
            company.includes(c.company.toLowerCase().trim())),
      );
  });

  constructor() {
    if (!this.repo.loaded()) void this.repo.load().catch(() => undefined);
  }

  async link(select: HTMLSelectElement) {
    const id = select.value;
    select.value = '';
    if (!id) return;
    try {
      await this.repo.link(this.role().id, id);
    } catch {
      this.toast.show('Could not link');
    }
  }

  async unlink(contactId: string) {
    try {
      await this.repo.unlink(this.role().id, contactId);
    } catch {
      this.toast.show('Could not unlink');
    }
  }
}
