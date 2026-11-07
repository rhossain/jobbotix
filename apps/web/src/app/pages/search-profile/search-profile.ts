import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  DEFAULT_SCORING_WEIGHTS,
  SCORING_WEIGHT_LABELS,
  countryName,
  countryOptions,
  parseCountryList,
  renderSearchPrompt,
  resolveScoringWeights,
  type EmploymentType,
  type ScoringWeights,
  type SearchProfileRow,
} from '@jobbotix/shared-types';
import { Auth } from '../../core/auth';
import { SearchProfileRepo } from '../../core/data/repos';
import { Toast } from '../../shared/toast';
import { CopyButton, Icon, PageHeader, Skeleton } from '../../ui';
import { environment } from '../../../environments/environment';

const splitLines = (s: string) =>
  s
    .split(/\r?\n|,/)
    .map((x) => x.trim())
    .filter(Boolean);

/** What the daily run looks for, and the prompt that drives it. */
@Component({
  selector: 'jb-search-profile',
  imports: [
    CopyButton,
    Icon,
    PageHeader,
    ReactiveFormsModule,
    RouterLink,
    Skeleton,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <jb-page-header
      title="Search profile"
      lead="What Jobbotix looks for. New postings from every source are matched against this profile each hour; saving a change re-checks the last three days."
    />
    <section class="mt-8 flex flex-col gap-6">
      @if (!repo.loaded()) {
        <jb-skeleton shape="tile" [count]="3" />
      } @else {
        <form
          [formGroup]="form"
          (ngSubmit)="save()"
          data-tour="search-profile"
          class="jb-card grid grid-cols-1 gap-6 p-5 md:grid-cols-2 md:gap-x-8 md:p-7"
          novalidate
        >
          <label class="flex flex-col gap-1 text-sm">
            <span
              >Target roles
              <span class="text-ink-muted"
                >(one per line, best first)</span
              ></span
            >
            <textarea
              id="sp-roles"
              formControlName="targetRoles"
              class="jb-input min-h-28"
            ></textarea>
          </label>
          <label class="flex flex-col gap-1 text-sm">
            <span
              >Stacks you work in
              <span class="text-ink-muted"
                >(one per line, primary first)</span
              ></span
            >
            <textarea
              id="sp-stacks"
              formControlName="stacks"
              class="jb-input min-h-28"
            ></textarea>
          </label>

          <fieldset class="jb-sp-group flex flex-col gap-2.5 text-sm">
            <legend class="jb-section-title mb-2">Remote</legend>
            <label class="flex items-center gap-2"
              ><input
                id="sp-worldwide"
                type="checkbox"
                formControlName="worldwide"
              />
              Must be fully remote, hiring worldwide</label
            >
            <label class="flex items-center gap-2"
              ><input
                id="sp-overlap"
                type="checkbox"
                formControlName="overlapOk"
              />
              Timezone-overlap requirements are fine</label
            >
            <label class="flex flex-col gap-1">
              <span
                >Skip roles limited to these regions
                <span class="text-ink-muted">(comma-separated)</span></span
              >
              <input
                id="sp-regions"
                type="text"
                formControlName="excludeRegions"
                class="jb-input"
              />
            </label>
          </fieldset>

          <fieldset class="jb-sp-group flex flex-col gap-2.5 text-sm">
            <legend class="jb-section-title mb-2">Where you can work</legend>
            <label class="flex flex-col gap-1">
              <span>Country you live in</span>
              <select
                id="sp-home-country"
                formControlName="homeCountry"
                class="jb-input"
              >
                <option value="">Not set</option>
                @for (c of countries; track c.code) {
                  <option [value]="c.code">{{ c.name }}</option>
                }
              </select>
            </label>
            <label class="flex flex-col gap-1">
              <span
                >Other countries you can work for
                <span class="text-ink-muted">(comma-separated)</span></span
              >
              <input
                id="sp-allowed-countries"
                type="text"
                formControlName="allowedCountries"
                class="jb-input"
                placeholder="e.g. United Arab Emirates, Germany"
              />
            </label>
            <p class="text-ink-muted">
              Roles open only to certain countries or regions are kept when they
              include one of these; the rest are skipped with the reason shown.
            </p>
          </fieldset>

          <fieldset class="jb-sp-group flex flex-col gap-2.5 text-sm">
            <legend class="jb-section-title mb-2">Exclude</legend>
            <label class="flex items-center gap-2"
              ><input
                id="sp-visa"
                type="checkbox"
                formControlName="visaRequired"
              />
              Roles needing residency, work authorization or a visa</label
            >
            <label class="flex items-center gap-2"
              ><input
                id="sp-lang"
                type="checkbox"
                formControlName="nonEnglish"
              />
              Roles needing a language other than English</label
            >
            <label class="flex items-center gap-2"
              ><input id="sp-hybrid" type="checkbox" formControlName="hybrid" />
              On-site or hybrid roles</label
            >
            <label class="flex items-center gap-2"
              ><input id="sp-junior" type="checkbox" formControlName="junior" />
              Junior and mid-level roles</label
            >
            <label class="flex items-center gap-2">
              Postings older than
              <input
                id="sp-days"
                type="number"
                min="7"
                max="120"
                formControlName="olderThanDays"
                class="jb-input jb-input-inline w-24"
              />
              days
            </label>
          </fieldset>

          <fieldset class="jb-sp-group flex flex-col gap-2.5 text-sm">
            <legend class="jb-section-title mb-2">Employment</legend>
            <label class="flex items-center gap-2"
              ><input id="sp-ft" type="checkbox" formControlName="fullTime" />
              Full-time</label
            >
            <label class="flex items-center gap-2"
              ><input id="sp-ct" type="checkbox" formControlName="contract" />
              Contract and freelance</label
            >
            <label class="flex items-center gap-2">
              Minimum seniority
              <select
                id="sp-seniority"
                formControlName="minSeniority"
                class="jb-input jb-input-inline"
              >
                <option value="mid">Mid</option>
                <option value="senior">Senior</option>
                <option value="lead">Lead</option>
              </select>
            </label>
          </fieldset>

          <fieldset class="jb-sp-group flex flex-col gap-2.5 text-sm">
            <legend class="jb-section-title mb-2">Digest</legend>
            <label class="flex items-center gap-2">
              <input
                id="sp-digest-on"
                type="checkbox"
                formControlName="digestEnabled"
              />
              Email me a morning digest
            </label>
            <label class="flex items-center gap-2">
              at
              <input
                id="sp-digest"
                type="time"
                formControlName="digestTime"
                class="jb-input jb-input-inline"
              />
              <span class="text-ink-muted"
                >({{ auth.profile()?.timezone || 'your timezone' }})</span
              >
            </label>
            <div
              class="flex flex-wrap items-center gap-1.5"
              role="group"
              aria-label="Digest days"
            >
              <span class="mr-1">on</span>
              @for (d of weekdays; track d.n) {
                <button
                  type="button"
                  class="jb-chip"
                  [attr.aria-pressed]="digestDays().includes(d.n)"
                  (click)="toggleDay(d.n)"
                >
                  {{ d.label }}
                </button>
              }
            </div>
            <label class="flex items-center gap-2">
              Only roles scoring at least
              <input
                id="sp-digest-min"
                type="number"
                min="0"
                max="100"
                step="5"
                formControlName="digestMinScore"
                class="jb-input jb-input-inline w-24"
              />
            </label>
            <p class="text-ink-muted">
              The run itself still records every role; this only shapes the
              email.
            </p>
            <label class="mt-2 flex flex-wrap items-center gap-2">
              Email me right away when a new role scores at least
              <input
                id="sp-alert-min"
                type="number"
                min="0"
                max="100"
                step="5"
                formControlName="alertMinScore"
                class="jb-input jb-input-inline w-24"
                placeholder="Off"
              />
            </label>
            <p class="text-ink-muted">
              Leave it empty for no instant alerts. Checked every hour, as new
              roles are filed.
            </p>
          </fieldset>

          <fieldset
            class="jb-sp-group flex flex-col gap-2.5 text-sm md:col-span-2"
          >
            <legend
              class="jb-section-title mb-2 flex w-full items-center justify-between gap-3"
            >
              Scoring
              <button
                type="button"
                class="jb-btn jb-btn-ghost jb-btn-sm"
                (click)="resetWeights()"
              >
                Reset to defaults
              </button>
            </legend>
            <p class="text-ink-muted">
              Points each signal adds to a posting's score. Penalties are
              negative. The run follows these numbers.
            </p>
            <div
              class="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2"
              formGroupName="weights"
            >
              @for (k of weightKeys; track k) {
                <label class="flex items-center justify-between gap-3">
                  <span>{{ weightLabels[k] }}</span>
                  <input
                    [id]="'sp-w-' + k"
                    type="number"
                    min="-50"
                    max="50"
                    step="1"
                    [formControlName]="k"
                    class="jb-input jb-input-inline w-24 text-right"
                  />
                </label>
              }
            </div>
          </fieldset>

          <div
            class="flex items-center gap-3 border-t border-line pt-5 md:col-span-2"
          >
            <button
              type="submit"
              class="jb-btn-primary jb-btn-lg"
              [attr.aria-busy]="saving() ? 'true' : null"
              [disabled]="form.pristine || saving()"
            >
              Save profile
            </button>
            @if (savedAt() && form.pristine) {
              <span
                class="inline-flex items-center gap-1.5 text-sm text-good"
                role="status"
              >
                <jb-icon name="circle-check" [size]="17" /> Saved
              </span>
            }
          </div>
        </form>

        <section class="jb-card flex flex-col gap-4 p-5 md:p-7">
          <div
            class="flex flex-wrap items-center justify-between gap-3"
            data-tour="search-prompt"
          >
            <h2 class="jb-section-title">Scheduled-task prompt</h2>
            <div class="flex gap-2">
              <button
                type="button"
                class="jb-btn"
                [attr.aria-busy]="keyBusy() ? 'true' : null"
                [disabled]="keyBusy()"
                (click)="newKey()"
              >
                <jb-icon name="key-round" /> New ingest key
              </button>
              <button
                type="button"
                class="jb-btn-primary"
                (click)="copyPrompt()"
              >
                Copy prompt
              </button>
            </div>
          </div>
          <p class="text-sm text-ink-muted">
            Paste this into a Claude scheduled task that runs every morning. It
            searches, scores, drafts and posts the results here.
            @if (ingestKey()) {
              Your new ingest key is shown once below; it is already in the
              prompt.
            } @else {
              Create an ingest key first; the prompt uses it to post results
              under your account.
            }
          </p>
          @if (ingestKey()) {
            <div
              class="flex flex-col gap-2 rounded-control bg-signal-tint p-3.5 sm:flex-row sm:items-center"
            >
              <p
                class="min-w-0 flex-1 font-mono text-xs break-all text-ink"
                aria-label="Ingest key"
              >
                {{ ingestKey() }}
              </p>
              <jb-copy-button
                [text]="ingestKey()"
                label="Copy key"
                size="sm"
                confirm="Ingest key copied"
              />
            </div>
            <p class="text-xs text-signal-ink">
              Shown once. Copy it now if you need it elsewhere.
            </p>
          }
          <pre
            class="jb-letter max-h-96 max-w-none overflow-auto font-mono text-xs"
            tabindex="0"
            aria-label="Scheduled-task prompt"
            >{{ prompt() }}</pre>
          <p class="text-xs text-ink-muted">
            Results arrive on
            <a routerLink="/today" class="text-brand-ink underline">Today</a>.
            The run never submits applications.
          </p>
        </section>
      }
    </section>
  `,
  styles: `
    .jb-sp-group {
      min-width: 0;
      margin: 0;
      padding: 1rem;
      border: 1px solid var(--line);
      border-radius: var(--r-card);
      background: color-mix(in srgb, var(--surface-sunken) 45%, var(--surface));
    }
    .jb-sp-group > legend {
      float: left;
      width: 100%;
      padding: 0;
    }
    .jb-sp-group > legend + * {
      clear: both;
    }
  `,
})
export class SearchProfile {
  protected readonly repo = inject(SearchProfileRepo);
  protected readonly auth = inject(Auth);
  private readonly toast = inject(Toast);

  readonly saving = signal(false);
  readonly savedAt = signal<number | null>(null);
  readonly keyBusy = signal(false);
  readonly ingestKey = signal('');

  readonly form = new FormGroup({
    targetRoles: new FormControl('', { nonNullable: true }),
    stacks: new FormControl('', { nonNullable: true }),
    worldwide: new FormControl(true, { nonNullable: true }),
    overlapOk: new FormControl(true, { nonNullable: true }),
    excludeRegions: new FormControl('', { nonNullable: true }),
    homeCountry: new FormControl('', { nonNullable: true }),
    allowedCountries: new FormControl('', { nonNullable: true }),
    visaRequired: new FormControl(true, { nonNullable: true }),
    nonEnglish: new FormControl(true, { nonNullable: true }),
    hybrid: new FormControl(true, { nonNullable: true }),
    junior: new FormControl(true, { nonNullable: true }),
    olderThanDays: new FormControl(45, { nonNullable: true }),
    fullTime: new FormControl(true, { nonNullable: true }),
    contract: new FormControl(true, { nonNullable: true }),
    minSeniority: new FormControl('senior', { nonNullable: true }),
    digestTime: new FormControl('06:45', { nonNullable: true }),
    digestEnabled: new FormControl(true, { nonNullable: true }),
    digestMinScore: new FormControl(0, { nonNullable: true }),
    alertMinScore: new FormControl<number | null>(null),
    weights: new FormGroup(
      Object.fromEntries(
        (Object.keys(DEFAULT_SCORING_WEIGHTS) as (keyof ScoringWeights)[]).map(
          (k) => [
            k,
            new FormControl(DEFAULT_SCORING_WEIGHTS[k], { nonNullable: true }),
          ],
        ),
      ) as Record<keyof ScoringWeights, FormControl<number>>,
    ),
  });

  readonly countries = countryOptions();

  readonly weekdays = [
    { n: 1, label: 'Mon' },
    { n: 2, label: 'Tue' },
    { n: 3, label: 'Wed' },
    { n: 4, label: 'Thu' },
    { n: 5, label: 'Fri' },
    { n: 6, label: 'Sat' },
    { n: 7, label: 'Sun' },
  ];
  readonly digestDays = signal<number[]>([1, 2, 3, 4, 5, 6, 7]);

  toggleDay(n: number) {
    this.digestDays.update((ds) =>
      ds.includes(n) ? ds.filter((x) => x !== n) : [...ds, n],
    );
    this.form.markAsDirty();
  }

  readonly weightKeys = Object.keys(
    DEFAULT_SCORING_WEIGHTS,
  ) as (keyof ScoringWeights)[];
  readonly weightLabels = SCORING_WEIGHT_LABELS;

  resetWeights() {
    this.form.controls.weights.setValue({ ...DEFAULT_SCORING_WEIGHTS });
    this.form.controls.weights.markAsDirty();
  }

  /** The prompt follows the saved profile, not unsaved edits, so what you copy is what runs. */
  readonly prompt = computed(() => {
    const p = this.repo.profile();
    if (!p) return 'Save a search profile to generate the prompt.';
    const me = this.auth.profile();
    return renderSearchPrompt(p, {
      about: `${me?.name || 'The candidate'} (${me?.email ?? ''}), based in ${me?.timezone ?? 'their timezone'}. Primary stack: ${p.stacks[0] ?? 'see below'}.`,
      ingestUrl: `${environment.supabaseUrl}/functions/v1/ingest-roles`,
      ingestKeyPlaceholder: this.ingestKey() || undefined,
    });
  });

  constructor() {
    void this.repo.load();
    effect(() => {
      const p = this.repo.profile();
      if (p) untracked(() => this.fill(p));
    });
  }

  private fill(p: SearchProfileRow) {
    const remote = (p.remote_rules ?? {}) as Record<string, unknown>;
    const excl = (p.exclusions ?? {}) as Record<string, unknown>;
    this.digestDays.set(
      p.digest_days?.length ? [...p.digest_days] : [1, 2, 3, 4, 5, 6, 7],
    );
    this.form.reset({
      targetRoles: p.target_roles.join('\n'),
      stacks: p.stacks.join('\n'),
      worldwide: remote['worldwide'] !== false,
      overlapOk: remote['timezone_overlap_ok'] !== false,
      excludeRegions: Array.isArray(remote['exclude_regions'])
        ? (remote['exclude_regions'] as string[]).join(', ')
        : '',
      homeCountry: p.home_country ?? '',
      allowedCountries: (p.allowed_countries ?? []).map(countryName).join(', '),
      visaRequired: excl['visa_required'] !== false,
      nonEnglish: excl['non_english'] !== false,
      hybrid: excl['hybrid_or_onsite'] !== false,
      junior: excl['junior_or_mid'] !== false,
      olderThanDays: Number(excl['older_than_days'] ?? 45),
      fullTime: p.employment_types.includes('full_time'),
      contract: p.employment_types.includes('contract'),
      minSeniority: p.min_seniority,
      digestTime: p.digest_time.slice(0, 5),
      digestEnabled: p.digest_enabled !== false,
      digestMinScore: p.digest_min_score ?? 0,
      alertMinScore: p.alert_min_score ?? null,
      weights: resolveScoringWeights(p.scoring_weights),
    });
  }

  async save() {
    if (this.saving()) return;
    const v = this.form.getRawValue();
    const employment_types: EmploymentType[] = [
      ...(v.fullTime ? (['full_time'] as const) : []),
      ...(v.contract ? (['contract'] as const) : []),
    ];
    if (!employment_types.length) {
      this.toast.show('Pick at least one employment type');
      return;
    }
    const allowed = parseCountryList(v.allowedCountries);
    if (allowed.unknown.length) {
      this.toast.show(`Not a country we know: ${allowed.unknown.join(', ')}`);
      return;
    }
    this.saving.set(true);
    try {
      await this.repo.save({
        name: this.repo.profile()?.name ?? 'Default',
        target_roles: splitLines(v.targetRoles),
        stacks: splitLines(v.stacks),
        remote_rules: {
          worldwide: v.worldwide,
          timezone_overlap_ok: v.overlapOk,
          exclude_regions: splitLines(v.excludeRegions),
        },
        exclusions: {
          visa_required: v.visaRequired,
          non_english: v.nonEnglish,
          hybrid_or_onsite: v.hybrid,
          junior_or_mid: v.junior,
          older_than_days: v.olderThanDays,
        },
        languages: ['english'],
        min_seniority: v.minSeniority,
        scoring_weights: resolveScoringWeights(v.weights),
        employment_types,
        digest_time: v.digestTime,
        digest_days: [...this.digestDays()].sort(),
        digest_min_score: Math.min(
          100,
          Math.max(0, Number(v.digestMinScore) || 0),
        ),
        digest_enabled: v.digestEnabled,
        home_country: v.homeCountry || null,
        allowed_countries: allowed.codes.filter((c) => c !== v.homeCountry),
        remote_only: v.hybrid,
        alert_min_score:
          v.alertMinScore === null || String(v.alertMinScore) === ''
            ? null
            : Math.min(100, Math.max(0, Number(v.alertMinScore) || 0)),
      });
      this.form.markAsPristine();
      this.savedAt.set(Date.now());
      this.toast.show('Search profile saved');
    } catch (e) {
      this.toast.show((e as Error).message || 'Could not save');
    } finally {
      this.saving.set(false);
    }
  }

  async newKey() {
    this.keyBusy.set(true);
    try {
      this.ingestKey.set(await this.repo.createIngestKey('Daily job search'));
      this.toast.show(
        'Ingest key created. Copy the prompt now; the key is not shown again.',
      );
    } catch {
      this.toast.show('Could not create a key');
    } finally {
      this.keyBusy.set(false);
    }
  }

  async copyPrompt() {
    try {
      await navigator.clipboard.writeText(this.prompt());
      this.toast.show('Prompt copied');
    } catch {
      this.toast.show('Select the prompt text and copy it manually');
    }
  }
}
