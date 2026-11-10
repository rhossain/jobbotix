import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { SettingsRepo } from '../../core/data/repos';
import { Toast } from '../../shared/toast';
import { Button } from '../../ui';

const DAYS = 7;

/** "until 18 Nov", for an ISO time. */
export function untilDay(iso: string, locale = 'en-GB'): string {
  return new Date(iso).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
  });
}

/**
 * Settings: the owner's switch for support access. On, the Jobbotix admin
 * can see this account's roles and master resume for seven days, to help
 * with a problem; off (the default), they cannot. It closes by itself.
 */
@Component({
  selector: 'jb-support-access',
  imports: [Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (available()) {
      <section
        id="support-access"
        class="jb-card flex flex-col gap-3 p-5 md:p-6"
      >
        <h2 class="jb-section-title">Support access</h2>
        <p class="text-sm text-ink-muted">
          The person who runs Jobbotix cannot see your roles or your resume. If
          you ask for help with a problem, you can open them for
          {{ days }} days. Your notes, letters and saved keys stay closed either
          way, and every look is recorded.
        </p>
        @if (until(); as t) {
          <div
            class="flex flex-wrap items-center justify-between gap-3 rounded-control bg-warn-tint p-3.5 text-sm text-warn"
          >
            <span
              >Open until {{ day(t) }}. It closes by itself after that.</span
            >
            <button
              type="button"
              jbButton
              [busy]="busy()"
              [disabled]="busy()"
              (click)="set(false)"
            >
              Close it now
            </button>
          </div>
        } @else {
          <div>
            <button
              type="button"
              jbButton
              [busy]="busy()"
              [disabled]="busy()"
              (click)="set(true)"
            >
              Open for {{ days }} days
            </button>
          </div>
        }
      </section>
    }
  `,
})
export class SupportAccess {
  private readonly repo = inject(SettingsRepo);
  private readonly toast = inject(Toast);
  protected readonly days = DAYS;
  readonly busy = signal(false);

  /** Hidden on a database from before support access existed. */
  readonly available = computed(() => {
    const p = this.repo.profile();
    return !!p && p.support_access_until !== undefined;
  });
  /** The time it is open until, when it is open now. */
  readonly until = computed(() => {
    const t = this.repo.profile()?.support_access_until;
    return t && Date.parse(t) > Date.now() ? t : null;
  });

  day(iso: string) {
    return untilDay(iso);
  }

  async set(open: boolean) {
    this.busy.set(true);
    try {
      await this.repo.updateProfile({
        support_access_until: open
          ? new Date(Date.now() + DAYS * 86_400_000).toISOString()
          : null,
      });
      this.toast.show(
        open
          ? `Support access is open for ${DAYS} days`
          : 'Support access closed',
      );
    } catch (e) {
      this.toast.show(`Could not save: ${(e as Error).message || 'try again'}`);
    } finally {
      this.busy.set(false);
    }
  }
}
