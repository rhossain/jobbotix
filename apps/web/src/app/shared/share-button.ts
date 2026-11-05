import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  signal,
} from '@angular/core';
import { SharesRepo } from '../core/data/repos';
import { Button, Icon } from '../ui';
import { Toast } from './toast';

/** Creates (or reuses) a read-only link and copies it; a second click revokes. */
@Component({
  selector: 'jb-share-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Icon],
  template: `
    <span class="inline-flex items-center gap-1">
      <button
        type="button"
        jbButton
        [busy]="busy()"
        [disabled]="busy()"
        [title]="
          kind() === 'board'
            ? 'Copy a read-only link to your board for a mentor'
            : 'Copy a read-only link to this role for a mentor'
        "
        (click)="share()"
      >
        <jb-icon name="share-2" /> {{ liveId() ? 'Copy link' : 'Share' }}
      </button>
      @if (liveId(); as id) {
        <button
          type="button"
          jbButton="ghost"
          size="sm"
          [disabled]="busy()"
          title="Stop sharing: the link stops working"
          (click)="revoke(id)"
        >
          Stop sharing
        </button>
      }
    </span>
  `,
})
export class ShareButton {
  private readonly repo = inject(SharesRepo);
  private readonly toast = inject(Toast);
  readonly kind = input<'role' | 'board'>('role');
  readonly roleId = input<string | undefined>(undefined);
  readonly busy = signal(false);
  readonly liveId = signal<string | null>(null);

  constructor() {
    void this.repo.load().then(() => this.refresh());
  }

  private refresh() {
    const live = this.repo
      .shares()
      .find(
        (s) =>
          !s.revoked_at &&
          s.kind === this.kind() &&
          (s.role_id ?? null) === (this.roleId() ?? null),
      );
    this.liveId.set(live?.id ?? null);
  }

  async share() {
    this.busy.set(true);
    try {
      const token = await this.repo.create(this.kind(), this.roleId());
      const url = `${location.origin}/s/${token}`;
      this.refresh();
      try {
        await navigator.clipboard.writeText(url);
        this.toast.show(
          'Read-only link copied. Anyone with it can view; revoke here when done.',
        );
      } catch {
        this.toast.show(`Link: ${url}`);
      }
    } catch (e) {
      this.toast.show((e as Error).message || 'Could not create the link');
    } finally {
      this.busy.set(false);
    }
  }

  async revoke(id: string) {
    this.busy.set(true);
    try {
      await this.repo.revoke(id);
      this.refresh();
      this.toast.show('Sharing stopped; the link no longer works');
    } finally {
      this.busy.set(false);
    }
  }
}
