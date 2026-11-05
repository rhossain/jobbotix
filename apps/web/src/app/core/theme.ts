import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'jb-theme';

/** Canvas colour per theme, for the browser chrome (theme-color meta). */
const CHROME: Record<ResolvedTheme, string> = {
  light: '#f4f7f6',
  dark: '#0c1513',
};

function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function systemTheme(): ResolvedTheme {
  return typeof matchMedia === 'function' &&
    matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function apply(doc: Document, theme: ResolvedTheme) {
  doc.documentElement.dataset['theme'] = theme;
  doc
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((m) => m.setAttribute('content', CHROME[theme]));
}

/**
 * Runs in main.ts before Angular boots, so a stored light/dark choice is on
 * <html> before the first paint. (The CSP forbids inline scripts, and the
 * stylesheet already follows the OS when nothing is set.)
 */
export function bootTheme(doc: Document = document) {
  const pref = readPreference();
  apply(doc, pref === 'system' ? systemTheme() : pref);
}

/** The user's theme choice: System (follows the OS), Light or Dark. */
@Injectable({ providedIn: 'root' })
export class Theme {
  private readonly doc = inject(DOCUMENT);
  readonly preference = signal<ThemePreference>(readPreference());
  private readonly system = signal<ResolvedTheme>(systemTheme());
  readonly resolved = computed<ResolvedTheme>(() => {
    const p = this.preference();
    return p === 'system' ? this.system() : p;
  });

  constructor() {
    const mq =
      typeof matchMedia === 'function'
        ? matchMedia('(prefers-color-scheme: dark)')
        : null;
    mq?.addEventListener('change', (e) => {
      this.system.set(e.matches ? 'dark' : 'light');
      apply(this.doc, this.resolved());
    });
    apply(this.doc, this.resolved());
  }

  set(pref: ThemePreference) {
    this.preference.set(pref);
    try {
      if (pref === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, pref);
    } catch {
      /* private mode: the choice lasts for this tab only */
    }
    apply(this.doc, this.resolved());
  }

  /** Light ↔ dark, leaving "system" for an explicit choice. */
  toggle() {
    this.set(this.resolved() === 'dark' ? 'light' : 'dark');
  }
}
