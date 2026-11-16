import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '../ui';
import type { GuideId } from '../pages/help/guides';

/** A link from a page to the short how-to video about it, on the Help page. */
@Component({
  selector: 'jb-watch-how',
  imports: [Icon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <a
      routerLink="/help"
      [fragment]="guide()"
      class="inline-flex items-center gap-1.5 text-sm font-medium text-brand-ink underline-offset-2 hover:underline"
    >
      <jb-icon name="circle-play" [size]="16" />
      {{ label() }}
    </a>
  `,
})
export class WatchHow {
  readonly guide = input.required<GuideId>();
  readonly label = input('Watch how: 1-minute video');
}
