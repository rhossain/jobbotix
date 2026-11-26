import { Injectable, signal } from '@angular/core';

/**
 * The Help chat's state, kept for the whole visit so closing and reopening
 * the window keeps the conversation. It holds article ids, not articles: the
 * articles and the search load only when the window first opens, so the
 * Help button costs next to nothing at start-up.
 */
export type HelpMessage =
  | { id: number; from: 'me'; text: string }
  | {
      id: number;
      from: 'bot';
      kind: 'answer';
      /** The article shown in full. */
      articleId: string;
      /** Other close matches, offered by title. */
      also: string[];
      intro: string;
      feedback?: 'yes' | 'no';
      /** Its record on the server (help_messages), for Yes or No. */
      serverId?: string | null;
      /** Below the answer: why there was no AI answer, and what would help. */
      hint?: { text: string; connectAi: boolean };
    }
  | {
      id: number;
      from: 'bot';
      kind: 'ai';
      /** Written by AI from the articles; plain text, steps one per line. */
      text: string;
      /** The articles it was written from, best first. */
      articleIds: string[];
      /** false: the articles did not answer it. */
      found: boolean;
      serverId: string | null;
      feedback?: 'yes' | 'no';
    }
  | { id: number; from: 'bot'; kind: 'thinking' }
  | { id: number; from: 'bot'; kind: 'none'; question: string }
  | { id: number; from: 'bot'; kind: 'text'; text: string }
  | {
      id: number;
      from: 'bot';
      kind: 'support';
      draft: string;
      state: 'editing' | 'sending' | 'sent' | 'failed';
      error?: string;
    };

export type NewMessage = HelpMessage extends infer M
  ? M extends HelpMessage
    ? Omit<M, 'id'>
    : never
  : never;

const BUTTON_KEY = 'jb-help-button';

@Injectable({ providedIn: 'root' })
export class HelpChat {
  readonly open = signal(false);
  /** The floating Help button; Settings can switch it off (Help stays in the menu). */
  readonly showButton = signal(readButtonFlag());
  readonly messages = signal<HelpMessage[]>([]);
  /** A question to ask as soon as the window is up (from a "?" beside something). */
  readonly pending = signal<string | null>(null);

  private nextId = 1;

  show(question?: string) {
    if (question) this.pending.set(question);
    this.open.set(true);
  }

  close() {
    this.open.set(false);
  }

  toggle() {
    this.open.update((o) => !o);
  }

  setShowButton(on: boolean) {
    this.showButton.set(on);
    try {
      localStorage.setItem(BUTTON_KEY, on ? '1' : '0');
    } catch {
      /* storage unavailable: the choice lasts for this tab */
    }
  }

  add(m: NewMessage): number {
    const id = this.nextId++;
    this.messages.update((list) => [...list, { ...m, id } as HelpMessage]);
    return id;
  }

  /** Puts `m` where message `id` was (a "thinking" bubble becomes its answer). */
  replace(id: number, m: NewMessage) {
    this.messages.update((list) =>
      list.map((x) => (x.id === id ? ({ ...m, id } as HelpMessage) : x)),
    );
  }

  patch(id: number, change: Partial<HelpMessage>) {
    this.messages.update((list) =>
      list.map((m) => (m.id === id ? ({ ...m, ...change } as HelpMessage) : m)),
    );
  }

  clear() {
    this.messages.set([]);
  }
}

function readButtonFlag(): boolean {
  try {
    return localStorage.getItem(BUTTON_KEY) !== '0';
  } catch {
    return true;
  }
}
