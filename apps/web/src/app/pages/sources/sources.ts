import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { countryName, type SourceCatalogRow } from '@jobbotix/shared-types';
import { SearchProfileRepo, SourcesRepo } from '../../core/data/repos';
import { RelativeDayPipe } from '../../shared/format';
import { EmptyState, Icon, PageHeader, Skeleton } from '../../ui';

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
