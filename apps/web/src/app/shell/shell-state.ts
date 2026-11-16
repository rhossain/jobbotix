import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import type { IconName } from '../ui';

export type NavGroupId = 'daily' | 'setup' | 'account';

export interface NavItem {
  label: string;
  link: string;
  icon: IconName;
  group: NavGroupId;
  /** One of the four places on the phone tab bar. */
  tab?: boolean;
  /** Kept out of the menus (reached from Settings, Advanced); search still finds it. */
  hidden?: boolean;
  /** Keyboard shortcut shown beside the item, e.g. "g t". */
  keys?: string;
  adminOnly?: boolean;
}

/** Every page, in menu order: what you use daily, then set-up, then the account. */
export const ALL_NAV: NavItem[] = [
  {
    label: 'Today',
    link: '/today',
    icon: 'sunrise',
    group: 'daily',
    tab: true,
    keys: 'g t',
  },
  {
    label: 'Jobs',
    link: '/jobs',
    icon: 'list',
    group: 'daily',
    tab: true,
    keys: 'g r',
  },
  {
    label: 'Applications',
    link: '/board',
    icon: 'square-kanban',
    group: 'daily',
    tab: true,
    keys: 'g b',
  },
  {
    label: 'Contacts',
    link: '/people',
    icon: 'users',
    group: 'daily',
    keys: 'g p',
  },
  {
    label: 'Progress',
    link: '/insights',
    icon: 'chart-column',
    group: 'daily',
    keys: 'g i',
  },
  {
    label: 'Resume',
    link: '/resume',
    icon: 'file-text',
    group: 'setup',
    tab: true,
    keys: 'g e',
  },
  {
    label: 'Job preferences',
    link: '/search',
    icon: 'sliders-horizontal',
    group: 'setup',
    keys: 'g s',
  },
  {
    label: 'Job sites',
    link: '/sources',
    icon: 'globe',
    group: 'setup',
    keys: 'g o',
  },
  {
    label: 'Filtered out',
    link: '/passed-over',
    icon: 'list-filter',
    group: 'setup',
  },
  {
    label: 'AI usage',
    link: '/usage',
    icon: 'gauge',
    group: 'account',
    hidden: true,
    keys: 'g u',
  },
  {
    label: 'Admin',
    link: '/admin',
    icon: 'shield',
    group: 'account',
    adminOnly: true,
  },
  { label: 'Settings', link: '/settings', icon: 'settings', group: 'account' },
];

/** The four places used every day: the bottom tab bar on phones. */
const MENU = ALL_NAV.filter((i) => !i.hidden);

export const PRIMARY_NAV: NavItem[] = MENU.filter((i) => i.tab);

/** Everything else: under "More" on phones. */
export const SECONDARY_NAV: NavItem[] = MENU.filter((i) => !i.tab);

export interface NavGroup {
  id: NavGroupId;
  label: string;
  items: NavItem[];
}

const GROUP_LABELS: Record<NavGroupId, string> = {
  daily: 'Every day',
  setup: 'Set up',
  account: 'Account',
};

/** `items` under their headings, in menu order; groups left empty are dropped. */
export function navGroups(items: NavItem[] = MENU): NavGroup[] {
  return (Object.keys(GROUP_LABELS) as NavGroupId[])
    .map((id) => ({
      id,
      label: GROUP_LABELS[id],
      items: items.filter((i) => i.group === id),
    }))
    .filter((g) => g.items.length > 0);
}

/**
 * A page's main action, shown in the phone top bar (desktop shows the page's
 * own button). Text actions render as a small primary button ("Save"),
 * others as an icon button with the label as its name.
 */
export interface PageAction {
  label: string;
  icon: IconName;
  run: () => unknown;
  /** Show the label as a small primary button instead of an icon. */
  text?: boolean;
  disabled?: () => boolean;
  busy?: () => boolean;
  /** A link instead of a button (opens in a new tab). */
  href?: () => string | null;
}

const COLLAPSE_KEY = 'jb-sidebar-collapsed';
const HINTS_KEY = 'jb-shortcut-hints';
const CHOOSE_MODEL_KEY = 'jb-choose-model';

/** UI state the shell, the shortcuts and the pages share. */
@Injectable({ providedIn: 'root' })
export class ShellState {
  private readonly doc = inject(DOCUMENT);

  readonly paletteOpen = signal(false);
  /** 'help' opens the palette on the keyboard-shortcut list. */
  readonly paletteMode = signal<'commands' | 'help'>('commands');
  readonly moreOpen = signal(false);
  /** Set by the page on screen; cleared when it is destroyed. */
  readonly pageAction = signal<PageAction | null>(null);
  readonly sidebarCollapsed = signal(readFlag(COLLAPSE_KEY));
  /** Shortcut letters beside the menu items: off unless switched on in Settings. */
  readonly shortcutHints = signal(readFlag(HINTS_KEY));
  /** The AI model dropdown beside Draft buttons: off unless switched on in Settings. */
  readonly chooseModel = signal(readFlag(CHOOSE_MODEL_KEY));
  readonly online = signal(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  constructor() {
    const win = this.doc.defaultView;
    if (!win) return;
    const on = () => this.online.set(true);
    const off = () => this.online.set(false);
    win.addEventListener('online', on);
    win.addEventListener('offline', off);
    inject(DestroyRef).onDestroy(() => {
      win.removeEventListener('online', on);
      win.removeEventListener('offline', off);
    });
  }

  openPalette(mode: 'commands' | 'help' = 'commands') {
    this.paletteMode.set(mode);
    this.paletteOpen.set(true);
  }

  /**
   * Shows `action` in the phone top bar while the calling page lives.
   * Call from a page constructor (it uses the page's DestroyRef).
   */
  usePageAction(action: PageAction, destroyRef = inject(DestroyRef)) {
    this.pageAction.set(action);
    destroyRef.onDestroy(() => {
      if (this.pageAction() === action) this.pageAction.set(null);
    });
  }

  toggleSidebar() {
    const next = !this.sidebarCollapsed();
    this.sidebarCollapsed.set(next);
    writeFlag(COLLAPSE_KEY, next);
  }

  setShortcutHints(on: boolean) {
    this.shortcutHints.set(on);
    writeFlag(HINTS_KEY, on);
  }

  setChooseModel(on: boolean) {
    this.chooseModel.set(on);
    writeFlag(CHOOSE_MODEL_KEY, on);
  }
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    /* storage unavailable: the choice lasts for this tab */
  }
}
