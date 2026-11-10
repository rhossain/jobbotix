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

  /** Moves several roles at once; Undo puts each back where it was. */
  async moveMany(roles: RoleRow[], to: RoleStatus): Promise<number> {
    const todo = roles.filter((r) => r.status !== to);
    const from = new Map(todo.map((r) => [r.id, r.status]));
    const results = await Promise.allSettled(
      todo.map((r) => this.repo.setStatus(r.id, to)),
    );
    const moved = todo.filter((_, i) => results[i].status === 'fulfilled');
    if (moved.length < todo.length)
      this.toast.error(
        `Could not move ${todo.length - moved.length} of ${todo.length} roles`,
      );
    if (!moved.length) return 0;
    this.toast.show(
      `${moved.length} ${moved.length === 1 ? 'role' : 'roles'} moved to ${ROLE_STATUS_LABELS[to]}`,
      {
        action: {
          label: 'Undo',
          run: async () => {
            const back = await Promise.allSettled(
              moved.map((r) =>
                this.repo.setStatus(r.id, from.get(r.id) as RoleStatus),
              ),
            );
            if (back.some((b) => b.status === 'rejected'))
              this.toast.error('Could not undo every move');
          },
        },
      },
    );
    return moved.length;
  }
}
