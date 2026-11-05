import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
} from '@angular/core';
import {
  ROLE_STATUSES,
  ROLE_STATUS_LABELS,
  type RoleRow,
  type RoleStatus,
} from '@jobbotix/shared-types';
import { RolesRepo } from '../core/data/repos';
import { Toast } from './toast';

/** The status dropdown used on cards, rows and the detail page. */
@Component({
  selector: 'jb-status-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-block' },
  template: `
    <select
      class="jb-status s-{{ role().status }}"
      [attr.id]="'status-' + role().id"
      [attr.aria-label]="'Status of ' + role().title + ' at ' + role().company"
      (change)="change($event)"
      (click)="$event.stopPropagation()"
    >
      @for (s of statuses; track s) {
        <option [value]="s" [selected]="s === role().status">
          {{ labels[s] }}
        </option>
      }
    </select>
  `,
})
export class StatusSelect {
  private readonly repo = inject(RolesRepo);
  private readonly toast = inject(Toast);
  readonly role = input.required<RoleRow>();
  readonly statuses = ROLE_STATUSES;
  readonly labels = ROLE_STATUS_LABELS;

  async change(event: Event) {
    const status = (event.target as HTMLSelectElement).value as RoleStatus;
    try {
      await this.repo.setStatus(this.role().id, status);
      this.toast.show(`Marked ${this.labels[status]}`);
    } catch {
      this.toast.show('Could not save the status');
      (event.target as HTMLSelectElement).value = this.role().status;
    }
  }
}
