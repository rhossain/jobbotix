import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
} from '@angular/core';
import { Icon } from '../ui/icon';
import { HelpChat } from './help-chat';

/**
 * A small "?" beside something that needs explaining (the match score, AI
 * connections, remote or on-site). It opens the Help chat with the question
 * already asked.
 */
@Component({
  selector: 'jb-help-q',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex align-middle' },
  template: `
    <button
      type="button"
      class="-m-1.5 inline-grid size-8 place-items-center rounded-full text-ink-muted transition-colors hover:bg-sunken hover:text-brand-ink focus-visible:text-brand-ink"
      [attr.aria-label]="'Help: ' + question()"
      [title]="question()"
      (click)="help.show(question())"
    >
      <jb-icon name="message-circle-question-mark" [size]="16" />
    </button>
  `,
})
export class HelpQ {
  protected readonly help = inject(HelpChat);
  readonly question = input.required<string>();
}

/**
 * "Need help with this?" under an empty page or an error: opens the Help
 * chat with the question that page raises.
 */
@Component({
  selector: 'jb-help-link',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex' },
  template: `
    <button
      type="button"
      class="inline-flex items-center gap-1.5 rounded text-sm font-medium text-brand-ink underline-offset-2 hover:underline"
      (click)="help.show(question())"
    >
      <jb-icon name="message-circle-question-mark" [size]="16" />
      {{ label() }}
    </button>
  `,
})
export class HelpLink {
  protected readonly help = inject(HelpChat);
  readonly question = input.required<string>();
  readonly label = input('Need help with this?');
}
