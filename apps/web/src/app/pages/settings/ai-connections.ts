import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  isLimited,
  PROVIDER_ORDER,
  PROVIDERS,
  summariseUsage,
  waitWords,
  type AiConnectionView,
  type ProviderId,
  type ProviderModel,
} from '@jobbotix/shared-types';
import { SettingsRepo, type AiCheck } from '../../core/data/repos';
import { RelativeDayPipe } from '../../shared/format';
import { Toast } from '../../shared/toast';
import { Button, Confirm, Icon } from '../../ui';

export interface ConnectionStatus {
  tone: 'good' | 'warn' | 'bad' | 'plain';
  label: string;
}

/** How a connection is doing, in a few words; pure, so it is tested directly. */
export function connectionStatus(
  c: Pick<AiConnectionView, 'status' | 'limitedUntil'>,
  now: number = Date.now(),
): ConnectionStatus {
  if (c.status === 'error') return { tone: 'bad', label: 'Needs attention' };
  if (c.limitedUntil && isLimited(c, now))
    return {
      tone: 'warn',
      label: `Rate limited, back ${waitWords(Date.parse(c.limitedUntil), now)}`,
    };
  if (c.status === 'ok') return { tone: 'good', label: 'Working' };
  return { tone: 'plain', label: 'Not tested yet' };
}

/**
 * The models offered for a connection: the provider's suggestions (the live
 * Claude list for Anthropic when the key could fetch one), plus the saved
 * model when it is not among them.
 */
export function connectionModels(
  c: Pick<AiConnectionView, 'provider' | 'model'>,
  claudeModels: ProviderModel[] = [],
): ProviderModel[] {
  const base =
    c.provider === 'anthropic' && claudeModels.length
      ? claudeModels
      : PROVIDERS[c.provider].models;
  // The live Claude list marks the account default; here "default" means the
  // provider's own, offered as the first option.
  const models = base.map((m) => ({
    id: m.id,
    label: m.label.replace(/ \(default\)$/, ''),
  }));
  if (c.model && !models.some((m) => m.id === c.model))
    models.push({ id: c.model, label: c.model });
  return models;
}

const OTHER = '__other';

/**
 * Settings: the AI providers connected with the user's own keys. Add a key
 * (checked with the provider before it is stored), test it, pick its model,
 * set the order they are tried in, remove it.
 */
@Component({
  selector: 'jb-ai-connections',
  imports: [Button, FormsModule, Icon, RelativeDayPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    <section
      id="ai"
      class="jb-card flex flex-col gap-4 p-5 md:p-6"
      data-tour="settings-ai"
    >
      <h2 class="jb-section-title">AI connections</h2>
      <p class="text-sm text-ink-muted">
        Jobbotix scores every new role on keywords at no cost. Connect an AI
        provider with your own key and it also re-scores the strongest matches
        each run and drafts letters, answers and prep inside the app. Gemini and
        Groq have free tiers that need no card.
      </p>

      @if (repo.connections().length) {
        <ol class="flex flex-col gap-3">
          @for (c of repo.connections(); track c.id; let i = $index) {
            @let info = providers[c.provider];
            @let st = status(c);
            <li
              class="flex flex-col gap-3 rounded-control border border-line p-3.5"
            >
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                @if (repo.connections().length > 1) {
                  <span class="text-sm text-ink-muted tabular-nums"
                    >{{ i + 1 }}.</span
                  >
                }
                <h3 class="text-sm font-semibold text-ink">{{ info.name }}</h3>
                @if (!info.verified) {
                  <span
                    class="jb-tag jb-tag-warn"
                    title="New in Jobbotix: drafts may fall back to the local writer more often than on Claude."
                    >Beta</span
                  >
                }
                <span
                  class="jb-tag"
                  [class.jb-tag-ai]="st.tone === 'good'"
                  [class.jb-tag-warn]="st.tone === 'warn'"
                  [class.jb-tag-bad]="st.tone === 'bad'"
                  >{{ st.label }}</span
                >
              </div>
              <p class="text-xs text-ink-muted">
                @if (c.keyHint) {
                  Key ending {{ c.keyHint }}, stored server-side and never shown
                  again.
                } @else {
                  Key stored server-side and never shown again.
                }
                @if (c.lastCheckedAt) {
                  Checked {{ c.lastCheckedAt | relativeDay }}.
                }
                @if (calls()[c.provider]; as n) {
                  {{ n }} {{ n === 1 ? 'call' : 'calls' }} in the last 30 days.
                }
              </p>
              @if (c.status === 'error' && c.lastError) {
                <p class="text-sm text-bad">{{ c.lastError }}</p>
              }
              @if (rowError()[c.id]; as err) {
                <p class="text-sm text-bad" role="alert">{{ err }}</p>
              }
              <div class="flex flex-wrap items-end gap-2">
                <label class="flex min-w-0 flex-col gap-1 text-xs">
                  <span class="text-ink-muted">Model</span>
                  <select
                    #sel
                    class="jb-input jb-input-inline min-h-9 py-1 text-sm"
                    [attr.aria-label]="'Model for ' + info.name"
                    [disabled]="!!busy()"
                    (change)="pickModel(c, sel)"
                  >
                    <option value="" [selected]="!c.model">
                      Provider default ({{ info.defaultModel }})
                    </option>
                    @for (m of modelsFor(c); track m.id) {
                      <option [value]="m.id" [selected]="m.id === c.model">
                        {{ m.label }}
                      </option>
                    }
                    <option [value]="other" [selected]="customFor() === c.id">
                      Another model…
                    </option>
                  </select>
                </label>
                <div class="ml-auto flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    jbButton
                    size="sm"
                    [busy]="busy() === 'test:' + c.id"
                    [disabled]="!!busy()"
                    (click)="test(c)"
                  >
                    <jb-icon name="rotate-cw" [size]="16" /> Test
                  </button>
                  <button
                    type="button"
                    jbButton="ghost"
                    size="sm"
                    title="Runs four short jobs on this key: scoring, reading a posting, tailoring a resume and a cover letter"
                    [busy]="busy() === 'check:' + c.id"
                    [disabled]="!!busy()"
                    (click)="check(c)"
                  >
                    Full check
                  </button>
                  @if (repo.connections().length > 1) {
                    <button
                      type="button"
                      jbButton="ghost"
                      size="sm"
                      iconOnly
                      [attr.aria-label]="'Try ' + info.name + ' earlier'"
                      [disabled]="i === 0 || !!busy()"
                      (click)="move(i, -1)"
                    >
                      <jb-icon name="arrow-up" [size]="16" />
                    </button>
                    <button
                      type="button"
                      jbButton="ghost"
                      size="sm"
                      iconOnly
                      [attr.aria-label]="'Try ' + info.name + ' later'"
                      [disabled]="
                        i === repo.connections().length - 1 || !!busy()
                      "
                      (click)="move(i, 1)"
                    >
                      <jb-icon name="arrow-down" [size]="16" />
                    </button>
                  }
                  <button
                    type="button"
                    jbButton="ghost"
                    size="sm"
                    class="text-bad"
                    [disabled]="!!busy()"
                    (click)="remove(c)"
                  >
                    Remove
                  </button>
                </div>
              </div>
              @if (busy() === 'check:' + c.id) {
                <p class="text-xs text-ink-muted" role="status">
                  Scoring a sample posting, reading it, tailoring a sample
                  resume and writing a letter. This takes up to a minute.
                </p>
              }
              @if (checks()[c.id]; as chk) {
                <div
                  class="flex flex-col gap-2 rounded-control bg-sunken p-3 text-sm"
                >
                  <p class="font-medium text-ink">
                    Full check: {{ chk.summary }}
                  </p>
                  @if (chk.results.length) {
                    <ul class="flex flex-col gap-1.5">
                      @for (r of chk.results; track r.job) {
                        <li class="flex items-start gap-2">
                          <jb-icon
                            [name]="
                              r.ok
                                ? 'circle-check'
                                : r.limited
                                  ? 'clock'
                                  : 'circle-x'
                            "
                            [size]="16"
                            class="mt-0.5 shrink-0"
                            [class.text-good]="r.ok"
                            [class.text-bad]="!r.ok && !r.limited"
                            [class.text-ink-muted]="r.limited"
                          />
                          <span class="min-w-0">
                            <span class="text-ink">{{ r.label }}</span>
                            <span class="text-xs text-ink-muted">
                              · {{ r.model
                              }}{{ r.ms ? ' · ' + seconds(r.ms) : '' }}</span
                            >
                            @if (r.detail) {
                              <span class="block text-xs text-ink-muted">{{
                                r.detail
                              }}</span>
                            }
                          </span>
                        </li>
                      }
                    </ul>
                    <p class="text-xs text-ink-muted">
                      Run on a made-up resume and posting; the calls count
                      toward your usage. A job that fails here falls back to a
                      local draft in the app.
                    </p>
                  }
                </div>
              }
              @if (customFor() === c.id) {
                <form
                  class="flex flex-wrap items-end gap-2"
                  (ngSubmit)="saveCustom(c)"
                >
                  <label
                    class="flex min-w-0 flex-1 basis-56 flex-col gap-1 text-xs"
                  >
                    <span class="text-ink-muted"
                      >Model id, exactly as {{ info.name }} names it</span
                    >
                    <input
                      class="jb-input font-mono text-sm"
                      name="customModel"
                      autocomplete="off"
                      spellcheck="false"
                      [ngModel]="customModel()"
                      (ngModelChange)="customModel.set($event)"
                    />
                  </label>
                  <button
                    type="submit"
                    jbButton
                    size="sm"
                    [busy]="busy() === 'model:' + c.id"
                    [disabled]="!customModel().trim() || !!busy()"
                  >
                    Use this model
                  </button>
                  <button
                    type="button"
                    jbButton="ghost"
                    size="sm"
                    (click)="customFor.set(''); sel.value = c.model"
                  >
                    Cancel
                  </button>
                </form>
              }
            </li>
          }
        </ol>
        @if (repo.connections().length > 1) {
          <p class="text-xs text-ink-muted">
            Tried in this order: when one is rate limited or fails, the next
            takes over, and a model picked next to a Generate button goes first.
            @if (hasClaude()) {
              Company research starts with Anthropic whatever the order, because
              it is the one that can search the web.
            }
          </p>
        }
      }

      @if (available().length) {
        <div class="flex flex-col gap-3 border-t border-line pt-4">
          <h3 class="text-sm font-semibold text-ink">
            {{
              repo.connections().length
                ? 'Add another provider'
                : 'Connect a provider'
            }}
          </h3>
          <div class="flex flex-wrap gap-2" role="group" aria-label="Provider">
            @for (id of available(); track id) {
              <button
                type="button"
                class="jb-btn jb-btn-sm"
                [class.jb-btn-primary]="adding() === id"
                [attr.aria-pressed]="adding() === id"
                (click)="choose(id)"
              >
                {{ providers[id].name }}
                @if (providers[id].free) {
                  <span class="text-xs opacity-80">· free tier</span>
                }
              </button>
            }
          </div>
          @if (adding(); as id) {
            @let info = providers[id];
            <form class="flex flex-col gap-3" (ngSubmit)="save()" novalidate>
              <p class="text-sm text-ink-muted">
                {{ info.dataNote }}
                <a
                  [href]="info.keyUrl"
                  target="_blank"
                  rel="noopener"
                  class="whitespace-nowrap text-brand-ink underline"
                  >Create a key<jb-icon
                    name="arrow-up-right"
                    [size]="14"
                    class="ml-0.5 inline-block align-text-bottom"
                /></a>
              </p>
              @if (!info.verified) {
                <p class="text-xs text-ink-muted">
                  Beta: {{ info.name }} is new in Jobbotix. When its answer
                  cannot be used, the draft is written locally and the app says
                  why.
                </p>
              }
              @if (info.needsConsent) {
                <label class="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="consent"
                    class="mt-1"
                    [ngModel]="consent()"
                    (ngModelChange)="consent.set($event)"
                  />
                  <span
                    >I understand that {{ info.name }} may use what Jobbotix
                    sends on the free tier, including my resume, as described
                    above.</span
                  >
                </label>
              }
              <div class="flex flex-wrap items-end gap-2">
                <label
                  class="flex min-w-0 flex-1 basis-72 flex-col gap-1 text-sm"
                >
                  <span>{{ info.name }} API key</span>
                  <input
                    id="st-ai-key"
                    type="password"
                    name="key"
                    class="jb-input font-mono"
                    autocomplete="off"
                    spellcheck="false"
                    [placeholder]="info.keyPlaceholder"
                    [ngModel]="key()"
                    (ngModelChange)="key.set($event); addError.set('')"
                  />
                </label>
                <button
                  type="submit"
                  jbButton="primary"
                  [busy]="busy() === 'save'"
                  [disabled]="!canSave() || !!busy()"
                >
                  Check and save
                </button>
              </div>
              @if (addError()) {
                <p class="text-sm text-bad" role="alert">{{ addError() }}</p>
              }
            </form>
          }
        </div>
      }
    </section>
  `,
})
export class AiConnections {
  protected readonly repo = inject(SettingsRepo);
  private readonly toast = inject(Toast);
  private readonly confirm = inject(Confirm);

  protected readonly providers = PROVIDERS;
  protected readonly other = OTHER;

  /** What is running: '', 'save', 'test:<id>', 'check:<id>', 'model:<id>', 'order', 'remove:<id>'. */
  readonly busy = signal('');
  readonly adding = signal<ProviderId | null>(null);
  readonly key = signal('');
  readonly consent = signal(false);
  readonly addError = signal('');
  readonly rowError = signal<Record<string, string>>({});
  /** The last full check of each connection, by connection id. */
  readonly checks = signal<Record<string, AiCheck>>({});
  /** The connection whose "Another model" field is open. */
  readonly customFor = signal('');
  readonly customModel = signal('');

  /** Providers not connected yet, free ones first. */
  readonly available = computed(() => {
    const have = new Set(this.repo.connections().map((c) => c.provider));
    return PROVIDER_ORDER.filter((id) => !have.has(id));
  });
  /** Calls per provider in the last 30 days (from the most recent usage rows). */
  readonly calls = computed(() => {
    const out: Record<string, number> = {};
    for (const g of summariseUsage(this.repo.usage(), 30).byProvider)
      out[g.key] = g.calls;
    return out;
  });
  readonly hasClaude = computed(() =>
    this.repo.connections().some((c) => c.provider === 'anthropic'),
  );
  readonly canSave = computed(() => {
    const id = this.adding();
    if (!id || !this.key().trim()) return false;
    return !PROVIDERS[id].needsConsent || this.consent();
  });

  status(c: AiConnectionView) {
    return connectionStatus(c);
  }

  modelsFor(c: AiConnectionView) {
    return connectionModels(c, this.repo.models());
  }

  choose(id: ProviderId) {
    this.adding.set(this.adding() === id ? null : id);
    this.key.set('');
    this.consent.set(false);
    this.addError.set('');
  }

  async save() {
    const provider = this.adding();
    if (!provider || !this.canSave() || this.busy()) return;
    const info = PROVIDERS[provider];
    const key = this.key().trim();
    if (!info.keyPattern.test(key)) {
      this.addError.set(
        `That does not look like a ${info.name} API key (expected something like ${info.keyPlaceholder}).`,
      );
      return;
    }
    this.busy.set('save');
    this.addError.set('');
    try {
      const note = await this.repo.saveConnection({
        provider,
        key,
        consent: this.consent(),
      });
      this.key.set('');
      this.consent.set(false);
      this.adding.set(null);
      this.toast.show(note || `${info.name} connected`, {
        tone: 'success',
        ms: note ? 9000 : undefined,
      });
    } catch (e) {
      this.addError.set((e as Error).message || 'Could not save the key');
    } finally {
      this.busy.set('');
    }
  }

  async test(c: AiConnectionView) {
    await this.run(`test:${c.id}`, c.id, async () => {
      const note = await this.repo.testConnection(c.id);
      this.toast.show(note || `${PROVIDERS[c.provider].name} answered`, {
        tone: 'success',
      });
    });
  }

  async check(c: AiConnectionView) {
    await this.run(`check:${c.id}`, c.id, async () => {
      const result = await this.repo.checkConnection(c.id);
      this.checks.update((all) => ({ ...all, [c.id]: result }));
    });
  }

  /** 1240 → "1.2 s". */
  seconds(ms: number) {
    return `${(ms / 1000).toFixed(1)} s`;
  }

  async pickModel(c: AiConnectionView, select: HTMLSelectElement) {
    const value = select.value;
    if (value === OTHER) {
      this.customFor.set(c.id);
      this.customModel.set('');
      return;
    }
    if (this.customFor() === c.id) this.customFor.set('');
    if (value === c.model) return;
    // A model the provider would not run is not saved: show the old one again.
    if (!(await this.setModel(c, value))) select.value = c.model;
  }

  saveCustom(c: AiConnectionView) {
    const model = this.customModel().trim();
    if (model) void this.setModel(c, model);
  }

  private setModel(c: AiConnectionView, model: string) {
    return this.run(`model:${c.id}`, c.id, async () => {
      const note = await this.repo.setConnectionModel(c.id, model);
      this.customFor.set('');
      this.toast.show(note || 'Model updated', { tone: 'success' });
    });
  }

  async move(index: number, by: -1 | 1) {
    const ids = this.repo.connections().map((c) => c.id);
    const to = index + by;
    if (to < 0 || to >= ids.length) return;
    [ids[index], ids[to]] = [ids[to], ids[index]];
    await this.run('order', ids[to], () => this.repo.reorderConnections(ids));
  }

  async remove(c: AiConnectionView) {
    const name = PROVIDERS[c.provider].name;
    const last = this.repo.connections().length === 1;
    const ok = await this.confirm.ask({
      title: `Remove ${name}?`,
      body: last
        ? 'The stored key is deleted. In-app generation falls back to local drafts until you connect a provider again. Your scheduled runs keep scoring on keywords.'
        : 'The stored key is deleted. Your other connections keep working.',
      action: 'Remove',
      danger: true,
    });
    if (!ok) return;
    await this.run(`remove:${c.id}`, c.id, async () => {
      await this.repo.removeConnection(c.id);
      this.toast.show(`${name} removed`);
    });
  }

  /**
   * One action at a time; its error shows on the connection it was for.
   * Resolves false when it failed or another action was running.
   */
  private async run(
    what: string,
    rowId: string,
    action: () => Promise<void>,
  ): Promise<boolean> {
    if (this.busy()) return false;
    this.busy.set(what);
    this.rowError.set({});
    try {
      await action();
      return true;
    } catch (e) {
      this.rowError.set({
        [rowId]: (e as Error).message || 'That did not work; try again.',
      });
      return false;
    } finally {
      this.busy.set('');
    }
  }
}
