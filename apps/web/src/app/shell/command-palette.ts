import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { Auth } from '../core/auth';
import { RolesRepo } from '../core/data/repos';
import { Shortcuts } from '../core/shortcuts';
import { Theme } from '../core/theme';
import { Icon, type IconName } from '../ui';
import { PRIMARY_NAV, SECONDARY_NAV, ShellState } from './shell-state';
import { Tour } from './tour';

interface Command {
  id: string;
  group: 'Go to' | 'Actions' | 'Roles';
  label: string;
  detail?: string;
  icon: IconName;
  keys?: string;
  run: () => void | Promise<unknown>;
}

/**
 * ⌘K / Ctrl K: jump to any page, any role by title or company, or run an
 * action. "?" opens it on the keyboard-shortcut list.
 */
@Component({
  selector: 'jb-command-palette',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Backdrop clicks close the palette; Esc (native) is the keyboard route. -->
    <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
    <dialog
      #dialog
      class="jb-dialog jb-palette"
      aria-label="Search and commands"
      (close)="shell.paletteOpen.set(false)"
      (click)="onBackdrop($event)"
    >
      <div
        class="jb-dialog-panel flex max-h-[min(36rem,80dvh)] max-w-xl flex-col overflow-hidden"
      >
        <div class="flex items-center gap-3 border-b border-line px-4">
          <jb-icon name="search" [size]="19" class="text-ink-faint" />
          <input
            #input
            class="h-14 min-w-0 flex-1 border-0 bg-transparent text-base text-ink outline-none placeholder:text-ink-faint"
            placeholder="Search roles, pages and actions"
            role="combobox"
            aria-autocomplete="list"
            aria-controls="jb-palette-list"
            [attr.aria-expanded]="true"
            [attr.aria-activedescendant]="activeId()"
            [value]="query()"
            (input)="onInput($event)"
            (keydown)="onKey($event)"
          />
          <button
            type="button"
            class="rounded-control px-2 py-1 text-xs text-ink-muted hover:bg-sunken"
            (click)="toggleHelp()"
          >
            {{ shell.paletteMode() === 'help' ? 'Commands' : 'Shortcuts' }}
          </button>
        </div>

        @if (shell.paletteMode() === 'help') {
          <dl
            class="grid grid-cols-[6.5rem_1fr] gap-x-4 gap-y-2.5 overflow-y-auto p-5 text-sm"
          >
            @for (s of shortcuts.list; track s.keys) {
              <dt>
                @for (k of s.keys.split(' '); track $index) {
                  <kbd
                    class="mr-1 inline-block min-w-6 rounded border border-line bg-sunken px-1.5 py-0.5 text-center text-xs text-ink"
                    >{{ k }}</kbd
                  >
                }
              </dt>
              <dd class="m-0 text-ink-muted">{{ s.label }}</dd>
            }
          </dl>
        } @else {
          <ul
            id="jb-palette-list"
            role="listbox"
            class="m-0 list-none overflow-y-auto p-2"
            aria-label="Results"
          >
            @for (c of results(); track c.id; let i = $index) {
              @if (i === 0 || results()[i - 1].group !== c.group) {
                <li
                  role="presentation"
                  class="px-3 pt-3 pb-1.5 text-xs font-medium text-ink-faint"
                >
                  {{ c.group }}
                </li>
              }
              <li
                role="option"
                tabindex="-1"
                [id]="'jb-cmd-' + c.id"
                class="opt"
                [attr.aria-selected]="i === active()"
                (click)="run(c)"
                (keydown.enter)="run(c)"
                (mousemove)="active.set(i)"
              >
                <jb-icon [name]="c.icon" [size]="18" class="text-ink-muted" />
                <span class="min-w-0 flex-1 truncate">
                  {{ c.label }}
                  @if (c.detail) {
                    <span class="text-ink-muted"> {{ c.detail }}</span>
                  }
                </span>
                @if (c.keys) {
                  <kbd class="text-xs text-ink-faint">{{ c.keys }}</kbd>
                }
              </li>
            } @empty {
              <li class="px-3 py-8 text-center text-sm text-ink-muted">
                Nothing matches “{{ query() }}”.
              </li>
            }
          </ul>
        }
      </div>
    </dialog>
  `,
  styles: `
    .opt {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      min-height: 2.75rem;
      padding: 0 0.75rem;
      border-radius: var(--r-control);
      color: var(--ink);
      font-size: 0.9375rem;
      cursor: pointer;
    }
    .opt[aria-selected='true'] {
      background: var(--brand-tint);
    }
    .opt[aria-selected='true'] jb-icon {
      color: var(--brand-ink);
    }
  `,
})
export class CommandPalette {
  protected readonly shell = inject(ShellState);
  protected readonly shortcuts = inject(Shortcuts);
  private readonly router = inject(Router);
  private readonly roles = inject(RolesRepo);
  private readonly auth = inject(Auth);
  private readonly theme = inject(Theme);
  private readonly tour = inject(Tour);

  private readonly dialog =
    viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly input = viewChild<ElementRef<HTMLInputElement>>('input');

  protected readonly query = signal('');
  protected readonly active = signal(0);

  private readonly commands = computed<Command[]>(() => {
    const go = (link: string) => () => this.router.navigateByUrl(link);
    const pages = [...PRIMARY_NAV, ...SECONDARY_NAV]
      .filter((i) => !i.adminOnly || this.auth.isAdmin())
      .map<Command>((i) => ({
        id: 'go' + i.link.replace(/\W/g, '-'),
        group: 'Go to',
        label: i.label,
        icon: i.icon,
        keys: i.keys,
        run: go(i.link),
      }));
    const actions: Command[] = [
      {
        id: 'add-role',
        group: 'Actions',
        label: 'Add a role from a posting',
        icon: 'plus',
        keys: 'n',
        run: go('/roles/new'),
      },
      {
        id: 'theme',
        group: 'Actions',
        label:
          this.theme.resolved() === 'dark'
            ? 'Switch to light theme'
            : 'Switch to dark theme',
        icon: this.theme.resolved() === 'dark' ? 'sun' : 'moon',
        run: () => this.theme.toggle(),
      },
      {
        id: 'tour',
        group: 'Actions',
        label: 'Take the tour',
        icon: 'compass',
        run: () => this.tour.start(),
      },
      {
        id: 'shortcuts',
        group: 'Actions',
        label: 'Keyboard shortcuts',
        icon: 'keyboard',
        keys: '?',
        run: () => this.shell.openPalette('help'),
      },
    ];
    return [...pages, ...actions];
  });

  protected readonly results = computed<Command[]>(() => {
    const q = this.query().trim().toLowerCase();
    const base = this.commands().filter(
      (c) => !q || c.label.toLowerCase().includes(q),
    );
    if (!q) return base;
    const roles = this.roles
      .roles()
      .filter((r) => `${r.title} ${r.company}`.toLowerCase().includes(q))
      .slice(0, 6)
      .map<Command>((r) => ({
        id: 'role-' + r.id,
        group: 'Roles',
        label: r.title,
        detail: r.company,
        icon: 'briefcase',
        run: () => this.router.navigate(['/roles', r.id]),
      }));
    return [...roles, ...base];
  });

  protected readonly activeId = computed(() => {
    const c = this.results()[this.active()];
    return c ? 'jb-cmd-' + c.id : null;
  });

  constructor() {
    effect(() => {
      const d = this.dialog().nativeElement;
      if (this.shell.paletteOpen() && !d.open) {
        this.query.set('');
        this.active.set(0);
        if (this.auth.isSignedIn() && !this.roles.loaded())
          void this.roles.load();
        d.showModal?.();
        queueMicrotask(() => this.input()?.nativeElement.focus());
      } else if (!this.shell.paletteOpen() && d.open) {
        d.close();
      }
    });
  }

  protected onInput(e: Event) {
    this.query.set((e.target as HTMLInputElement).value);
    this.active.set(0);
    if (this.shell.paletteMode() === 'help')
      this.shell.paletteMode.set('commands');
  }

  protected onKey(e: KeyboardEvent) {
    const n = this.results().length;
    if (e.key === 'ArrowDown' && n) {
      e.preventDefault();
      this.active.set((this.active() + 1) % n);
      this.reveal();
    } else if (e.key === 'ArrowUp' && n) {
      e.preventDefault();
      this.active.set((this.active() - 1 + n) % n);
      this.reveal();
    } else if (e.key === 'Enter') {
      const c = this.results()[this.active()];
      if (c) {
        e.preventDefault();
        void this.run(c);
      }
    }
  }

  protected async run(c: Command) {
    if (c.id !== 'shortcuts') this.shell.paletteOpen.set(false);
    await c.run();
  }

  protected toggleHelp() {
    this.shell.paletteMode.update((m) => (m === 'help' ? 'commands' : 'help'));
    this.input()?.nativeElement.focus();
  }

  protected onBackdrop(e: MouseEvent) {
    if (e.target === this.dialog().nativeElement)
      this.shell.paletteOpen.set(false);
  }

  private reveal() {
    queueMicrotask(() => {
      const id = this.activeId();
      if (id)
        this.dialog()
          .nativeElement.querySelector('#' + id)
          ?.scrollIntoView?.({ block: 'nearest' });
    });
  }
}
