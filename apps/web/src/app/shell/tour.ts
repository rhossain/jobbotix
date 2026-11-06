import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { Auth } from '../core/auth';
import { Viewport } from '../core/viewport';
import { ShellState } from './shell-state';

/**
 * One stop on the intro tour. The tour moves page by page through the daily
 * loop; `target` names a `data-tour` attribute on that page, and a step with
 * no target shows its card in the middle of the screen.
 */
export interface TourStep {
  route: string;
  target?: string;
  title: string;
  body: string;
  /** Wording for phones, where gestures and layout differ. */
  phoneBody?: string;
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    route: '/today',
    title: 'Welcome to Jobbotix',
    body: 'Jobbotix runs one loop: every morning a search finds remote roles and scores them, you read the good ones here, apply yourself, and track where each one stands. This tour shows where each part lives. It takes about a minute.',
  },
  {
    route: '/search',
    target: 'search-profile',
    title: '1. Say what you are looking for',
    body: 'Start here. List your target roles and stacks, set the remote rules and what to skip, then press Save profile. The morning search follows these choices and scores every posting against them.',
  },
  {
    route: '/search',
    target: 'search-prompt',
    title: '2. Set up the morning search',
    body: 'Press New ingest key, then Copy prompt: the key goes into the prompt and lets the run post to your account. Paste the prompt into a Claude scheduled task that runs every morning. Each run searches the job boards, scores what it finds, drafts letters for the best matches and sends the results here.',
  },
  {
    route: '/resume',
    target: 'resume',
    title: '3. Add your resume once',
    body: 'Paste or import your resume here. It is the starting point for every tailored resume and cover letter, so keep it complete and up to date.',
  },
  {
    route: '/today',
    target: 'today-summary',
    title: 'Each morning, start on Today',
    body: 'This line says what the last run found. Below it: follow-ups waiting on you, then new roles with the best match first.',
  },
  {
    route: '/today',
    target: 'today-new',
    title: 'Review the new roles',
    body: 'The ring is the match score out of 100. Open a role to see why it fits, the drafted cover letter and screening answers, a tailored resume and interview prep. Mark the ones you want as To apply.',
    phoneBody:
      'The ring is the match score out of 100. Tap a role for why it fits, the drafted letter and answers, a tailored resume and prep. Swipe a role right to mark it To apply, or left to skip it.',
  },
  {
    route: '/roles',
    target: 'roles-search',
    title: 'Every role in one list',
    body: 'Search, filter and sort everything the runs have found, and save filters as views. Found a role yourself? Use Add role and paste its link.',
    phoneBody:
      'Search, filter and sort everything the runs have found. Found a role yourself? Tap + at the top and paste its link.',
  },
  {
    route: '/board',
    target: 'board',
    title: 'Track where each application stands',
    body: 'New, To apply, Applied, Interview, Offer. Drag a card to the next column as things move. Jobbotix never applies for you: you send each application yourself, then move the card.',
    phoneBody:
      'New, To apply, Applied, Interview, Offer. Pick a column at the top, and change a card’s status from the card. You send each application yourself, then move the card.',
  },
  {
    route: '/settings',
    target: 'settings-ai',
    title: 'Optional: your own AI key',
    body: 'The morning run already writes letters and answers. Add an Anthropic API key here only if you also want to rewrite them inside the app; those calls are billed to your key.',
  },
  {
    route: '/today',
    title: 'You are set',
    body: 'Fill in your search profile, set up the morning task and add your resume; the first roles arrive after the next run. Take this tour again any time from Settings or the command menu (⌘K).',
    phoneBody:
      'Fill in your search profile, set up the morning task and add your resume; the first roles arrive after the next run. Take this tour again any time from More or Settings.',
  },
];

const SEEN_KEY = 'jb-tour-seen';
/** How long to wait for a step's element to appear after navigating. */
const FIND_TIMEOUT_MS = 4000;

/**
 * The intro tour: which step is showing and the element it points at. The
 * overlay (TourOverlay) draws it; pages only carry `data-tour` attributes.
 * Starts by itself the first time a user reaches Today on this device.
 */
@Injectable({ providedIn: 'root' })
export class Tour {
  private readonly router = inject(Router);
  private readonly auth = inject(Auth);
  private readonly shell = inject(ShellState);
  private readonly viewport = inject(Viewport);
  private readonly doc = inject(DOCUMENT);

  readonly steps = TOUR_STEPS;
  readonly active = signal(false);
  readonly index = signal(0);
  /** The element the current step points at; null for a centred card. */
  readonly target = signal<HTMLElement | null>(null);
  /** False while moving to the step's page and finding its element. */
  readonly ready = signal(false);

  readonly step = computed(() => this.steps[this.index()]);
  readonly body = computed(() => {
    const s = this.step();
    return (this.viewport.phone() && s.phoneBody) || s.body;
  });
  readonly isFirst = computed(() => this.index() === 0);
  readonly isLast = computed(() => this.index() === this.steps.length - 1);

  private run = 0;

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.maybeAutoStart(e.urlAfterRedirects));
    if (this.router.navigated) this.maybeAutoStart(this.router.url);
  }

  start(at = 0) {
    this.shell.paletteOpen.set(false);
    this.shell.moreOpen.set(false);
    this.active.set(true);
    void this.go(at);
  }

  next() {
    if (this.isLast()) this.end();
    else void this.go(this.index() + 1);
  }

  back() {
    if (!this.isFirst()) void this.go(this.index() - 1);
  }

  /** Closes the tour (finished or skipped); it will not start by itself again. */
  end() {
    this.run++;
    this.active.set(false);
    this.ready.set(false);
    this.target.set(null);
    this.markSeen();
  }

  seen(): boolean {
    try {
      return localStorage.getItem(this.seenKey()) === '1';
    } catch {
      return true; // no storage: never auto-start, the tour is still in the menus
    }
  }

  private markSeen() {
    try {
      localStorage.setItem(this.seenKey(), '1');
    } catch {
      /* storage unavailable */
    }
  }

  private seenKey() {
    return `${SEEN_KEY}:${this.auth.user()?.id ?? 'anon'}`;
  }

  private maybeAutoStart(url: string) {
    if (this.active() || !this.auth.isSignedIn()) return;
    if (url.split(/[?#]/)[0] !== '/today' || this.seen()) return;
    // Let Today paint first so the tour opens over the real page.
    setTimeout(() => {
      if (!this.active() && !this.seen() && this.onPage('/today')) this.start();
    }, 700);
  }

  private onPage(route: string) {
    return this.router.url.split(/[?#]/)[0] === route;
  }

  private async go(i: number) {
    const run = ++this.run;
    const step = this.steps[i];
    this.index.set(i);
    this.ready.set(false);
    this.target.set(null);

    if (!this.onPage(step.route)) {
      const ok = await this.router.navigateByUrl(step.route).catch(() => false);
      if (run !== this.run) return;
      // Navigation refused (e.g. unsaved resume changes kept the user there).
      if (!ok) return this.end();
    }

    const el = step.target ? await this.find(step.target, run) : null;
    if (run !== this.run) return;
    // Highlight only once the page has stopped scrolling, so the highlight
    // lands on the element instead of chasing it.
    if (el && this.reveal(el)) await this.scrollSettled();
    if (!step.target) this.toTop();
    if (run !== this.run) return;
    this.target.set(el);
    this.ready.set(true);
  }

  /** Waits for a visible `[data-tour=name]` element; null if it never shows. */
  private find(name: string, run: number): Promise<HTMLElement | null> {
    const started = Date.now();
    return new Promise((resolve) => {
      const look = () => {
        if (run !== this.run) return resolve(null);
        const el = [
          ...this.doc.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`),
        ].find((e) => e.getClientRects().length > 0);
        if (el) return resolve(el);
        if (Date.now() - started > FIND_TIMEOUT_MS) return resolve(null);
        setTimeout(look, 60);
      };
      look();
    });
  }

  /** Scrolls the element into view, leaving room for the card. */
  private reveal(el: HTMLElement): boolean {
    const win = this.doc.defaultView;
    if (!win) return false;
    const r = el.getBoundingClientRect();
    const vh = win.innerHeight;
    const phone = this.viewport.phone();
    // Phones: the card sits at the bottom, so put the element near the top.
    // Wider screens: centre it, or show its top when it is taller than that.
    const offset = phone
      ? 72
      : r.height > vh * 0.5
        ? 96
        : Math.max(96, (vh - r.height) / 2 - 80);
    const top = Math.max(0, win.scrollY + r.top - offset);
    if (Math.abs(top - win.scrollY) < 4) return false;
    const smooth = !win.matchMedia?.('(prefers-reduced-motion: reduce)')
      .matches;
    win.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
    return true;
  }

  /** A centred card is about the whole page: show it from the top. */
  private toTop() {
    const win = this.doc.defaultView;
    if (!win || win.scrollY < 4) return;
    const smooth = !win.matchMedia?.('(prefers-reduced-motion: reduce)')
      .matches;
    win.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
  }

  /** Resolves when the page has not moved for a few frames (at most 1.5 s). */
  private scrollSettled(): Promise<void> {
    const win = this.doc.defaultView;
    if (!win) return Promise.resolve();
    return new Promise((resolve) => {
      const started = Date.now();
      let last = win.scrollY;
      let still = 0;
      const check = () => {
        const y = win.scrollY;
        still = Math.abs(y - last) < 1 ? still + 1 : 0;
        last = y;
        // Smooth scrolling can take a frame or two to start; give it 150 ms.
        const elapsed = Date.now() - started;
        if ((still >= 5 && elapsed > 150) || elapsed > 1500) resolve();
        else win.requestAnimationFrame(check);
      };
      win.requestAnimationFrame(check);
    });
  }
}
