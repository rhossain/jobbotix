import { Injectable, computed, signal } from '@angular/core';

export type ToastTone = 'info' | 'success' | 'error';

export interface ToastAction {
  label: string;
  run: () => void | Promise<void>;
}

export interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
  ms: number;
}

interface ToastOptions {
  tone?: ToastTone;
  action?: ToastAction;
  ms?: number;
}

const MAX = 3;
const ERROR_TEXT = /^(could not|couldn['’]t|failed|error)/i;

/**
 * Short confirmations and errors, stacked (up to three) by the shell's
 * toast host. A toast with an action (Undo) stays longer. Timers pause
 * while the pointer is over the stack.
 */
@Injectable({ providedIn: 'root' })
export class Toast {
  readonly items = signal<ToastItem[]>([]);
  /** The newest message; kept for callers that only read text. */
  readonly message = computed(() => {
    const list = this.items();
    return list.length ? list[list.length - 1].message : '';
  });

  private nextId = 0;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private paused = false;

  /** show(message) picks the tone from the text; options can override it. */
  show(message: string, opts: number | ToastOptions = {}) {
    const o: ToastOptions = typeof opts === 'number' ? { ms: opts } : opts;
    const tone = o.tone ?? (ERROR_TEXT.test(message) ? 'error' : 'info');
    const ms = o.ms ?? (o.action ? 6000 : tone === 'error' ? 6000 : 3500);
    const item: ToastItem = {
      id: ++this.nextId,
      message,
      tone,
      action: o.action,
      ms,
    };
    const next = [...this.items(), item];
    for (const old of next.slice(0, Math.max(0, next.length - MAX))) {
      this.clear(old.id);
    }
    this.items.set(next.slice(-MAX));
    if (!this.paused) this.arm(item);
    return item.id;
  }

  success(message: string, opts: Omit<ToastOptions, 'tone'> = {}) {
    return this.show(message, { ...opts, tone: 'success' });
  }

  error(message: string, opts: Omit<ToastOptions, 'tone'> = {}) {
    return this.show(message, { ...opts, tone: 'error' });
  }

  dismiss(id: number) {
    this.clear(id);
    this.items.update((list) => list.filter((t) => t.id !== id));
  }

  async act(item: ToastItem) {
    this.dismiss(item.id);
    await item.action?.run();
  }

  pause() {
    this.paused = true;
    for (const id of [...this.timers.keys()]) this.clear(id);
  }

  resume() {
    this.paused = false;
    for (const t of this.items()) this.arm(t);
  }

  private arm(item: ToastItem) {
    this.clear(item.id);
    this.timers.set(
      item.id,
      setTimeout(() => this.dismiss(item.id), item.ms),
    );
  }

  private clear(id: number) {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
  }
}
