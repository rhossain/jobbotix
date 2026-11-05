import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injectable,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Button } from './button';

export interface ConfirmRequest {
  title: string;
  body?: string;
  /** The action's name, used on the button: "Delete version". */
  action: string;
  cancel?: string;
  danger?: boolean;
}

interface Pending extends ConfirmRequest {
  resolve: (ok: boolean) => void;
}

/**
 * Asks before something that cannot be undone.
 * `if (!(await confirm.ask({ title: 'Delete this version?', action: 'Delete', danger: true }))) return;`
 */
@Injectable({ providedIn: 'root' })
export class Confirm {
  readonly pending = signal<Pending | null>(null);

  ask(req: ConfirmRequest): Promise<boolean> {
    this.pending()?.resolve(false);
    return new Promise((resolve) => this.pending.set({ ...req, resolve }));
  }

  /** Called by the host when the dialog closes. */
  settle(ok: boolean) {
    const p = this.pending();
    this.pending.set(null);
    p?.resolve(ok);
  }
}

@Component({
  selector: 'jb-confirm-host',
  imports: [Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Backdrop clicks close the dialog; Esc (native) is the keyboard route. -->
    <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
    <dialog
      #dialog
      class="jb-dialog"
      aria-labelledby="jb-confirm-title"
      [attr.aria-describedby]="
        confirm.pending()?.body ? 'jb-confirm-body' : null
      "
      (close)="onClose()"
      (click)="onBackdrop($event)"
    >
      @if (confirm.pending(); as p) {
        <div class="jb-dialog-panel max-w-md p-5 md:p-6">
          <h2 id="jb-confirm-title" class="text-lg font-semibold text-ink">
            {{ p.title }}
          </h2>
          @if (p.body) {
            <p id="jb-confirm-body" class="mt-2 text-sm text-ink-muted">
              {{ p.body }}
            </p>
          }
          <div
            class="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"
          >
            <button type="button" jbButton autofocus (click)="close(false)">
              {{ p.cancel || 'Cancel' }}
            </button>
            <button
              type="button"
              [jbButton]="p.danger ? 'danger' : 'primary'"
              (click)="close(true)"
            >
              {{ p.action }}
            </button>
          </div>
        </div>
      }
    </dialog>
  `,
})
export class ConfirmHost {
  protected readonly confirm = inject(Confirm);
  private readonly dialog =
    viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private result = false;

  constructor() {
    effect(() => {
      const d = this.dialog().nativeElement;
      if (this.confirm.pending() && !d.open) {
        this.result = false;
        d.showModal?.();
      }
    });
  }

  protected close(ok: boolean) {
    this.result = ok;
    this.dialog().nativeElement.close();
  }

  protected onClose() {
    this.confirm.settle(this.result);
  }

  protected onBackdrop(e: MouseEvent) {
    if (e.target === this.dialog().nativeElement) this.close(false);
  }
}
