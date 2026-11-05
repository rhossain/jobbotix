import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { SwUpdate, type VersionReadyEvent } from '@angular/service-worker';
import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterOutlet,
  type ActivatedRouteSnapshot,
} from '@angular/router';
import { filter, map } from 'rxjs';
import { Auth } from './core/auth';
import { Shortcuts } from './core/shortcuts';
import { Theme } from './core/theme';
import { Toast } from './shared/toast';
import { CommandPalette } from './shell/command-palette';
import { Logo } from './shell/logo';
import { MoreSheet, TabBar, TopBar } from './shell/mobile-nav';
import { SECONDARY_NAV, ShellState } from './shell/shell-state';
import { Sidebar } from './shell/sidebar';
import { ThemeSwitch } from './shell/theme-switch';
import { Button, ConfirmHost, Icon, ToastHost } from './ui';

/** Detail pages and where their back chevron goes on phones. */
const PARENTS: [RegExp, { link: string; label: string }][] = [
  [/^\/roles\/.+/, { link: '/roles', label: 'Roles' }],
  [/^\/admin\/.+/, { link: '/admin', label: 'Admin' }],
];

@Component({
  imports: [
    Button,
    CommandPalette,
    ConfirmHost,
    Icon,
    Logo,
    MoreSheet,
    RouterLink,
    RouterOutlet,
    Sidebar,
    TabBar,
    ThemeSwitch,
    ToastHost,
    TopBar,
  ],
  selector: 'jb-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly auth = inject(Auth);
  protected readonly shell = inject(ShellState);
  private readonly router = inject(Router);
  private readonly toast = inject(Toast);
  private readonly doc = inject(DOCUMENT);
  protected readonly title = 'Jobbotix';

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects.split(/[?#]/)[0]),
    ),
    { initialValue: '/' },
  );

  /** The current route's title without the product suffix. */
  protected readonly pageTitle = computed(() => {
    this.url();
    let snap: ActivatedRouteSnapshot | null =
      this.router.routerState.snapshot.root;
    let title = '';
    while (snap) {
      if (typeof snap.title === 'string') title = snap.title;
      snap = snap.firstChild;
    }
    return title.replace(/\s*·\s*Jobbotix$/, '') || this.title;
  });

  protected readonly back = computed(
    () => PARENTS.find(([re]) => re.test(this.url()))?.[1] ?? null,
  );
  protected readonly showAdd = computed(() =>
    ['/today', '/roles', '/board'].includes(this.url()),
  );
  protected readonly moreActive = computed(() =>
    SECONDARY_NAV.some((i) => this.url().startsWith(i.link)),
  );
  protected readonly onAuthPage = computed(() =>
    /^\/(login|signup|forgot-password|reset-password)/.test(this.url()),
  );

  private readonly wide = signal(false);
  /** Icon rail below 1280px, or when the user collapsed the sidebar. */
  protected readonly rail = computed(
    () => !this.wide() || this.shell.sidebarCollapsed(),
  );

  constructor() {
    inject(Theme);
    inject(Shortcuts).install();

    const win = this.doc.defaultView;
    const mq = win?.matchMedia?.('(min-width: 1280px)');
    if (mq) {
      this.wide.set(mq.matches);
      const onChange = (e: MediaQueryListEvent) => this.wide.set(e.matches);
      mq.addEventListener('change', onChange);
      inject(DestroyRef).onDestroy(() =>
        mq.removeEventListener('change', onChange),
      );
    }

    // The toast stack sits above the phone tab bar while it is shown.
    effect(() => {
      this.doc.body.classList.toggle('jb-has-tabbar', this.auth.isSignedIn());
    });

    const sw = inject(SwUpdate, { optional: true });
    if (sw?.isEnabled) {
      sw.versionUpdates
        .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
        .subscribe(() =>
          this.toast.show('A new version of Jobbotix is ready', {
            ms: 60 * 60 * 1000,
            action: { label: 'Reload', run: () => win?.location.reload() },
          }),
        );
    }
  }

  async signOut() {
    await this.auth.signOut();
    await this.router.navigateByUrl('/login');
  }
}
