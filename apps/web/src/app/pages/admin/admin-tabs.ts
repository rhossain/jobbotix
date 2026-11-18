import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { PageTabs, type PageTab } from '../../shared/page-tabs';

export type AdminTab = 'overview' | 'users' | 'activity' | 'money' | 'invites';

export const ADMIN_TABS: PageTab<AdminTab>[] = [
  { id: 'overview', label: 'Overview', icon: 'gauge', link: '/admin' },
  { id: 'users', label: 'Users', icon: 'users', link: '/admin/users' },
  {
    id: 'activity',
    label: 'Activity',
    icon: 'chart-column',
    link: '/admin/activity',
  },
  { id: 'money', label: 'Plans & AI', icon: 'sparkles', link: '/admin/money' },
  {
    id: 'invites',
    label: 'Invites',
    icon: 'user-plus',
    link: '/admin/invites',
  },
];

/** The tab strip at the top of every admin page. */
@Component({
  selector: 'jb-admin-tabs',
  imports: [PageTabs],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <jb-page-tabs
      prefix="admin"
      label="Admin sections"
      [tabs]="tabs"
      [current]="current()"
    />
  `,
})
export class AdminTabs {
  readonly current = input.required<AdminTab>();
  protected readonly tabs = ADMIN_TABS;
}
