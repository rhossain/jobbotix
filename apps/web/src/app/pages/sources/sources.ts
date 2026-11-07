import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  ATS_LABEL,
  careersSystem,
  countryName,
  type SourceCatalogRow,
} from '@jobbotix/shared-types';
import {
  type FollowedCompany,
  SearchProfileRepo,
  SourcesRepo,
  WatchlistRepo,
} from '../../core/data/repos';
import { RelativeDayPipe } from '../../shared/format';
import { Toast } from '../../shared/toast';
import { Button, EmptyState, Icon, PageHeader, Skeleton } from '../../ui';

type Health = 'ok' | 'failing' | 'needs-key' | 'off' | 'waiting';

/** Boards whose reach is narrower than "worldwide" but not one country. */
const REACH: Record<string, string> = { arbeitnow: 'Europe' };

const KIND_LABEL: Record<SourceCatalogRow['kind'], string> = {
  board: 'Job board',
  aggregator: 'Aggregator',
  ats: 'Company careers',
  community: 'Community',
  capture: 'Added by you',
};

/** Where Jobbotix looks for roles, and whether each source is working. */
@Component({
  selector: 'jb-sources',
  imports: [
    Button,
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
      title="Sources"
      lead="Where Jobbotix looks for roles. Active sources are read four times a day, and every role links back to the board it came from."
    />

    <section class="jb-card mt-8 p-5 text-sm" aria-labelledby="follow-h">
      <h2 id="follow-h" class="font-semibold text-ink">Companies you follow</h2>
      <p class="mt-1 text-ink-muted">
        Jobbotix checks their careers pages every hour, so their roles reach you
        before the boards pick them up. Follow from a role page, or paste a
        careers link from Greenhouse, Lever, Ashby or Workable.
      </p>
      <form
        class="mt-3 flex flex-col gap-2 sm:flex-row"
        (submit)="$event.preventDefault(); addByLink()"
      >
        <label class="sr-only" for="follow-link">Careers page link</label>
        <input
          id="follow-link"
          class="jb-input min-w-0 flex-1"
          type="url"
          inputmode="url"
          placeholder="https://jobs.lever.co/company"
          [value]="link()"
          (input)="link.set($any($event.target).value); linkError.set('')"
        />
        <button
          type="submit"
          jbButton
          [busy]="adding()"
          [disabled]="adding() || !link().trim()"
        >
          Follow
        </button>
      </form>
      @if (linkError()) {
        <p class="mt-2 text-bad" role="alert">{{ linkError() }}</p>
      }
      @if (follows() === null) {
        <jb-skeleton class="mt-3 block" shape="line" [count]="2" />
      } @else if (follows()!.length) {
        <ul class="mt-4 flex flex-col divide-y divide-line">
          @for (f of follows(); track f.company.id) {
            <li
              class="flex flex-wrap items-center justify-between gap-2 py-2.5"
            >
              <div class="min-w-0">
                <p class="font-medium text-ink">
                  {{ f.company.name || f.company.ats_slug }}
                </p>
                <p class="text-xs text-ink-muted">
                  {{ atsLabel[f.company.ats_kind] }}
                  @if (f.company.last_polled_at) {
                    · {{ f.company.open_roles }} open
                    {{ f.company.open_roles === 1 ? 'role' : 'roles' }} ·
                    checked {{ f.company.last_polled_at | relativeDay }}
                  } @else {
                    · first check within the hour
                  }
                </p>
                @if (f.company.last_error) {
                  <p class="mt-0.5 break-words text-xs text-bad">
                    {{ f.company.last_error }}
                  </p>
                }
              </div>
              <button
                type="button"
                jbButton="ghost"
                size="sm"
                [disabled]="removing() === f.company.id"
                (click)="unfollow(f)"
              >
                Unfollow
              </button>
            </li>
          }
        </ul>
      } @else {
        <p class="mt-3 text-ink-faint">You don't follow any companies yet.</p>
      }
    </section>

    <div class="mt-8 flex flex-col gap-6">
      @if (error()) {
        <p class="text-sm text-bad" role="alert">{{ error() }}</p>
      } @else if (sources() === null) {
        <jb-skeleton shape="tile" [count]="4" />
      } @else if (!sources()!.length) {
        <jb-empty-state title="No sources yet" icon="compass">
          Sources appear here once the sourcing migrations are applied.
        </jb-empty-state>
      } @else {
        <p class="text-sm text-ink-muted">
          {{ activeCount() }} active
          {{ activeCount() === 1 ? 'source' : 'sources' }} · {{ lastNew() }} new
          postings in their latest runs
          @if (!homeCountry()) {
            ·
            <a
              routerLink="/search"
              class="underline decoration-line underline-offset-2 hover:text-brand-ink"
              >Set your country</a
            >
            so country-limited roles can be matched
          }
        </p>

        <ul class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          @for (s of sources(); track s.id) {
            <li class="jb-card flex flex-col gap-3 p-5 text-sm">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <a
                    class="font-semibold text-ink hover:text-brand-ink"
                    [href]="s.homepage"
                    target="_blank"
                    rel="noopener"
                    >{{ s.name }}</a
                  >
                  <p class="mt-0.5 text-xs text-ink-muted">
                    {{ kindLabel[s.kind] }} · {{ coverage(s) }}
                  </p>
                </div>
                @switch (health(s)) {
                  @case ('ok') {
                    <span
                      class="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-good"
                      ><jb-icon name="circle-check" [size]="14" /> Active</span
                    >
                  }
                  @case ('failing') {
                    <span
                      class="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-bad"
                      ><jb-icon name="circle-x" [size]="14" /> Failing</span
                    >
                  }
                  @case ('needs-key') {
                    <span
                      class="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-warn"
                      ><jb-icon name="key-round" [size]="14" /> Needs a
                      key</span
                    >
                  }
                  @case ('waiting') {
                    <span
                      class="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-ink-muted"
                      ><jb-icon name="clock" [size]="14" /> First run
                      pending</span
                    >
                  }
                  @default {
                    <span class="shrink-0 text-xs font-medium text-ink-muted"
                      >Off</span
                    >
                  }
                }
              </div>

              @if (s.last_run_at) {
                <p class="text-ink-muted">
                  Last read {{ s.last_run_at | relativeDay }}:
                  <span class="tabular-nums text-ink">{{
                    s.last_fetched
                  }}</span>
                  postings,
                  <span class="tabular-nums text-ink">{{ s.last_new }}</span>
                  new
                </p>
              }
              @if (s.last_error && health(s) === 'failing') {
                <p class="break-words text-xs text-bad">{{ s.last_error }}</p>
              }
              @if (s.attribution) {
                <p class="mt-auto text-xs text-ink-faint">
                  {{ s.attribution }}
                </p>
              }
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class SourcesPage {
  private readonly repo = inject(SourcesRepo);
  private readonly profiles = inject(SearchProfileRepo);
  private readonly watchlist = inject(WatchlistRepo);
  private readonly toast = inject(Toast);

  readonly atsLabel = ATS_LABEL;
  readonly follows = signal<FollowedCompany[] | null>(null);
  readonly link = signal('');
  readonly linkError = signal('');
  readonly adding = signal(false);
  readonly removing = signal<string | null>(null);

  readonly kindLabel = KIND_LABEL;
  readonly sources = signal<SourceCatalogRow[] | null>(null);
  readonly error = signal('');

  readonly activeCount = computed(
    () => (this.sources() ?? []).filter((s) => s.enabled).length,
  );
  readonly lastNew = computed(() =>
    (this.sources() ?? [])
      .filter((s) => s.enabled)
      .reduce((n, s) => n + s.last_new, 0),
  );
  readonly homeCountry = computed(
    () => this.profiles.profile()?.home_country ?? null,
  );

  constructor() {
    void this.profiles.load();
    this.repo
      .list()
      .then((rows) => this.sources.set(rows))
      .catch((e: Error) =>
        this.error.set(e.message || 'Could not load the sources'),
      );
    void this.loadFollows();
  }

  private async loadFollows() {
    try {
      this.follows.set(await this.watchlist.followed());
    } catch (e) {
      this.follows.set([]);
      this.linkError.set(
        `Could not load the companies you follow: ${(e as Error).message}`,
      );
    }
  }

  async addByLink() {
    const found = careersSystem(this.link());
    if (!found) {
      this.linkError.set(
        'That link is not a Greenhouse, Lever, Ashby or Workable careers page.',
      );
      return;
    }
    this.adding.set(true);
    try {
      const name = found.slug
        .split(/[-_.]+/)
        .filter(Boolean)
        .map((w) => w[0]!.toUpperCase() + w.slice(1))
        .join(' ');
      await this.watchlist.follow(found.kind, found.slug, name);
      this.link.set('');
      this.toast.success(`Following ${name} on ${ATS_LABEL[found.kind]}`);
      await this.loadFollows();
    } catch (e) {
      this.linkError.set(`Could not follow it: ${(e as Error).message}`);
    } finally {
      this.adding.set(false);
    }
  }

  async unfollow(f: FollowedCompany) {
    this.removing.set(f.company.id);
    try {
      await this.watchlist.unfollow(f.company.id);
      this.follows.update((l) =>
        (l ?? []).filter((x) => x.company.id !== f.company.id),
      );
      this.toast.show(
        `Stopped following ${f.company.name || f.company.ats_slug}`,
      );
    } catch (e) {
      this.toast.error(`Could not unfollow: ${(e as Error).message}`);
    } finally {
      this.removing.set(null);
    }
  }

  coverage(s: SourceCatalogRow): string {
    if (s.country) return countryName(s.country);
    if (s.kind === 'aggregator') return 'Searches your countries';
    return REACH[s.id] ?? 'Worldwide';
  }

  health(s: SourceCatalogRow): Health {
    if (!s.enabled) return s.access === 'keyed_api' ? 'needs-key' : 'off';
    if (!s.last_run_at) return 'waiting';
    return s.last_error ? 'failing' : 'ok';
  }
}
