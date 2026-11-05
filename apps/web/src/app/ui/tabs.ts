import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  model,
} from '@angular/core';
import { Icon } from './icon';
import type { IconName } from './icons.generated';

export interface TabItem<T extends string = string> {
  id: T;
  label: string;
  icon?: IconName;
  count?: number | null;
}

/** Ids that tie a tab to its panel: use them on the panel element. */
export function tabIds(prefix: string, id: string) {
  return { tab: `${prefix}-tab-${id}`, panel: `${prefix}-panel-${id}` };
}

/**
 * WAI-ARIA tabs: arrow keys move between tabs, Home/End jump, the active tab
 * is the only one in the tab order. The strip scrolls sideways on narrow
 * screens with the active tab kept in view. Put each panel in an element with
 * role="tabpanel" and the ids from tabIds(prefix, id).
 *
 * variant="line" is the underlined page-section style; "segmented" is the
 * pill switch for two to four views (Edit / Preview).
 */
@Component({
  selector: 'jb-tabs',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-variant]': 'variant()', class: 'jb-tabs' },
  template: `
    <div class="strip" role="tablist" [attr.aria-label]="label()">
      @for (t of tabs(); track t.id) {
        <button
          type="button"
          role="tab"
          class="tab"
          [id]="prefix() + '-tab-' + t.id"
          [attr.aria-controls]="controls() ? prefix() + '-panel-' + t.id : null"
          [attr.aria-selected]="t.id === value()"
          [attr.tabindex]="t.id === value() ? 0 : -1"
          (click)="select(t.id)"
          (keydown)="onKey($event)"
        >
          @if (t.icon) {
            <jb-icon [name]="t.icon" />
          }
          <span>{{ t.label }}</span>
          @if (t.count !== null && t.count !== undefined) {
            <span class="count">{{ t.count }}</span>
          }
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .strip {
      display: flex;
      overflow-x: auto;
      scroll-snap-type: x proximity;
      scrollbar-width: none;
    }
    .strip::-webkit-scrollbar {
      display: none;
    }
    .tab {
      position: relative;
      display: inline-flex;
      flex: none;
      align-items: center;
      gap: 0.45rem;
      min-height: 2.75rem;
      padding: 0 0.9rem;
      border: 0;
      background: none;
      color: var(--ink-muted);
      font: inherit;
      font-size: 0.9375rem;
      font-weight: 500;
      white-space: nowrap;
      cursor: pointer;
      scroll-snap-align: center;
      transition: color var(--dur-fast) var(--motion-ease);
    }
    .tab:hover {
      color: var(--ink);
    }
    .tab[aria-selected='true'] {
      color: var(--ink);
    }
    .tab:focus-visible {
      outline-offset: -2px;
    }
    .count {
      min-width: 1.4rem;
      padding: 0 0.35rem;
      border-radius: 999px;
      background: var(--surface-sunken);
      color: var(--ink-muted);
      font-size: 0.75rem;
      line-height: 1.4rem;
      text-align: center;
    }

    /* line */
    :host([data-variant='line']) .strip {
      gap: 0.25rem;
      box-shadow: inset 0 -1px 0 var(--line);
    }
    :host([data-variant='line']) .tab::after {
      content: '';
      position: absolute;
      inset: auto 0.6rem 0;
      height: 2px;
      border-radius: 2px;
      background: var(--brand);
      transform: scaleX(0);
      transition: transform var(--dur-base) var(--motion-ease);
    }
    :host([data-variant='line']) .tab[aria-selected='true']::after {
      transform: scaleX(1);
    }

    /* segmented */
    :host([data-variant='segmented']) {
      display: inline-block;
      max-width: 100%;
    }
    :host([data-variant='segmented']) .strip {
      gap: 2px;
      padding: 3px;
      border-radius: 999px;
      background: var(--surface-sunken);
    }
    :host([data-variant='segmented']) .tab {
      min-height: 2.25rem;
      padding: 0 1rem;
      border-radius: 999px;
      font-size: 0.875rem;
      transition:
        color var(--dur-fast) var(--motion-ease),
        background-color var(--dur-base) var(--motion-ease),
        box-shadow var(--dur-base) var(--motion-ease);
    }
    :host([data-variant='segmented']) .tab[aria-selected='true'] {
      background: var(--surface);
      box-shadow:
        var(--elev-raised),
        0 0 0 1px var(--line);
    }
    @media (pointer: coarse) {
      :host([data-variant='segmented']) .tab {
        min-height: 2.5rem;
      }
    }
  `,
})
export class Tabs<T extends string = string> {
  readonly tabs = input.required<readonly TabItem<T>[]>();
  readonly value = model.required<T>();
  /** Prefix for the tab and panel ids; unique per page. */
  readonly prefix = input('tabs');
  readonly label = input<string | null>(null);
  readonly variant = input<'line' | 'segmented'>('line');
  /** False when the tabs only switch a value and there are no panels to point at. */
  readonly controls = input(true);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  select(id: T) {
    this.value.set(id);
    queueMicrotask(() => this.reveal(id));
  }

  protected onKey(e: KeyboardEvent) {
    const list = this.tabs();
    const i = list.findIndex((t) => t.id === this.value());
    const to =
      e.key === 'ArrowRight'
        ? (i + 1) % list.length
        : e.key === 'ArrowLeft'
          ? (i - 1 + list.length) % list.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? list.length - 1
              : -1;
    if (to < 0) return;
    e.preventDefault();
    this.select(list[to].id);
    this.host.nativeElement
      .querySelector<HTMLElement>(`#${this.prefix()}-tab-${list[to].id}`)
      ?.focus();
  }

  private reveal(id: T) {
    this.host.nativeElement
      .querySelector<HTMLElement>(`#${this.prefix()}-tab-${id}`)
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }
}
