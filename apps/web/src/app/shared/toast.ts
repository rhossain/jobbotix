import { Injectable, signal } from '@angular/core';

/** One-line confirmations ("Marked Applied"). The App shell renders them. */
@Injectable({ providedIn: 'root' })
export class Toast {
  readonly message = signal('');
  private timer: ReturnType<typeof setTimeout> | undefined;

  show(message: string, ms = 1800) {
    this.message.set(message);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.message.set(''), ms);
  }
}
