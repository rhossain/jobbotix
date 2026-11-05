import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { Auth } from '../core/auth';
import { Button, Icon, Sheet } from '../ui';
import { Logo } from './logo';
import { PRIMARY_NAV, SECONDARY_NAV, ShellState } from './shell-state';
import { ThemeSwitch } from './theme-switch';

/**
 * Phone top bar: back chevron on detail pages (or the logo), the page title,
 * and search. Sits under the status bar via safe-area padding.
 */
@Component({
  selector: 'jb-top-bar',
  imports: [Icon, Logo, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'jb-top-bar block md:hidden print:hidden' },
  template: `
    <div class="flex h-[var(--topbar-h)] items-center gap-1 px-2">
      @if (back(); as b) {
        <a
          [routerLink]="b.link"
          class="grid size-11 place-items-center rounded-full text-ink no-underline active:bg-sunken"
          [attr.aria-label]="'Back to ' + b.label"
        >
          <jb-icon name="chevron-left" [size]="24" />
        </a>
      } @else {
        <a
          routerLink="/today"
          class="grid size-11 place-items-center"
          aria-label="Jobbotix, Today"
        >
          <jb-logo [wordmark]="false" [size]="26" />
        </a>
      }
      <p
        class="min-w-0 flex-1 truncate text-[1.0625rem] font-semibold tracking-tight text-ink"
      >
        {{ title() }}
      </p>
      @if (showAdd()) {
        <a
          routerLink="/roles/new"
          class="grid size-11 place-items-center rounded-full text-ink no-underline active:bg-sunken"
          aria-label="Add a role"
        >
          <jb-icon name="plus" [size]="22" />
        </a>
      }
      <button
        type="button"
        class="grid size-11 place-items-center rounded-full text-ink active:bg-sunken"
        aria-label="Search and commands"
        (click)="shell.openPalette()"
      >
        <jb-icon name="search" [size]="21" />
      </button>
    </div>
  `,
  styles: `
    :host {
      position: sticky;
      top: 0;
      z-index: 30;
      padding-top: env(safe-area-inset-top, 0px);
      border-bottom: 1px solid color-mix(in srgb, var(--line) 70%, transparent);
      background: color-mix(in srgb, var(--surface-canvas) 82%, transparent);
      -webkit-backdrop-filter: saturate(1.4) blur(14px);
      backdrop-filter: saturate(1.4) blur(14px);
    }
    @supports not (backdrop-filter: blur(1px)) {
      :host {
        background: var(--surface-canvas);
      }
    }
  `,
})
export class TopBar {
  protected readonly shell = inject(ShellState);
  readonly title = input('');
  readonly back = input<{ link: string; label: string } | null>(null);
  readonly showAdd = input(false);
}

/**
 * Phone bottom tab bar: the four daily places plus More. Hides while
 * scrolling down and comes back on the way up.
 */
@Component({
  selector: 'jb-tab-bar',
  imports: [Icon, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'jb-tab-bar', '[class.is-hidden]': 'hidden()' },
  template: `
    <nav aria-label="Main">
      <ul class="grid grid-cols-5">
        @for (item of items; track item.link) {
          <li>
            <a
              class="tab"
              [routerLink]="item.link"
              routerLinkActive="is-active"
              ariaCurrentWhenActive="page"
            >
              <span class="pill"
                ><jb-icon [name]="item.icon" [size]="22"
              /></span>
              <span class="label">{{ item.label }}</span>
            </a>
          </li>
        }
        <li>
          <button
            type="button"
            class="tab"
            [class.is-active]="moreActive()"
            aria-haspopup="dialog"
            (click)="more.emit()"
          >
            <span class="pill"><jb-icon name="ellipsis" [size]="22" /></span>
            <span class="label">More</span>
          </button>
        </li>
      </ul>
    </nav>
  `,
  styles: `
    :host {
      position: fixed;
      inset: auto 0 0;
      z-index: 30;
      padding-bottom: env(safe-area-inset-bottom, 0px);
      border-top: 1px solid var(--line);
      background: color-mix(in srgb, var(--surface-raised) 88%, transparent);
      -webkit-backdrop-filter: saturate(1.4) blur(14px);
      backdrop-filter: saturate(1.4) blur(14px);
      transition: transform var(--dur-base) var(--motion-ease);
    }
    :host(.is-hidden) {
      transform: translateY(100%);
    }
    ul {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .tab {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      width: 100%;
      height: var(--tabbar-h);
      border: 0;
      background: none;
      color: var(--ink-muted);
      font: inherit;
      text-decoration: none;
      cursor: pointer;
    }
    .pill {
      display: grid;
      place-items: center;
      width: 3.5rem;
      height: 2rem;
      border-radius: 999px;
      transition: background-color var(--dur-base) var(--motion-ease);
    }
    .label {
      font-size: 0.6875rem;
      font-weight: 500;
    }
    .tab.is-active {
      color: var(--brand-ink);
    }
    .tab.is-active .pill {
      background: var(--brand-tint);
    }
    .tab.is-active .label {
      font-weight: 600;
    }
  `,
})
export class TabBar {
  readonly more = output<void>();
  readonly moreActive = input(false);
  protected readonly items = PRIMARY_NAV;
  protected readonly hidden = signal(false);

  constructor() {
    const doc = inject(DOCUMENT);
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const win = doc.defaultView;
      if (!win) return;
      let last = win.scrollY;
      const onScroll = () => {
        const y = win.scrollY;
        if (Math.abs(y - last) < 24) return;
        this.hidden.set(y > last && y > 120);
        last = y;
      };
      win.addEventListener('scroll', onScroll, { passive: true });
      destroyRef.onDestroy(() => win.removeEventListener('scroll', onScroll));
    });
  }
}

/** The "More" sheet: set-up pages, theme, shortcuts and sign out. */
@Component({
  selector: 'jb-more-sheet',
  imports: [Button, Icon, RouterLink, Sheet, ThemeSwitch],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <jb-sheet
      [open]="shell.moreOpen()"
      (openChange)="shell.moreOpen.set($event)"
      title="More"
    >
      <div class="flex items-center gap-3 rounded-card bg-sunken p-3">
        <span
          class="grid size-10 shrink-0 place-items-center rounded-full bg-brand-tint text-sm font-semibold text-brand-ink"
          aria-hidden="true"
          >{{ initials() }}</span
        >
        <span class="min-w-0">
          <span class="block truncate font-medium text-ink">{{ name() }}</span>
          <span class="block truncate text-sm text-ink-muted">{{
            email()
          }}</span>
        </span>
      </div>

      <ul class="mt-3 flex flex-col">
        @for (item of items(); track item.link) {
          <li>
            <a
              [routerLink]="item.link"
              class="row"
              (click)="shell.moreOpen.set(false)"
            >
              <jb-icon [name]="item.icon" [size]="20" class="text-ink-muted" />
              <span class="flex-1">{{ item.label }}</span>
              <jb-icon
                name="chevron-right"
                [size]="18"
                class="text-ink-faint"
              />
            </a>
          </li>
        }
      </ul>

      <div class="row cursor-default">
        <jb-icon name="sun" [size]="20" class="text-ink-muted" />
        <span class="flex-1">Theme</span>
        <jb-theme-switch />
      </div>

      <button type="button" jbButton block class="mt-4" (click)="out()">
        <jb-icon name="log-out" /> Sign out
      </button>
    </jb-sheet>
  `,
  styles: `
    .row {
      display: flex;
      align-items: center;
      gap: 0.85rem;
      min-height: 3.25rem;
      padding: 0 0.25rem;
      border-bottom: 1px solid var(--line);
      color: var(--ink);
      font-size: 1rem;
      font-weight: 500;
      text-decoration: none;
    }
    a.row:active {
      background: var(--surface-sunken);
    }
  `,
})
export class MoreSheet {
  protected readonly shell = inject(ShellState);
  private readonly auth = inject(Auth);
  readonly signOut = output<void>();

  protected readonly items = computed(() =>
    SECONDARY_NAV.filter((i) => !i.adminOnly || this.auth.isAdmin()),
  );
  protected readonly email = computed(() => this.auth.user()?.email ?? '');
  protected readonly name = computed(
    () => this.auth.profile()?.name || this.email().split('@')[0] || 'You',
  );
  protected readonly initials = computed(() =>
    this.name()
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase(),
  );

  protected out() {
    this.shell.moreOpen.set(false);
    this.signOut.emit();
  }
}
