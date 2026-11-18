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
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { formatUsd, summariseUsage } from '@jobbotix/shared-types';
import { LettersRepo, SettingsRepo } from '../../core/data/repos';
import { RelativeDayPipe } from '../../shared/format';
import { PageTabs, type PageTab } from '../../shared/page-tabs';
import { Toast } from '../../shared/toast';
import { Theme, type ThemePreference } from '../../core/theme';
import { ShellState } from '../../shell/shell-state';
import { Tour } from '../../shell/tour';
import { AiConnections } from './ai-connections';
import { DataPanel } from './data-panel';
import { LinkedInCard } from './linkedin-card';
import { PlanCard } from './plan-card';
import { SupportAccess } from './support-access';
import {
  Button,
  Confirm,
  Icon,
  PageHeader,
  Tabs,
  tabIds,
  type TabItem,
} from '../../ui';

export type SettingsTab = 'account' | 'ai' | 'linkedin' | 'data';

/** The section an address names; anything unknown is the first one. */
export function settingsTab(raw: string | null): SettingsTab {
  return raw === 'ai' || raw === 'linkedin' || raw === 'data' ? raw : 'account';
}

/**
 * Settings, in four tabs, each at its own address: Account (name, plan,
 * look), AI (providers, voice samples, usage, access keys), LinkedIn, and
 * Your data (support access, downloads, imports, deleting the account).
 */
@Component({
  selector: 'jb-settings',
  imports: [
    AiConnections,
    DataPanel,
    LinkedInCard,
    PageTabs,
    PlanCard,
    SupportAccess,
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
    <jb-page-header title="Settings" [lead]="leads[tab()]">
      <div actions>
        <button type="button" jbButton (click)="tour.start()">
          <jb-icon name="compass" /> Take the tour
        </button>
      </div>
    </jb-page-header>
    <jb-page-tabs
      class="mt-6 max-w-3xl"
      prefix="settings"
      label="Settings sections"
      [tabs]="tabs"
      [current]="tab()"
    />
    <section
      class="mt-6 flex max-w-3xl flex-col gap-5"
      role="tabpanel"
      [id]="ids().panel"
      [attr.aria-labelledby]="ids().tab"
    >
      @switch (tab()) {
        @case ('ai') {
          <jb-ai-connections />

          <!-- Voice samples -->
          <section class="jb-card flex flex-col gap-3 p-5 md:p-6">
            <h2 class="jb-section-title">Voice samples</h2>
            <p class="text-sm text-ink-muted">
              Up to three cover letters or emails you wrote yourself. Drafts
              copy their tone (sentence length, directness), never their
              content. The oldest is replaced when you add a fourth.
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
                <p class="mt-1 line-clamp-3 whitespace-pre-line">
                  {{ v.body }}
                </p>
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

          <!-- Advanced: things most people never need -->
          <section class="flex flex-col gap-6" id="advanced">
            <div>
              <button
                type="button"
                class="jb-btn jb-btn-ghost"
                aria-controls="settings-advanced"
                [attr.aria-expanded]="advancedOpen()"
                (click)="advancedOpen.set(!advancedOpen())"
              >
                <jb-icon
                  [name]="advancedOpen() ? 'chevron-up' : 'chevron-down'"
                />
                Advanced
              </button>
              @if (!advancedOpen()) {
                <p class="mt-1 text-sm text-ink-muted">
                  AI usage and cost, choosing the AI model, and access keys for
                  your own automated search. Most people never need these.
                </p>
              }
            </div>
            @if (advancedOpen()) {
              <div id="settings-advanced" class="flex flex-col gap-6">
                <section class="jb-card p-5 md:p-6">
                  <label class="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      class="mt-1"
                      [checked]="shell.chooseModel()"
                      (change)="
                        shell.setChooseModel($any($event.target).checked)
                      "
                    />
                    <span>
                      <span class="jb-section-title block"
                        >Let me choose the AI model</span
                      >
                      <span class="mt-1 block text-sm text-ink-muted">
                        Shows a list of AI models beside each Draft button. Left
                        off, Jobbotix picks one for you.
                      </span>
                    </span>
                  </label>
                </section>

                <!-- Usage -->
                <section class="jb-card flex flex-col gap-3 p-5 md:p-6">
                  <div
                    class="flex flex-wrap items-center justify-between gap-3"
                  >
                    <h2 class="jb-section-title">AI usage on your keys</h2>
                    <a jbButton="ghost" size="sm" routerLink="/usage"
                      >See usage <jb-icon name="arrow-up-right" [size]="16"
                    /></a>
                  </div>
                  @if (usageMonth().calls === 0) {
                    <p class="text-sm text-ink-muted">
                      No AI calls in the last 30 days.
                    </p>
                  } @else {
                    <p class="text-sm text-ink-muted">
                      Last 30 days: {{ usageMonth().calls }} calls, about
                      <span class="font-medium text-ink">{{
                        usageMonth().cost
                      }}</span>
                      at list prices.
                    </p>
                  }
                </section>

                <!-- Ingest keys -->
                <section class="jb-card flex flex-col gap-3 p-5 md:p-6">
                  <h2 class="jb-section-title">Access keys</h2>
                  <p class="text-sm text-ink-muted">
                    Only needed if you set up your own automated search. Each
                    key lets one task add jobs to your account. Create one from
                    <a routerLink="/search" class="text-brand-ink underline"
                      >Job preferences</a
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
                            {{ k.label }} · created
                            {{ k.created_at | relativeDay }}
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
              </div>
            }
          </section>
        }
        @case ('linkedin') {
          <jb-linkedin-card />
        }
        @case ('data') {
          <jb-support-access />

          <jb-data-panel />
        }
        @default {
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
                  <span class="text-ink-muted"
                    >(for the daily email)</span
                  ></span
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

          <!-- Keyboard shortcuts: hidden on phones, which have no keyboard -->
          <section class="jb-card hidden p-5 md:block md:p-6">
            <label class="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                class="mt-1"
                [checked]="shell.shortcutHints()"
                (change)="shell.setShortcutHints($any($event.target).checked)"
              />
              <span>
                <span class="jb-section-title block"
                  >Show keyboard shortcuts</span
                >
                <span class="mt-1 block text-sm text-ink-muted">
                  Shows the shortcut letters beside each menu item. The
                  shortcuts work either way; press ? to see them all.
                </span>
              </span>
            </label>
          </section>
        }
      }
    </section>
  `,
})
export class Settings {
  private readonly route = inject(ActivatedRoute);
  /** The section shown: /settings, /settings/ai, /settings/linkedin, /settings/data. */
  protected readonly tab = toSignal(
    this.route.paramMap.pipe(map((p) => settingsTab(p.get('tab')))),
    { initialValue: settingsTab(this.route.snapshot.paramMap.get('tab')) },
  );
  protected readonly tabs: PageTab<SettingsTab>[] = [
    { id: 'account', label: 'Account', icon: 'circle-user', link: '/settings' },
    { id: 'ai', label: 'AI', icon: 'sparkles', link: '/settings/ai' },
    ...(environment.linkedinImport || environment.linkedinConnect
      ? [
          {
            id: 'linkedin' as const,
            label: 'LinkedIn',
            icon: 'link' as const,
            link: '/settings/linkedin',
          },
        ]
      : []),
    { id: 'data', label: 'Your data', icon: 'shield', link: '/settings/data' },
  ];
  protected readonly leads: Record<SettingsTab, string> = {
    account: 'Your name, your plan and how Jobbotix looks.',
    ai: 'Your AI providers, the letters drafts copy the tone of, and AI usage.',
    linkedin: 'Sign in with LinkedIn, and bring in your LinkedIn data.',
    data: 'Downloads, imports, support access, and deleting your account.',
  };
  protected readonly ids = computed(() => tabIds('settings', this.tab()));
  protected readonly theme = inject(Theme);
  protected readonly tour = inject(Tour);
  protected readonly shell = inject(ShellState);
  /** AI usage and access keys stay folded away until asked for. */
  protected readonly advancedOpen = signal(false);
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
      title: 'Revoke this access key?',
      body: 'Any task using it stops adding jobs until you give it a new key.',
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
