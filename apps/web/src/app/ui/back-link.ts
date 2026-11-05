import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from './icon';

/** "‹ Roles": the way back to the parent page. */
@Component({
  selector: 'jb-back-link',
  imports: [RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a
      [routerLink]="link()"
      class="-ml-1.5 inline-flex min-h-9 items-center gap-1 rounded-control px-1.5 text-sm font-medium text-ink-muted no-underline transition-colors hover:text-ink"
    >
      <jb-icon name="chevron-left" [size]="18" />
      {{ label() }}
    </a>
  `,
})
export class BackLink {
  readonly link = input.required<string | unknown[]>();
  readonly label = input.required<string>();
}
