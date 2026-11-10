import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { formatUsd, summariseUsage } from '@jobbotix/shared-types';
import { LettersRepo, SettingsRepo } from '../../core/data/repos';
import { RelativeDayPipe } from '../../shared/format';
import { Toast } from '../../shared/toast';
import { Theme, type ThemePreference } from '../../core/theme';
import { Tour } from '../../shell/tour';
import { AiConnections } from './ai-connections';
import { DataPanel } from './data-panel';
import { PlanCard } from './plan-card';
import {
  Button,
  Confirm,
  Icon,
  PageHeader,
  Tabs,
  type TabItem,
} from '../../ui';

/** Account, AI connections, usage, voice samples, ingest keys. */
@Component({
  selector: 'jb-settings',
  imports: [
    AiConnections,
    DataPanel,
    PlanCard,
    Button,
    Icon,
    PageHeader,
    ReactiveFormsModule,
    RelativeDayPipe,
    RouterLink,
    Tabs,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <jb-page-header
      title="Settings"
      lead="Your account, appearance, AI connections and the keys your scheduled runs use."
    >
      <div actions>
        <button type="button" jbButton (click)="tour.start()">
          <jb-icon name="compass" /> Take the tour
        </button>
      </div>
    </jb-page-header>
    <section class="mt-8 flex max-w-3xl flex-col gap-5">
      <!-- Profile -->
      <form
        [formGroup]="profileForm"
        (ngSubmit)="saveProfile()"
        class="jb-card flex flex-col gap-4 p-5 md:p-6"
        novalidate
      >
        <h2 class="jb-section-title">Account</h2>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label class="flex flex-col gap-1 text-sm"
            ><span>Name</span
            ><input
              id="st-name"
              class="jb-input"
              formControlName="name"
              autocomplete="name"
          /></label>
          <label class="flex flex-col gap-1 text-sm">
            <span
              >Timezone
              <span class="text-ink-muted">(for the digest hour)</span></span
            >
            <input
              id="st-tz"
              class="jb-input"
              formControlName="timezone"
              list="tz-list"
            />
            <datalist id="tz-list">
              @for (tz of timezones; track tz) {
                <option [value]="tz"></option>
              }
            </datalist>
          </label>
        </div>
        <p class="text-sm text-ink-muted">
          Signed in as {{ repo.profile()?.email }}
        </p>
        <div>
          <button
            type="submit"
            class="jb-btn-primary"
            [disabled]="profileForm.pristine || busy()"
          >
            Save
          </button>
        </div>
      </form>

      <jb-plan-card />

      <!-- Appearance -->
      <section
        class="jb-card flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between md:p-6"
      >
        <div>
          <h2 class="jb-section-title">Appearance</h2>
          <p class="mt-1 text-sm text-ink-muted">
            Match your system, or keep Jobbotix light or dark.
          </p>
        </div>
        <jb-tabs
          variant="segmented"
          prefix="appearance"
          [controls]="false"
          label="Theme"
          [tabs]="themes"
          [value]="theme.preference()"
          (valueChange)="theme.set($any($event))"
        />
      </section>

      <jb-ai-connections />

      <!-- Usage -->
      <section class="jb-card flex flex-col gap-3 p-5 md:p-6">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 class="jb-section-title">AI usage on your keys</h2>
          <a jbButton="ghost" size="sm" routerLink="/usage"
            >See usage <jb-icon name="arrow-up-right" [size]="16"
          /></a>
        </div>
        @if (usageMonth().calls === 0) {
          <p class="text-sm text-ink-muted">No AI calls in the last 30 days.</p>
        } @else {
          <p class="text-sm text-ink-muted">
            Last 30 days: {{ usageMonth().calls }} calls, about
            <span class="font-medium text-ink">{{ usageMonth().cost }}</span>
            at list prices.
          </p>
        }
      </section>

      <!-- Voice samples -->
      <section class="jb-card flex flex-col gap-3 p-5 md:p-6">
        <h2 class="jb-section-title">Voice samples</h2>
        <p class="text-sm text-ink-muted">
          Up to three cover letters or emails you wrote yourself. Drafts copy
          their tone (sentence length, directness), never their content. The
          oldest is replaced when you add a fourth.
        </p>
        @for (v of letters.voiceSamples(); track v.id) {
          <article
            class="rounded-control border border-line bg-sunken p-3.5 text-sm"
          >
            <div class="flex items-start justify-between gap-2">
              <span class="text-xs text-ink-muted"
                >{{ v.word_count ?? 0 }} words · added
                {{ v.created_at | relativeDay }}</span
              >
              <button
                type="button"
                class="jb-btn jb-btn-ghost jb-btn-sm"
                (click)="removeSample(v.id)"
                [disabled]="busy()"
              >
                Remove
              </button>
            </div>
            <p class="mt-1 line-clamp-3 whitespace-pre-line">{{ v.body }}</p>
          </article>
        }
        <form
          (ngSubmit)="addSample()"
          [formGroup]="sampleForm"
          novalidate
          class="flex flex-col gap-2"
        >
          <textarea
            id="st-sample"
            class="jb-input min-h-28 text-sm"
            formControlName="body"
            placeholder="Paste a letter or a longer email you wrote…"
          ></textarea>
          <div>
            <button
              type="submit"
              class="jb-btn"
              [disabled]="sampleForm.invalid || busy()"
            >
              Add sample
            </button>
          </div>
        </form>
      </section>

      <!-- Ingest keys -->
      <section class="jb-card flex flex-col gap-3 p-5 md:p-6">
        <h2 class="jb-section-title">Ingest keys</h2>
        <p class="text-sm text-ink-muted">
          Each key lets one scheduled task post results under your account.
          Create one from
          <a routerLink="/search" class="text-brand-ink underline"
            >Search profile</a
          >; revoke it here if it leaks.
        </p>
        @if (repo.ingestKeys().length === 0) {
          <p class="text-sm text-ink-muted">No keys yet.</p>
        } @else {
          <ul class="divide-y divide-line text-sm">
            @for (k of repo.ingestKeys(); track k.id) {
              <li
                class="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <span>
                  {{ k.label }} · created {{ k.created_at | relativeDay }}
                  @if (k.last_used_at) {
                    · last used {{ k.last_used_at | relativeDay }}
                  }
                  @if (k.revoked_at) {
                    <span class="jb-tag ml-1 bg-bad-tint text-bad"
                      >Revoked</span
                    >
                  }
                </span>
                @if (!k.revoked_at) {
                  <button
                    type="button"
                    class="jb-btn jb-btn-sm text-bad"
                    (click)="revoke(k.id)"
                    [disabled]="busy()"
                  >
                    Revoke
                  </button>
                }
              </li>
            }
          </ul>
        }
      </section>

      <jb-data-panel />
    </section>
  `,
})
export class Settings {
  protected readonly theme = inject(Theme);
  protected readonly tour = inject(Tour);
  private readonly confirm = inject(Confirm);
  protected readonly themes: TabItem<ThemePreference>[] = [
    { id: 'system', label: 'System', icon: 'monitor' },
    { id: 'light', label: 'Light', icon: 'sun' },
    { id: 'dark', label: 'Dark', icon: 'moon' },
  ];

  protected readonly repo = inject(SettingsRepo);
  protected readonly letters = inject(LettersRepo);
  readonly sampleForm = new FormGroup({
    body: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(80)],
    }),
  });
  private readonly toast = inject(Toast);

  readonly busy = signal(false);
  readonly timezones: string[] =
    (
      Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
    ).supportedValuesOf?.('timeZone') ?? [];

  readonly profileForm = new FormGroup({
    name: new FormControl('', { nonNullable: true }),
    timezone: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });
  readonly usageMonth = computed(() => {
    const t = summariseUsage(this.repo.usage(), 30).total;
    return { calls: t.calls, cost: formatUsd(t.cost) };
  });

  constructor() {
    void this.repo.load();
    void this.letters.load();
    effect(() => {
      const p = this.repo.profile();
      if (p)
        untracked(() =>
          this.profileForm.reset({ name: p.name, timezone: p.timezone }),
        );
    });
  }

  async saveProfile() {
    if (this.profileForm.invalid || this.busy()) return;
    this.busy.set(true);
    try {
      await this.repo.updateProfile(this.profileForm.getRawValue());
      this.profileForm.markAsPristine();
      this.toast.show('Saved');
    } catch (e) {
      this.toast.show((e as Error).message || 'Could not save');
    } finally {
      this.busy.set(false);
    }
  }

  async addSample() {
    if (this.sampleForm.invalid || this.busy()) return;
    this.busy.set(true);
    try {
      await this.letters.addVoiceSample(this.sampleForm.controls.body.value);
      this.sampleForm.reset();
      this.toast.show('Sample added');
    } catch (e) {
      this.toast.show((e as Error).message || 'Could not add the sample');
    } finally {
      this.busy.set(false);
    }
  }

  async removeSample(id: string) {
    const ok = await this.confirm.ask({
      title: 'Remove this voice sample?',
      body: 'Drafts stop copying its tone.',
      action: 'Remove sample',
      danger: true,
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      await this.letters.removeVoiceSample(id);
    } finally {
      this.busy.set(false);
    }
  }

  async revoke(id: string) {
    const ok = await this.confirm.ask({
      title: 'Revoke this ingest key?',
      body: 'Any scheduled task using it stops posting results until you give it a new key.',
      action: 'Revoke key',
      danger: true,
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      await this.repo.revokeIngestKey(id);
      this.toast.show('Key revoked');
    } finally {
      this.busy.set(false);
    }
  }
}
