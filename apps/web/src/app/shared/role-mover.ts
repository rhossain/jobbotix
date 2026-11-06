import { Injectable, inject } from '@angular/core';
import {
  ROLE_STATUS_LABELS,
  type RoleRow,
  type RoleStatus,
} from '@jobbotix/shared-types';
import { RolesRepo } from '../core/data/repos';
import { Toast } from './toast';

/** Moves a role to another status and offers Undo in the toast. */
@Injectable({ providedIn: 'root' })
export class RoleMover {
  private readonly repo = inject(RolesRepo);
  private readonly toast = inject(Toast);

  async move(role: RoleRow, to: RoleStatus): Promise<boolean> {
    const from = role.status;
    if (from === to) return true;
    try {
      await this.repo.setStatus(role.id, to);
    } catch {
      this.toast.error('Could not move the role');
      return false;
    }
    this.toast.show(`${role.company} moved to ${ROLE_STATUS_LABELS[to]}`, {
      action: {
        label: 'Undo',
        run: async () => {
          try {
            await this.repo.setStatus(role.id, from);
          } catch {
            this.toast.error('Could not undo the move');
          }
        },
      },
    });
    return true;
  }
}
