import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { Auth } from '../core/auth';
import { RolesRepo } from '../core/data/repos';
import { RelativeDayPipe } from '../shared/format';
import { Icon } from '../ui';
import { Logo } from './logo';
import { PRIMARY_NAV, SECONDARY_NAV, ShellState } from './shell-state';
import { ThemeSwitch } from './theme-switch';

/**
 * Desktop navigation: a 240px sidebar with labels and shortcut hints, or a
 * 72px icon rail (tablets, or when collapsed with "[").
 */
@Component({
  selector: 'jb-sidebar',
  imports: [
    Icon,
    Logo,
    RelativeDayPipe,
    RouterLink,
    RouterLinkActive,
    ThemeSwitch,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'jb-sidebar',
    '[attr.data-rail]': 'rail()',
  },
  template: `
    <nav class="flex h-full flex-col" aria-label="Main">
      <div class="flex h-16 items-center justify-between gap-2 px-4">
        <a
          routerLink="/today"
          class="rounded-control no-underline"
          aria-label="Jobbotix, Today"
        >
          <jb-logo [wordmark]="!rail()" />
        </a>
        @if (!rail()) {
          <button
            type="button"
            class="nav-icon-btn hidden xl:grid"
            aria-label="Collapse sidebar"
            title="Collapse sidebar ([)"
            (click)="shell.toggleSidebar()"
          >
            <jb-icon name="panel-left" [size]="18" />
          </button>
        }
      </div>

      <div class="px-3">
        <button
          type="button"
          class="search"
          [attr.aria-label]="rail() ? 'Search and commands' : null"
          (click)="shell.openPalette()"
        >
          <jb-icon name="search" [size]="17" />
          @if (!rail()) {
            <span class="flex-1 text-left">Search…</span>
            <kbd>{{ mod }}K</kbd>
          }
        </button>
      </div>

      <ul class="mt-4 flex flex-col gap-0.5 px-3">
        @for (item of primary; track item.link) {
          <li>
            <a
              class="item"
              [routerLink]="item.link"
              routerLinkActive="is-active"
              ariaCurrentWhenActive="page"
              [attr.aria-label]="rail() ? item.label : null"
              [title]="rail() ? item.label : ''"
            >
              <jb-icon [name]="item.icon" [size]="19" />
              @if (!rail()) {
                <span class="flex-1">{{ item.label }}</span>
                <kbd class="keys">{{ item.keys }}</kbd>
              }
            </a>
          </li>
        }
      </ul>

      <div class="mx-6 my-4 h-px bg-line"></div>

      <ul class="flex flex-col gap-0.5 px-3">
        @for (item of secondary(); track item.link) {
          <li>
            <a
              class="item"
              [routerLink]="item.link"
              routerLinkActive="is-active"
              ariaCurrentWhenActive="page"
              [attr.aria-label]="rail() ? item.label : null"
              [title]="rail() ? item.label : ''"
            >
              <jb-icon [name]="item.icon" [size]="19" />
              @if (!rail()) {
                <span class="flex-1">{{ item.label }}</span>
                @if (item.keys) {
                  <kbd class="keys">{{ item.keys }}</kbd>
                }
              }
            </a>
          </li>
        }
      </ul>

      @if (!rail() && run(); as r) {
        <div
          class="mx-3 mt-6 rounded-card border border-line bg-surface p-3.5 text-sm"
        >
          <p class="flex items-center gap-2 font-medium text-ink">
            <jb-icon name="clock" [size]="16" class="text-brand" />
            Last run {{ r.at | relativeDay }}
          </p>
          <p class="mt-1 text-xs text-ink-muted">
            {{ r.added }} added from {{ r.searched }} listings
          </p>
        </div>
      }

      <div class="mt-auto flex flex-col gap-3 border-t border-line p-3">
        @if (!rail()) {
          <jb-theme-switch class="self-start" />
        }
        <div class="flex items-center gap-2" [class.flex-col]="rail()">
          <a
            routerLink="/settings"
            class="flex min-w-0 flex-1 items-center gap-2.5 rounded-control p-1 no-underline hover:bg-sunken"
            [attr.aria-label]="
              rail() ? 'Settings, signed in as ' + name() : null
            "
            [title]="rail() ? name() : ''"
          >
            <span
              class="grid size-8 shrink-0 place-items-center rounded-full bg-brand-tint text-xs font-semibold text-brand-ink"
              aria-hidden="true"
              >{{ initials() }}</span
            >
            @if (!rail()) {
              <span class="min-w-0">
                <span class="block truncate text-sm font-medium text-ink">{{
                  name()
                }}</span>
                <span class="block truncate text-xs text-ink-muted">{{
                  email()
                }}</span>
              </span>
            }
          </a>
          @if (rail()) {
            <button
              type="button"
              class="nav-icon-btn"
              aria-label="Expand sidebar"
              title="Expand sidebar ([)"
              (click)="shell.toggleSidebar()"
            >
              <jb-icon name="panel-left" [size]="18" />
            </button>
          }
          <button
            type="button"
            class="nav-icon-btn"
            aria-label="Sign out"
            title="Sign out"
            (click)="signOut.emit()"
          >
            <jb-icon name="log-out" [size]="18" />
          </button>
        </div>
      </div>
    </nav>
  `,
  styles: `
    :host {
      position: sticky;
      top: 0;
      height: 100dvh;
      overflow-y: auto;
      border-right: 1px solid var(--line);
      background: color-mix(in srgb, var(--surface) 55%, var(--surface-canvas));
    }
    .item {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      min-height: 2.5rem;
      padding: 0 0.75rem;
      border-radius: var(--r-control);
      color: var(--ink-muted);
      font-size: 0.9375rem;
      font-weight: 500;
      text-decoration: none;
      transition:
        background-color var(--dur-fast) var(--motion-ease),
        color var(--dur-fast) var(--motion-ease);
    }
    .item:hover {
      background: var(--surface-sunken);
      color: var(--ink);
    }
    .item.is-active {
      background: var(--brand-tint);
      color: var(--brand-ink);
    }
    .keys {
      color: var(--ink-faint);
      font-size: 0.6875rem;
      letter-spacing: 0.04em;
      opacity: 0;
      transition: opacity var(--dur-fast) var(--motion-ease);
    }
    .item:hover .keys,
    .item:focus-visible .keys {
      opacity: 1;
    }
    .search {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      width: 100%;
      min-height: 2.5rem;
      padding: 0 0.75rem;
      border: 1px solid var(--line);
      border-radius: var(--r-control);
      background: var(--surface);
      color: var(--ink-faint);
      font: inherit;
      font-size: 0.875rem;
      cursor: pointer;
      transition: border-color var(--dur-fast) var(--motion-ease);
    }
    .search:hover {
      border-color: var(--line-strong);
      color: var(--ink-muted);
    }
    .search kbd {
      padding: 0.05rem 0.35rem;
      border: 1px solid var(--line);
      border-radius: 4px;
      font-size: 0.6875rem;
    }
    .nav-icon-btn {
      display: grid;
      place-items: center;
      flex: none;
      width: 2.25rem;
      height: 2.25rem;
      border: 0;
      border-radius: var(--r-control);
      background: none;
      color: var(--ink-muted);
      cursor: pointer;
    }
    .nav-icon-btn:hover {
      background: var(--surface-sunken);
      color: var(--ink);
    }
    :host([data-rail='true']) .item,
    :host([data-rail='true']) .search {
      justify-content: center;
      padding: 0;
    }
    :host([data-rail='true']) .flex-col > a {
      justify-content: center;
    }
  `,
})
export class Sidebar {
  protected readonly shell = inject(ShellState);
  private readonly auth = inject(Auth);
  private readonly roles = inject(RolesRepo);

  readonly rail = input(false);
  readonly signOut = output<void>();

  protected readonly primary = PRIMARY_NAV;
  protected readonly secondary = computed(() =>
    SECONDARY_NAV.filter((i) => !i.adminOnly || this.auth.isAdmin()),
  );
  protected readonly run = this.roles.lastRun;
  protected readonly mod =
    typeof navigator !== 'undefined' && /Mac|iP/.test(navigator.platform)
      ? '⌘'
      : 'Ctrl ';
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
}
