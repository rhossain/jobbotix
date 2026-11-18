import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
} from '@angular/core';
import { Router } from '@angular/router';
import { Tabs, type TabItem } from '../ui';

/** One section of a page that has its own address (/settings/ai). */
export interface PageTab<T extends string = string> extends TabItem<T> {
  link: string;
}

/**
 * Tabs that split a long page into sections, each at its own address, so a
 * link (or Back) lands on the right one. Put the section in an element with
 * role="tabpanel" and the ids from tabIds(prefix, current).
 */
@Component({
  selector: 'jb-page-tabs',
  imports: [Tabs],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <jb-tabs
      [prefix]="prefix()"
      [label]="label()"
      [tabs]="tabs()"
      [value]="current()"
      (valueChange)="go($event)"
    />
  `,
})
export class PageTabs {
  private readonly router = inject(Router);
  readonly tabs = input.required<PageTab[]>();
  readonly current = input.required<string>();
  readonly prefix = input.required<string>();
  readonly label = input.required<string>();

  go(id: string) {
    const tab = this.tabs().find((t) => t.id === id);
    if (tab && id !== this.current()) void this.router.navigateByUrl(tab.link);
  }
}
