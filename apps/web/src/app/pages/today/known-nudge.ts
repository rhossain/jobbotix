import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { companyKey, type RoleRow } from '@jobbotix/shared-types';
import { LinkedInRepo } from '../../core/data/repos';
import { Icon } from '../../ui';

/** Jobs named in the nudge; it is a nudge, not a list. */
const SHOWN = 3;
/** New jobs looked at: the ones at the top of Today. */
const LOOKED_AT = 40;

interface Known {
  role: RoleRow;
  people: number;
}

/**
 * On Today, above the new jobs: "you know someone at this company", for the
 * new jobs at companies where one of the user's LinkedIn connections works.
 * The connections come from the LinkedIn file the user imported; one request
 * asks about all the new jobs at once, and LinkedIn is never contacted.
 */
@Component({
  selector: 'jb-known-nudge',
  imports: [Icon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (known().length) {
      <section
        id="known-nudge"
        class="jb-card flex items-start gap-3 p-4 text-sm"
        aria-labelledby="known-nudge-h"
      >
        <jb-icon name="users" [size]="18" class="mt-0.5 shrink-0 text-brand" />
        <div class="min-w-0">
          <h3 id="known-nudge-h" class="font-semibold text-ink">
            You know someone at
            {{ known().length === 1 ? 'this company' : 'these companies' }}
          </h3>
          <ul class="mt-1 flex flex-col gap-0.5 text-ink-muted">
            @for (k of known().slice(0, shown); track k.role.id) {
              <li class="wrap-anywhere">
                <a
                  class="text-brand-ink underline"
                  [routerLink]="['/jobs', k.role.id]"
                  >{{ k.role.title }} at {{ k.role.company }}</a
                >
                · {{ k.people }}
                {{ k.people === 1 ? 'connection' : 'connections' }}
              </li>
            }
          </ul>
          <p class="mt-1 text-xs text-ink-faint">
            @if (known().length > shown) {
              And {{ known().length - shown }} more of your new jobs.
            }
            A referral is read before a cold application: open the job to ask
            for one.
          </p>
        </div>
      </section>
    }
  `,
})
export class KnownNudge {
  private readonly linkedin = inject(LinkedInRepo);
  /** The new jobs on Today, best match first. */
  readonly roles = input.required<RoleRow[]>();
  readonly shown = SHOWN;
  readonly known = signal<Known[]>([]);
  /** The companies last asked about, so the same list is not asked twice. */
  private last = '';
  private asked = 0;
  /** Settles when the current list of jobs has been looked up. */
  ready: Promise<void> = Promise.resolve();

  constructor() {
    effect(() => {
      const roles = this.roles()
        .filter((r) => r.entry_kind !== 'gig')
        .slice(0, LOOKED_AT);
      untracked(() => {
        this.ready = this.lookUp(roles);
      });
    });
  }

  private async lookUp(roles: RoleRow[]) {
    const keys = [...new Set(roles.map((r) => companyKey(r.company)))]
      .filter((k) => k && k !== 'unknown')
      .sort();
    const signature = keys.join('|');
    if (signature === this.last) {
      // same companies: only which jobs are still new may have changed
      const ids = new Set(roles.map((r) => r.id));
      this.known.update((l) => l.filter((k) => ids.has(k.role.id)));
      return;
    }
    const mine = ++this.asked;
    try {
      if (this.linkedin.total() === null) await this.linkedin.refresh();
      const found =
        keys.length && this.linkedin.total()
          ? await this.linkedin.atCompanies(roles.map((r) => r.company))
          : null;
      if (mine !== this.asked) return;
      this.last = signature;
      this.known.set(
        roles
          .map((role) => ({
            role,
            people: found?.get(companyKey(role.company))?.length ?? 0,
          }))
          .filter((k) => k.people > 0),
      );
    } catch {
      if (mine === this.asked) this.known.set([]);
    }
  }
}
