import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { postingHealth, type RoleRow } from '@jobbotix/shared-types';
import { RolesRepo } from '../core/data/repos';
import { Icon, MatchRing } from '../ui';
import { Viewport } from '../core/viewport';
import { RelativeDayPipe, TypeLabelPipe } from './format';
import { StatusSelect } from './status-select';

/**
 * One role as a card: match ring, title, company, the facts that decide
 * whether to look closer, and the status. The whole card opens the role;
 * the status control sits above that link.
 */
@Component({
  selector: 'jb-role-card',
  imports: [
    Icon,
    MatchRing,
    RelativeDayPipe,
    RouterLink,
    StatusSelect,
    TypeLabelPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <article
      class="jb-card jb-card-interactive relative flex gap-3.5 p-4 md:gap-5 md:p-5"
      [class.jb-card-ai]="role().ai_match"
    >
      <jb-match-ring
        [score]="role().score"
        [size]="viewport.phone() || compact() ? 'sm' : 'md'"
        [transitionName]="'ring-' + role().id"
      />
      <div class="min-w-0 flex-1">
        <h3
          class="text-base leading-snug font-semibold text-ink md:text-[1.0625rem]"
        >
          <a
            [routerLink]="['/roles', role().id]"
            class="no-underline after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-[var(--line-focus)]"
            >{{ role().title }}</a
          >
        </h3>
        <p class="mt-0.5 text-sm text-ink-muted">{{ role().company }}</p>

        @if (showReasons() && role().reasons.length) {
          <p class="mt-2.5 flex gap-2 text-sm text-ink">
            <jb-icon name="sparkles" [size]="16" class="mt-0.5 text-brand" />
            <span class="line-clamp-2">{{ role().reasons[0] }}</span>
          </p>
        }

        @if (!compact()) {
          <div class="mt-3 flex flex-wrap gap-1.5">
            @for (b of health().badges; track b.kind) {
              <span
                class="jb-tag"
                [class.jb-tag-warn]="b.tone === 'warn'"
                [class.jb-tag-bad]="b.tone === 'bad'"
                [title]="b.detail"
                >{{ b.label }}</span
              >
            }
            @if (role().ai_match) {
              <span class="jb-tag jb-tag-ai">AI-assisted dev</span>
            }
            <span class="jb-tag">{{ role().type | typeLabel }}</span>
            @if (role().location) {
              <span class="jb-tag">{{ role().location }}</span>
            }
            @if (role().salary) {
              <span class="jb-tag">{{ role().salary }}</span>
            }
          </div>
        }

        <div class="mt-3 flex items-center justify-between gap-3">
          <p class="min-w-0 truncate text-xs text-ink-faint">
            @if (role().posted_at) {
              Posted {{ role().posted_at | relativeDay }}
            } @else {
              Found {{ role().created_at | relativeDay }}
            }
            @if (role().source) {
              <span class="hidden sm:inline">on {{ role().source }}</span>
            }
            @if (compact() && health().badges[0]; as b) {
              ·
              <span
                [class.text-warn]="b.tone === 'warn'"
                [class.text-bad]="b.tone === 'bad'"
                [title]="b.detail"
                >{{ b.label }}</span
              >
            }
          </p>
          <jb-status-select class="relative z-10 shrink-0" [role]="role()" />
        </div>
      </div>
    </article>
  `,
})
export class RoleCard {
  protected readonly viewport = inject(Viewport);
  private readonly repo = inject(RolesRepo);
  readonly role = input.required<RoleRow>();
  /** Age, relisting and closure warnings from the shared pool. */
  protected readonly health = computed(() =>
    postingHealth(
      this.role(),
      this.repo.postingFacts()[this.role().id],
      new Date(),
    ),
  );
  readonly showReasons = input(true);
  /** Fewer details: no tag row, a smaller ring. */
  readonly compact = input(false);
}
