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
  renderSearchPrompt,
  type EmploymentType,
  type SearchProfileRow,
} from '@jobbotix/shared-types';
import { Auth } from '../../core/auth';
import { SearchProfileRepo } from '../../core/data/repos';
import { Toast } from '../../shared/toast';
import { environment } from '../../../environments/environment';

const splitLines = (s: string) =>
  s
    .split(/\r?\n|,/)
    .map((x) => x.trim())
    .filter(Boolean);

/** What the daily run looks for, and the prompt that drives it. */
@Component({
  selector: 'jb-search-profile',
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="flex flex-col gap-8">
      <header>
        <h1 class="text-2xl font-semibold tracking-tight">Search profile</h1>
        <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
          What the daily run looks for. Save, then generate the prompt for your
          scheduled task.
        </p>
      </header>

      @if (!repo.loaded()) {
        <p class="text-sm text-neutral-500" role="status">Loading…</p>
      } @else {
        <form
          [formGroup]="form"
          (ngSubmit)="save()"
          class="grid gap-6 md:grid-cols-2"
          novalidate
        >
          <label class="flex flex-col gap-1 text-sm">
            <span
              >Target roles
              <span class="text-neutral-500"
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
              <span class="text-neutral-500"
                >(one per line, primary first)</span
              ></span
            >
            <textarea
              id="sp-stacks"
              formControlName="stacks"
              class="jb-input min-h-28"
            ></textarea>
          </label>

          <fieldset class="flex flex-col gap-2 text-sm">
            <legend class="jb-section-title mb-1">Remote</legend>
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
                <span class="text-neutral-500">(comma-separated)</span></span
              >
              <input
                id="sp-regions"
                type="text"
                formControlName="excludeRegions"
                class="jb-input"
              />
            </label>
          </fieldset>

          <fieldset class="flex flex-col gap-2 text-sm">
            <legend class="jb-section-title mb-1">Exclude</legend>
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
                class="jb-input jb-input-inline w-20"
              />
              days
            </label>
          </fieldset>

          <fieldset class="flex flex-col gap-2 text-sm">
            <legend class="jb-section-title mb-1">Employment</legend>
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

          <fieldset class="flex flex-col gap-2 text-sm">
            <legend class="jb-section-title mb-1">Digest</legend>
            <label class="flex items-center gap-2">
              Send the morning digest at
              <input
                id="sp-digest"
                type="time"
                formControlName="digestTime"
                class="jb-input jb-input-inline"
              />
            </label>
            <p class="text-neutral-500">
              In your timezone ({{ auth.profile()?.timezone || 'unknown' }}).
            </p>
          </fieldset>

          <div class="flex items-center gap-3 md:col-span-2">
            <button
              type="submit"
              class="jb-btn-primary"
              [disabled]="form.pristine || saving()"
            >
              {{ saving() ? 'Saving…' : 'Save profile' }}
            </button>
            @if (savedAt()) {
              <span class="text-sm text-neutral-500" role="status">Saved</span>
            }
          </div>
        </form>

        <section class="flex flex-col gap-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="jb-section-title">Scheduled-task prompt</h2>
            <div class="flex gap-2">
              <button
                type="button"
                class="jb-btn"
                (click)="newKey()"
                [disabled]="keyBusy()"
              >
                {{ keyBusy() ? 'Creating…' : 'New ingest key' }}
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
          <p class="text-sm text-neutral-600 dark:text-neutral-300">
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
            <p class="jb-letter font-mono text-xs" aria-label="Ingest key">
              {{ ingestKey() }}
            </p>
          }
          <pre class="jb-letter max-h-96 overflow-auto text-xs">{{
            prompt()
          }}</pre>
          <p class="text-xs text-neutral-500">
            Results arrive on
            <a routerLink="/today" class="underline">Today</a>. The run never
            submits applications.
          </p>
        </section>
      }
    </section>
  `,
  styles: `
    .jb-letter {
      white-space: pre-wrap;
      font: inherit;
      max-width: 100%;
      padding: 0.75rem;
      border: 1px solid rgb(229 229 229);
      border-radius: 0.5rem;
      background: rgb(250 250 250);
    }
    @media (prefers-color-scheme: dark) {
      .jb-letter {
        border-color: rgb(46 55 60);
        background: rgb(23 28 31);
      }
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
    visaRequired: new FormControl(true, { nonNullable: true }),
    nonEnglish: new FormControl(true, { nonNullable: true }),
    hybrid: new FormControl(true, { nonNullable: true }),
    junior: new FormControl(true, { nonNullable: true }),
    olderThanDays: new FormControl(45, { nonNullable: true }),
    fullTime: new FormControl(true, { nonNullable: true }),
    contract: new FormControl(true, { nonNullable: true }),
    minSeniority: new FormControl('senior', { nonNullable: true }),
    digestTime: new FormControl('06:45', { nonNullable: true }),
  });

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
    this.form.reset({
      targetRoles: p.target_roles.join('\n'),
      stacks: p.stacks.join('\n'),
      worldwide: remote['worldwide'] !== false,
      overlapOk: remote['timezone_overlap_ok'] !== false,
      excludeRegions: Array.isArray(remote['exclude_regions'])
        ? (remote['exclude_regions'] as string[]).join(', ')
        : '',
      visaRequired: excl['visa_required'] !== false,
      nonEnglish: excl['non_english'] !== false,
      hybrid: excl['hybrid_or_onsite'] !== false,
      junior: excl['junior_or_mid'] !== false,
      olderThanDays: Number(excl['older_than_days'] ?? 45),
      fullTime: p.employment_types.includes('full_time'),
      contract: p.employment_types.includes('contract'),
      minSeniority: p.min_seniority,
      digestTime: p.digest_time.slice(0, 5),
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
        scoring_weights: this.repo.profile()?.scoring_weights ?? {},
        employment_types,
        digest_time: v.digestTime,
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
