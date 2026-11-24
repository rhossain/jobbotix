import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { Viewport } from '../core/viewport';
import { ShellState } from '../shell/shell-state';
import { Tour } from '../shell/tour';
import { Icon } from '../ui';
import { HelpChat } from './help-chat';

/** What sits under the button that it must never cover. */
const INTERACTIVE =
  'a,button,input,select,textarea,label,summary,video,img,canvas,' +
  '[role=button],[role=link],[role=tab],[role=checkbox],[role=switch],' +
  '[role=option],[contenteditable=""],[contenteditable=true],' +
  '[tabindex]:not([tabindex="-1"])';

/**
 * The floating Help button. It must never sit on top of a button or text:
 *
 * - every page keeps room at its foot for it (app.scss), so the last row can
 *   always be scrolled clear, and toasts sit above it (styles.scss)
 * - when the page stops scrolling, it looks at what is underneath; if a
 *   button, a link, a field or text is there, it tucks into a slim tab at
 *   the screen edge, and comes back once the spot is clear
 * - on phones it sits above the tab bar and slides away while scrolling
 *   down, like the tab bar
 * - it steps aside for the tour, menus, search, the open chat and the phone
 *   keyboard; Settings can switch it off (Help stays in the menu)
 */
@Component({
  selector: 'jb-help-fab',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'jb-help-fab print:hidden',
    '[class.is-tucked]': "state() === 'tucked'",
    '[class.is-hidden]': "state() === 'hidden'",
  },
  template: `
    <button
      #btn
      type="button"
      class="jb-help-fab-btn"
      aria-label="Help"
      aria-haspopup="dialog"
      [attr.aria-expanded]="chat.open()"
      [attr.tabindex]="state() === 'hidden' ? -1 : null"
      (click)="chat.toggle()"
    >
      <jb-icon
        name="message-circle-question-mark"
        [size]="state() === 'tucked' ? 18 : viewport.phone() ? 22 : 24"
      />
      <span class="jb-help-fab-tip" aria-hidden="true">Help</span>
    </button>
  `,
})
export class HelpFab {
  protected readonly chat = inject(HelpChat);
  protected readonly viewport = inject(Viewport);
  private readonly shell = inject(ShellState);
  private readonly tour = inject(Tour);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly doc = inject(DOCUMENT);
  private readonly btn = viewChild.required<ElementRef<HTMLElement>>('btn');

  /** Something worth seeing is under the button's spot. */
  private readonly covering = signal(false);
  /** Phones: scrolled down, as the tab bar hides. */
  private readonly scrolledAway = signal(false);
  /** Phones: a text field has focus, so the keyboard is up. */
  private readonly typing = signal(false);

  private readonly away = computed(
    () =>
      !this.chat.showButton() ||
      this.chat.open() ||
      this.tour.active() ||
      this.shell.paletteOpen() ||
      this.shell.moreOpen() ||
      (this.viewport.phone() && (this.scrolledAway() || this.typing())),
  );

  protected readonly state = computed<'full' | 'tucked' | 'hidden'>(() =>
    this.away() ? 'hidden' : this.covering() ? 'tucked' : 'full',
  );

  constructor() {
    const destroyRef = inject(DestroyRef);

    // Room at the foot of every page and above it for toasts, while shown.
    effect(() => {
      this.doc.body.classList.toggle('jb-has-help', this.chat.showButton());
    });
    destroyRef.onDestroy(() => this.doc.body.classList.remove('jb-has-help'));

    // Back from hidden: look again, the page may have moved underneath.
    effect(() => {
      if (!this.away()) untracked(() => this.soon(60));
    });

    // Focus back on the button when the chat closes from inside it.
    let wasOpen = false;
    effect(() => {
      const open = this.chat.open();
      if (wasOpen && !open) {
        const active = this.doc.activeElement;
        if (!active || active === this.doc.body)
          setTimeout(() => this.btn().nativeElement.focus(), 0);
      }
      wasOpen = open;
    });

    inject(Router)
      .events.pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => {
        this.soon(150);
        this.soon(1200); // pages that load their data after the first paint
      });

    afterNextRender(() => this.watch(destroyRef));
  }

  private watch(destroyRef: DestroyRef) {
    const win = this.doc.defaultView;
    if (!win) return;

    let last = 0;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      const y = win.scrollY;
      if (Math.abs(y - last) >= 24) {
        this.scrolledAway.set(y > last && y > 120);
        last = y;
      }
      clearTimeout(idle);
      idle = setTimeout(() => this.check(), 160);
    };
    const onResize = () => this.soon(160);
    const onFocusIn = (e: FocusEvent) => this.typing.set(isTextField(e.target));
    const onFocusOut = () =>
      setTimeout(() => this.typing.set(isTextField(this.doc.activeElement)), 0);

    win.addEventListener('scroll', onScroll, { passive: true });
    win.addEventListener('resize', onResize, { passive: true });
    this.doc.addEventListener('focusin', onFocusIn);
    this.doc.addEventListener('focusout', onFocusOut);

    // Content that appears or changes without a scroll (a list loading).
    const main = this.doc.getElementById('main');
    const observer = main ? new MutationObserver(() => this.soon(400)) : null;
    observer?.observe(main as HTMLElement, { childList: true, subtree: true });

    destroyRef.onDestroy(() => {
      win.removeEventListener('scroll', onScroll);
      win.removeEventListener('resize', onResize);
      this.doc.removeEventListener('focusin', onFocusIn);
      this.doc.removeEventListener('focusout', onFocusOut);
      observer?.disconnect();
      clearTimeout(idle);
      clearTimeout(this.timer);
    });
    this.soon(300);
  }

  private timer: ReturnType<typeof setTimeout> | undefined;

  /** Looks again after `ms`; calls in between are folded into one. */
  private soon(ms: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.check(), ms);
  }

  /**
   * Whether a button, a field, a link, an image or text sits where the full
   * button goes. The host always keeps the full button's size and place, so
   * this measures the same spot whether the button is out or tucked.
   */
  private check() {
    if (this.away()) return;
    const host = this.host.nativeElement;
    const r = host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const inset = 6;
    const points: [number, number][] = [
      [r.left + r.width / 2, r.top + r.height / 2],
      [r.left + inset, r.top + inset],
      [r.right - inset, r.top + inset],
      [r.left + inset, r.bottom - inset],
      [r.right - inset, r.bottom - inset],
    ];
    const covered = points.some(([x, y]) => {
      const under = this.doc
        .elementsFromPoint(x, y)
        .find((el) => !host.contains(el));
      return !!under && worthSeeing(under, r);
    });
    this.covering.set(covered);
  }
}

function worthSeeing(el: Element, spot: DOMRect): boolean {
  if (el.closest(INTERACTIVE)) return true;
  // Text: only where its letters actually reach the spot, not the whole box.
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) continue;
    const range = el.ownerDocument.createRange();
    range.selectNodeContents(node);
    for (const box of Array.from(range.getClientRects()))
      if (overlaps(box, spot)) return true;
  }
  return false;
}

function overlaps(a: DOMRect, b: DOMRect): boolean {
  return (
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  );
}

function isTextField(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable || t instanceof HTMLTextAreaElement) return true;
  if (t instanceof HTMLSelectElement) return true;
  return (
    t instanceof HTMLInputElement &&
    ![
      'checkbox',
      'radio',
      'range',
      'button',
      'submit',
      'reset',
      'file',
      'color',
    ].includes(t.type)
  );
}
