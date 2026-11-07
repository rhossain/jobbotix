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
import type { SharedView } from '@jobbotix/shared-types';
import { SharesRepo } from '../../core/data/repos';
import {
  RelativeDayPipe,
  StatusLabelPipe,
  TypeLabelPipe,
  scoreBand,
} from '../../shared/format';

import { EmptyState, Icon, MatchRing, Skeleton } from '../../ui';

/** Public, read-only view behind a share token: one role, or the board. */
@Component({
  selector: 'jb-shared',
  imports: [
    EmptyState,
    Icon,
    MatchRing,
    RelativeDayPipe,
    RouterLink,
    Skeleton,
    StatusLabelPipe,
    TypeLabelPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mx-auto max-w-3xl">
      @if (state() === 'loading') {
        <jb-skeleton shape="card" [count]="2" />
      } @else if (state() === 'missing') {
        <jb-empty-state title="This link is no longer active" icon="link">
          The owner may have stopped sharing it. Ask them for a new one.
          <div actions>
            <a routerLink="/" class="jb-btn">What is Jobbotix?</a>
          </div>
        </jb-empty-state>
      } @else if (view(); as v) {
        <p
          class="inline-flex items-center gap-2 rounded-full bg-sunken px-3 py-1 text-xs text-ink-muted"
        >
          <jb-icon name="eye" [size]="14" /> Shared by {{ v.owner }}, read-only
        </p>
        @if (v.kind === 'role') {
          @let r = v.role;
          <header class="mt-5 flex flex-wrap items-start gap-4 md:gap-6">
            <jb-match-ring [score]="r.score" size="lg" />
            <div class="min-w-0 flex-1">
              <h1
                class="text-2xl font-semibold tracking-tight text-ink md:text-3xl"
              >
                {{ r.title }}
              </h1>
              <p class="text-ink-muted">
                {{ r.company }}
              </p>
              <div class="mt-2 flex flex-wrap gap-1.5">
                <span class="jb-tag">{{ r.type | typeLabel }}</span>
                @if (r.remote_scope || r.location) {
                  <span class="jb-tag">{{ r.remote_scope || r.location }}</span>
                }
                @if (r.salary) {
                  <span class="jb-tag">{{ r.salary }}</span>
                }
                <span
                  class="jb-status s-{{ r.status }} inline-flex items-center"
                  >{{ r.status | statusLabel }}</span
                >
              </div>
            </div>
            @if (r.url) {
              <a [href]="r.url" target="_blank" rel="noopener" class="jb-btn"
                >Open posting <jb-icon name="arrow-up-right" [size]="16"
              /></a>
            }
          </header>

          <div class="mt-6 grid gap-6 md:grid-cols-2">
            <section class="jb-card p-5">
              <h2 class="jb-section-title">Why it fits</h2>
              <ul
                class="mt-3 list-disc space-y-1.5 pl-5 text-sm wrap-anywhere marker:text-brand"
              >
                @for (x of r.reasons; track x) {
                  <li>{{ x }}</li>
                }
              </ul>
            </section>
            <section class="jb-card p-5">
              <h2 class="jb-section-title">Watch out</h2>
              @if (r.gaps.length) {
                <ul
                  class="mt-3 list-disc space-y-1.5 pl-5 text-sm wrap-anywhere marker:text-brand"
                >
                  @for (x of r.gaps; track x) {
                    <li>{{ x }}</li>
                  }
                </ul>
              } @else {
                <p class="mt-2 text-sm text-ink-muted">Nothing flagged.</p>
              }
            </section>
          </div>
          @if (r.stack.length) {
            <section class="mt-6">
              <h2 class="jb-section-title">Stack</h2>
              <div class="mt-2 flex flex-wrap gap-1.5">
                @for (s of r.stack; track s) {
                  <span class="jb-tag">{{ s }}</span>
                }
              </div>
            </section>
          }
          @if (r.cover_letter) {
            <section class="mt-6">
              <h2 class="jb-section-title">Cover letter draft</h2>
              <pre class="jb-letter mt-2">{{ r.cover_letter }}</pre>
            </section>
          }
          @if (r.posting_text) {
            <section class="mt-6">
              <h2 class="jb-section-title">Posting</h2>
              <pre class="jb-letter mt-2 max-h-96 overflow-auto">{{
                r.posting_text
              }}</pre>
            </section>
          }
        } @else {
          <h1 class="mt-2 text-2xl font-semibold tracking-tight">
            {{ v.owner }}'s job board
          </h1>
          <p class="mt-1 text-sm text-ink-muted">
            {{ v.roles.length }} roles, best match first. Skipped roles are not
            shown.
          </p>
          <div class="jb-card mt-4 overflow-x-auto p-5">
            <table class="w-full text-sm">
              <thead class="text-left text-xs text-ink-muted">
                <tr>
                  <th class="py-2 pr-4">Score</th>
                  <th class="py-2 pr-4">Role</th>
                  <th class="py-2 pr-4">Status</th>
                  <th class="py-2 pr-4">Type</th>
                  <th class="py-2">Moved</th>
                </tr>
              </thead>
              <tbody>
                @for (r of v.roles; track r.url + r.title) {
                  <tr class="border-t border-line">
                    <td class="py-2 pr-4 tabular-nums">
                      <span
                        class="jb-score-{{ scoreBand(r.score) }} font-semibold"
                        >{{ r.score }}</span
                      >
                    </td>
                    <td class="py-2 pr-4">
                      @if (r.url) {
                        <a
                          [href]="r.url"
                          target="_blank"
                          rel="noopener"
                          class="font-medium hover:underline"
                          >{{ r.title }}</a
                        >
                      } @else {
                        <span class="font-medium">{{ r.title }}</span>
                      }
                      <div class="text-xs text-ink-muted">
                        {{ r.company
                        }}{{ r.remote_scope ? ' · ' + r.remote_scope : '' }}
                      </div>
                    </td>
                    <td class="py-2 pr-4">
                      <span
                        class="jb-status s-{{
                          r.status
                        }} inline-flex items-center"
                        >{{ r.status | statusLabel }}</span
                      >
                    </td>
                    <td class="py-2 pr-4">{{ r.type | typeLabel }}</td>
                    <td class="py-2">
                      {{ r.status_changed_at | relativeDay }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
        <footer class="mt-10 text-xs text-ink-muted">
          Shared {{ v.created_at | relativeDay }}. Jobbotix finds, scores and
          drafts; the candidate presses send.
          <a routerLink="/" class="text-brand-ink underline">Learn more</a>
        </footer>
      }
    </section>
  `,
})
export class SharedPage {
  private readonly repo = inject(SharesRepo);
  readonly token = input.required<string>();
  readonly view = signal<SharedView | null>(null);
  readonly state = signal<'loading' | 'missing' | 'ok'>('loading');
  readonly scoreBand = scoreBand;

  constructor() {
    effect(() => {
      const t = this.token();
      untracked(() => {
        this.state.set('loading');
        void this.repo.view(t).then((v) => {
          this.view.set(v);
          this.state.set(v ? 'ok' : 'missing');
        });
      });
    });
  }
}
