import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { Toast } from '../shared/toast';
import { Button } from './button';
import { Icon } from './icon';

/** Copies text to the clipboard and confirms with a check mark. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

@Component({
  selector: 'jb-copy-button',
  imports: [Button, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      [jbButton]="variant()"
      [size]="size()"
      [iconOnly]="iconOnly()"
      [attr.aria-label]="iconOnly() ? label() : null"
      [title]="iconOnly() ? label() : ''"
      (click)="copy()"
    >
      <jb-icon [name]="done() ? 'check' : 'copy'" />
      @if (!iconOnly()) {
        <span>{{ done() ? 'Copied' : label() }}</span>
      }
    </button>
    <span class="sr-only" aria-live="polite">{{
      done() ? 'Copied to clipboard' : ''
    }}</span>
  `,
})
export class CopyButton {
  private readonly toast = inject(Toast);
  readonly text = input.required<string>();
  readonly label = input('Copy');
  readonly iconOnly = input(false);
  readonly size = input<'sm' | 'md'>('md');
  readonly variant = input<'secondary' | 'ghost' | 'primary'>('secondary');
  /** Toast shown after copying, e.g. "Follow-up copied". */
  readonly confirm = input<string | null>(null);

  protected readonly done = signal(false);
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  async copy() {
    if (await copyText(this.text())) {
      this.done.set(true);
      if (this.confirm()) this.toast.success(this.confirm() as string);
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.done.set(false), 1500);
    } else {
      this.toast.error(
        'Could not reach the clipboard; select the text and copy it',
      );
    }
  }
}
