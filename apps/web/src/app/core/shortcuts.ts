import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ShellState } from '../shell/shell-state';
import { Auth } from './auth';

export interface Shortcut {
  keys: string;
  label: string;
}

/**
 * Global keyboard shortcuts, GitHub style: a "g" prefix for navigation,
 * single keys for actions. Ignored while typing in a field.
 */
@Injectable({ providedIn: 'root' })
export class Shortcuts {
  private readonly router = inject(Router);
  private readonly auth = inject(Auth);
  private readonly doc = inject(DOCUMENT);
  private readonly shell = inject(ShellState);
  private pendingG = 0;

  readonly list: Shortcut[] = [
    { keys: 'g t', label: 'Go to Today' },
    { keys: 'g r', label: 'Go to Roles' },
    { keys: 'g b', label: 'Go to Board' },
    { keys: 'g e', label: 'Go to Resume' },
    { keys: 'g s', label: 'Go to Search profile' },
    { keys: 'g i', label: 'Go to Insights' },
    { keys: 'g o', label: 'Go to Sources' },
    { keys: 'g u', label: 'Go to AI usage' },
    { keys: 'n', label: 'Add a role' },
    { keys: '/', label: 'Focus the search box on Roles' },
    { keys: '⌘ K', label: 'Search roles, pages and actions (Ctrl K)' },
    { keys: '[', label: 'Collapse or expand the sidebar' },
    { keys: '?', label: 'Show these shortcuts' },
    { keys: 'Esc', label: 'Close dialogs and panels' },
  ];

  install() {
    this.doc.addEventListener('keydown', (e) => this.onKey(e));
  }

  private onKey(e: KeyboardEvent) {
    if (e.defaultPrevented) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      if (!this.auth.isSignedIn()) return;
      e.preventDefault();
      if (this.shell.paletteOpen()) this.shell.paletteOpen.set(false);
      else this.shell.openPalette();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    const typing =
      !!target &&
      (target.isContentEditable ||
        /^(input|textarea|select)$/i.test(target.tagName));
    if (typing || this.doc.querySelector('dialog[open]')) return;
    if (e.key === '?') {
      if (!this.auth.isSignedIn()) return;
      e.preventDefault();
      this.shell.openPalette('help');
      return;
    }
    if (!this.auth.isSignedIn()) return;

    const now = Date.now();
    if (this.pendingG && now - this.pendingG < 1200) {
      this.pendingG = 0;
      const to: Record<string, string> = {
        t: '/today',
        r: '/roles',
        b: '/board',
        e: '/resume',
        s: '/search',
        i: '/insights',
        o: '/sources',
        u: '/usage',
      };
      const path = to[e.key.toLowerCase()];
      if (path) {
        e.preventDefault();
        void this.router.navigateByUrl(path);
      }
      return;
    }
    switch (e.key) {
      case '[':
        e.preventDefault();
        this.shell.toggleSidebar();
        return;
      case 'g':
        this.pendingG = now;
        return;
      case 'n':
        e.preventDefault();
        void this.router.navigateByUrl('/roles/new');
        return;
      case '/': {
        const box = this.doc.getElementById('roles-q');
        if (box) {
          e.preventDefault();
          box.focus();
        } else {
          e.preventDefault();
          void this.router
            .navigateByUrl('/roles')
            .then(() =>
              setTimeout(() => this.doc.getElementById('roles-q')?.focus(), 50),
            );
        }
        return;
      }
    }
  }
}
