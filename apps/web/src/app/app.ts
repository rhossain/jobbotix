import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterOutlet,
  type ActivatedRouteSnapshot,
} from '@angular/router';
import { filter, map } from 'rxjs';
import { AppUpdate } from './core/app-update';
import { Auth } from './core/auth';
import { SessionPlacement } from './core/session-placement';
import { SessionWatch } from './core/session-watch';
import { Shortcuts } from './core/shortcuts';
import { Theme } from './core/theme';
import { Viewport } from './core/viewport';
import { HelpChat } from './help/help-chat';
import { HelpFab } from './help/help-fab';
import { HelpPanel } from './help/help-panel';
import { CommandPalette } from './shell/command-palette';
import { Logo } from './shell/logo';
import { MoreSheet, TabBar, TopBar } from './shell/mobile-nav';
import { SECONDARY_NAV, ShellState } from './shell/shell-state';
import { Sidebar } from './shell/sidebar';
import { ThemeSwitch } from './shell/theme-switch';
import { Tour } from './shell/tour';
import { TourOverlay } from './shell/tour-overlay';
import { Button, Confirm, ConfirmHost, Icon, ToastHost } from './ui';

/** Detail pages and where their back chevron goes on phones. */
const PARENTS: [RegExp, { link: string; label: string }][] = [
  [/^\/jobs\/.+/, { link: '/jobs', label: 'Jobs' }],
  [/^\/admin\/.+/, { link: '/admin', label: 'Admin' }],
];

@Component({
  imports: [
    Button,
    CommandPalette,
    ConfirmHost,
    HelpFab,
    HelpPanel,
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
    TourOverlay,
  ],
  selector: 'jb-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly auth = inject(Auth);
  protected readonly shell = inject(ShellState);
  protected readonly viewport = inject(Viewport);
  protected readonly confirm = inject(Confirm);
  protected readonly tour = inject(Tour);
  protected readonly helpChat = inject(HelpChat);
  private readonly router = inject(Router);
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
    ['/today', '/jobs', '/board'].includes(this.url()),
  );
  protected readonly moreActive = computed(() =>
    SECONDARY_NAV.some((i) => this.url().startsWith(i.link)),
  );
  protected readonly onAuthPage = computed(() =>
    /^\/(login|signup|forgot-password|reset-password)/.test(this.url()),
  );

  /**
   * Pages that are never drawn inside the app, signed in or not: signing in,
   * signing up, the password pages and the email-link page. A session can
   * arrive while one of them is up (that is what most of them are for), and
   * the sidebar must not appear around the form when it does.
   */
  protected readonly bare = computed(() =>
    /^\/(login|signup|forgot-password|reset-password|auth)(\/|$)/.test(
      this.url(),
    ),
  );
  /** The signed-in app (sidebar, tab bar) is what surrounds the page. */
  protected readonly inShell = computed(
    () => this.auth.isSignedIn() && !this.bare(),
  );

  /** Icon rail below 1280px, or when the user collapsed the sidebar. */
  protected readonly rail = computed(
    () => !this.viewport.wide() || this.shell.sidebarCollapsed(),
  );

  constructor() {
    inject(Theme);
    inject(Shortcuts).install();
    inject(SessionWatch).start();

    // The toast stack sits above the phone tab bar while it is shown.
    effect(() => {
      this.doc.body.classList.toggle('jb-has-tabbar', this.inShell());
    });

    // Signed in or out after the page opened (another tab, a session restored
    // late): the page is chosen again, so the sign-in form never sits inside
    // the app and a private page never outlives its session.
    inject(SessionPlacement).start();

    inject(AppUpdate).start();
  }

  async signOut() {
    await this.auth.signOut();
    await this.router.navigateByUrl('/login');
  }
}
