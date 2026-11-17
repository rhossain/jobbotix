import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  booleanAttribute,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Button, Icon } from '../ui';

/** The menu is w-64. */
const MENU_WIDTH = 256;

/**
 * One "Export" button that opens a short menu: PDF, Word or Print. Used wherever a
 * resume can be downloaded, so the two formats do not take two buttons.
 */
@Component({
  selector: 'jb-export-menu',
  imports: [Button, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'relative inline-block',
    '(document:click)': 'outside($event)',
    '(keydown.escape)': 'close(true)',
  },
  template: `
    <button
      #trigger
      type="button"
      jbButton
      aria-haspopup="menu"
      [attr.aria-expanded]="open()"
      [busy]="busy()"
      [disabled]="busy()"
      (click)="toggle()"
      (keydown.arrowdown)="$event.preventDefault(); show()"
    >
      <jb-icon name="download" /> Export
      <jb-icon name="chevron-down" [size]="16" />
    </button>
    @if (open()) {
      <div
        #menu
        role="menu"
        tabindex="-1"
        aria-label="Export as"
        class="absolute top-full z-30 mt-1.5 w-64 rounded-card border border-line bg-surface p-1.5 shadow-overlay"
        [class.left-0]="!flip()"
        [class.right-0]="flip()"
        (keydown)="move($event)"
      >
        <button
          type="button"
          role="menuitem"
          class="item"
          (click)="pick('pdf')"
        >
          <span class="font-medium text-ink">PDF</span>
          <span class="text-ink-muted">Best for sending to employers</span>
        </button>
        <button
          type="button"
          role="menuitem"
          class="item"
          (click)="pick('word')"
        >
          <span class="font-medium text-ink">Word (.docx)</span>
          <span class="text-ink-muted"
            >To edit, or where a Word file is asked for</span
          >
        </button>
        <button
          type="button"
          role="menuitem"
          class="item"
          (click)="pick('print')"
        >
          <span class="font-medium text-ink">Print</span>
          <span class="text-ink-muted">Send it to your printer</span>
        </button>
      </div>
    }
  `,
  styles: `
    .item {
      display: flex;
      width: 100%;
      flex-direction: column;
      gap: 0.125rem;
      border: 0;
      border-radius: var(--radius-control);
      background: transparent;
      padding: 0.5rem 0.625rem;
      text-align: left;
      font-size: 0.875rem;
      line-height: 1.35;
      cursor: pointer;
    }
    .item:hover,
    .item:focus-visible {
      background: var(--color-sunken);
    }
    .item:focus-visible {
      outline: 2px solid var(--color-brand);
      outline-offset: -2px;
    }
  `,
})
export class ExportMenu {
  /** Shown while a file is being made. */
  readonly busy = input(false, { transform: booleanAttribute });
  readonly pdf = output<void>();
  readonly word = output<void>();
  readonly print = output<void>();

  protected readonly open = signal(false);
  /** Hangs from the button's right edge when it would run off the screen. */
  protected readonly flip = signal(false);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly trigger =
    viewChild.required<ElementRef<HTMLButtonElement>>('trigger');

  protected toggle(): void {
    if (this.open()) this.close(false);
    else this.show();
  }

  protected show(): void {
    const left = this.trigger().nativeElement.getBoundingClientRect().left;
    this.flip.set(left + MENU_WIDTH > window.innerWidth - 8);
    this.open.set(true);
    // Focus lands on the first choice once the menu is in the page.
    setTimeout(() => this.items()[0]?.focus());
  }

  protected close(refocus: boolean): void {
    if (!this.open()) return;
    this.open.set(false);
    if (refocus) this.trigger().nativeElement.focus();
  }

  protected pick(kind: 'pdf' | 'word' | 'print'): void {
    this.close(true);
    if (kind === 'pdf') this.pdf.emit();
    else if (kind === 'word') this.word.emit();
    // After the menu has left the page, so it is not in the printout.
    else setTimeout(() => this.print.emit());
  }

  protected outside(event: Event): void {
    if (!this.host.nativeElement.contains(event.target as Node))
      this.close(false);
  }

  /** Arrow keys, Home and End move between the choices; Tab leaves and closes. */
  protected move(event: KeyboardEvent): void {
    const items = this.items();
    const at = items.indexOf(event.target as HTMLButtonElement);
    let next = -1;
    if (event.key === 'ArrowDown') next = (at + 1) % items.length;
    else if (event.key === 'ArrowUp')
      next = (at - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'Tab') this.close(false);
    if (next < 0) return;
    event.preventDefault();
    items[next]?.focus();
  }

  private items(): HTMLButtonElement[] {
    return Array.from(
      this.host.nativeElement.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]',
      ),
    );
  }
}
