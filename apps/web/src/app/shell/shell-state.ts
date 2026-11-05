import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import type { IconName } from '../ui';

export interface NavItem {
  label: string;
  link: string;
  icon: IconName;
  /** Keyboard shortcut shown beside the item, e.g. "g t". */
  keys?: string;
  adminOnly?: boolean;
}

/** The four places used every day: bottom tab bar on phones, top of the sidebar. */
export const PRIMARY_NAV: NavItem[] = [
  { label: 'Today', link: '/today', icon: 'sunrise', keys: 'g t' },
  { label: 'Roles', link: '/roles', icon: 'list', keys: 'g r' },
  { label: 'Board', link: '/board', icon: 'square-kanban', keys: 'g b' },
  { label: 'Resume', link: '/resume', icon: 'file-text', keys: 'g e' },
];

/** Set-up and review pages: under "More" on phones. */
export const SECONDARY_NAV: NavItem[] = [
  {
    label: 'Search profile',
    link: '/search',
    icon: 'sliders-horizontal',
    keys: 'g s',
  },
  { label: 'Insights', link: '/insights', icon: 'chart-column', keys: 'g i' },
  { label: 'Admin', link: '/admin', icon: 'shield', adminOnly: true },
  { label: 'Settings', link: '/settings', icon: 'settings' },
];

const COLLAPSE_KEY = 'jb-sidebar-collapsed';

/** UI state the shell, the shortcuts and the pages share. */
@Injectable({ providedIn: 'root' })
export class ShellState {
  private readonly doc = inject(DOCUMENT);

  readonly paletteOpen = signal(false);
  /** 'help' opens the palette on the keyboard-shortcut list. */
  readonly paletteMode = signal<'commands' | 'help'>('commands');
  readonly moreOpen = signal(false);
  readonly sidebarCollapsed = signal(readCollapsed());
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

  toggleSidebar() {
    const next = !this.sidebarCollapsed();
    this.sidebarCollapsed.set(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
    } catch {
      /* storage unavailable: the choice lasts for this tab */
    }
  }
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}
