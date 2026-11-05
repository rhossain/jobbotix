import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { RoleRow } from '@jobbotix/shared-types';
import { RelativeDayPipe, TypeLabelPipe, scoreBand } from './format';
import { StatusSelect } from './status-select';

/** Compact summary of one role: score, title, company, tags, status. */
@Component({
  selector: 'jb-role-card',
  imports: [RouterLink, RelativeDayPipe, TypeLabelPipe, StatusSelect],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article
      class="jb-card flex gap-4 p-4"
      [class.jb-card-ai]="role().ai_match"
    >
      <div class="jb-score jb-score-{{ band() }}" aria-label="Match score">
        {{ role().score }}
        <small>MATCH</small>
      </div>
      <div class="min-w-0 flex-1">
        <a
          [routerLink]="['/roles', role().id]"
          class="block font-semibold hover:underline"
        >
          {{ role().title }}
        </a>
        <div class="text-sm text-neutral-600 dark:text-neutral-300">
          {{ role().company }}
        </div>
        <div class="mt-2 flex flex-wrap gap-1.5">
          @if (role().ai_match) {
            <span class="jb-tag jb-tag-ai">AI-assisted dev</span>
          }
          @if (role().source) {
            <span class="jb-tag">{{ role().source }}</span>
          }
          <span class="jb-tag">{{ role().type | typeLabel }}</span>
          @if (role().location) {
            <span class="jb-tag">{{ role().location }}</span>
          }
          @if (role().salary) {
            <span class="jb-tag">{{ role().salary }}</span>
          }
          @if (role().posted_at) {
            <span class="jb-tag"
              >posted {{ role().posted_at | relativeDay }}</span
            >
          }
        </div>
        @if (showReasons() && role().reasons.length) {
          <p class="mt-2 text-sm text-neutral-700 dark:text-neutral-200">
            {{ role().reasons[0] }}
          </p>
        }
      </div>
      <div class="shrink-0 self-start">
        <jb-status-select [role]="role()" />
      </div>
    </article>
  `,
})
export class RoleCard {
  readonly role = input.required<RoleRow>();
  readonly showReasons = input(true);
  readonly band = computed(() => scoreBand(this.role().score));
}
