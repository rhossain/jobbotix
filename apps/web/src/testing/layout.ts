/// <reference types="@vitest/browser-playwright" />
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  Router,
  provideRouter,
  withComponentInputBinding,
} from '@angular/router';
import { cdp, page } from 'vitest/browser';
import { App } from '../app/app';
import { demoDataProviders } from '../app/app.config';
import { appRoutes } from '../app/app.routes';
import { Auth } from '../app/core/auth';
import { MemoryRolesRepo } from '../app/core/data/memory-repos';
import { DEMO_USER_ID } from '../app/core/data/sample-data';
import type { RoleEventRow, RoleRow } from '@jobbotix/shared-types';

/**
 * Helpers for the layout specs (*.layout.spec.ts). Those run in a real
 * browser, so the global stylesheets and media queries apply and every size
 * below is measured, not assumed.
 */

export interface ViewportSize {
  width: number;
  height: number;
  /**
   * A touch screen: `(pointer: coarse)` matches, so the larger touch sizes
   * in the stylesheets apply, as they do on a real phone or tablet.
   */
  touch: boolean;
}

/** Widths the app has to work at, from the smallest phone in use up. */
export const VIEWPORTS = {
  'small phone': { width: 320, height: 640, touch: true },
  phone: { width: 390, height: 844, touch: true },
  'large phone': { width: 430, height: 932, touch: true },
  tablet: { width: 768, height: 1024, touch: true },
  'small laptop': { width: 1024, height: 768, touch: false },
  laptop: { width: 1280, height: 800, touch: false },
  desktop: { width: 1440, height: 900, touch: false },
} as const satisfies Record<string, ViewportSize>;

export type ViewportName = keyof typeof VIEWPORTS;

/** Sizes the browser and turns touch emulation on or off to match. */
export async function setViewport(size: ViewportSize) {
  await page.viewport(size.width, size.height);
  await cdp().send(
    'Emulation.setTouchEmulationEnabled',
    size.touch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false },
  );
}

/** The shell layout each width should get (see core/viewport.ts). */
export function expectedShell(width: number): 'phone' | 'rail' | 'full' {
  if (width < 768) return 'phone';
  if (width < 1280) return 'rail';
  return 'full';
}

const DEMO_KEY = 'jobbotix.demo.v1';

/**
 * Clears the demo data and any saved UI state so each render starts clean.
 * The first-run tour is marked as seen unless `tour` is true: it opens on
 * Today after 700ms and would otherwise land on top of whatever is measured.
 */
export function resetStorage({ tour = false }: { tour?: boolean } = {}) {
  try {
    localStorage.clear();
    sessionStorage.clear();
    if (!tour) localStorage.setItem(`jb-tour-seen:${DEMO_USER_ID}`, '1');
  } catch {
    /* storage blocked: the app falls back to sample data anyway */
  }
}

/** The demo data as it sits in storage (see core/data/memory-repos.ts). */
export interface DemoData {
  roles: RoleRow[];
  events: RoleEventRow[];
  [key: string]: unknown;
}

/**
 * Lets a test change the demo data before the app boots: the repo writes its
 * full default state once, the test edits it, and the next render reads it.
 */
export async function withDemoData(mutate: (data: DemoData) => void) {
  TestBed.configureTestingModule({ providers: [...demoDataProviders] });
  // Any change persists the whole state; this one touches no role.
  await TestBed.inject(MemoryRolesRepo).setNotes('no-such-role', '');
  TestBed.resetTestingModule();
  const raw = localStorage.getItem(DEMO_KEY);
  if (!raw) throw new Error('withDemoData: the demo state was not written');
  const data = JSON.parse(raw) as DemoData;
  mutate(data);
  localStorage.setItem(DEMO_KEY, JSON.stringify(data));
}

export interface RenderOptions {
  /** Sign the demo user out first (public pages). */
  signedOut?: boolean;
}

export interface Rendered {
  fixture: ComponentFixture<App>;
  router: Router;
  /** Re-run change detection and wait for the app to settle. */
  settle: () => Promise<void>;
}

/** Waits for Angular, deferred blocks, fonts and two paint frames. */
async function settleFixture(fixture: ComponentFixture<App>) {
  for (let i = 0; i < 3; i++) {
    await fixture.whenStable();
    fixture.detectChanges();
  }
  await document.fonts?.ready;
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  // Let open/enter transitions finish so panels are measured where they rest
  // (infinite ones, like a loading pulse, are left running).
  const finite = document
    .getAnimations()
    .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity);
  await Promise.race([
    Promise.allSettled(finite.map((a) => a.finished)),
    new Promise((r) => setTimeout(r, 1500)),
  ]);
  await new Promise((r) => requestAnimationFrame(() => r(null)));
}

/**
 * Renders the whole app at a viewport size and navigates to a URL, with the
 * same routes and in-memory demo data the dev build uses.
 */
export async function renderApp(
  url: string,
  viewport: ViewportName | ViewportSize,
  opts: RenderOptions = {},
): Promise<Rendered> {
  const size = typeof viewport === 'string' ? VIEWPORTS[viewport] : viewport;
  await setViewport(size);

  TestBed.configureTestingModule({
    imports: [App],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter(appRoutes, withComponentInputBinding()),
      ...demoDataProviders,
    ],
  });
  const fixture = TestBed.createComponent(App);
  const router = TestBed.inject(Router);
  if (opts.signedOut) await TestBed.inject(Auth).signOut();

  await router.navigateByUrl(url);
  await settleFixture(fixture);
  window.scrollTo(0, 0);
  return { fixture, router, settle: () => settleFixture(fixture) };
}

/**
 * Waits until an element matching `selector` is on screen. Overlays render in
 * @defer blocks and open their <dialog> a tick later, so a fixed number of
 * change-detection passes is not enough to catch them reliably.
 */
export async function waitForRendered(
  selector: string,
  settle: () => Promise<void>,
  timeoutMs = 3000,
): Promise<Element> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const el = [...document.querySelectorAll(selector)].find(isRendered);
    if (el) {
      await settle(); // and let its open transition finish
      return el;
    }
    if (Date.now() > until) throw new Error(`${selector} never appeared`);
    await settle();
  }
}

/* ---------------------------------------------------------------- probes */

/** A short, readable name for an element in failure messages. */
export function describeEl(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  for (let depth = 0; node && depth < 3; depth++) {
    let s = node.tagName.toLowerCase();
    if (node.id) s += `#${node.id}`;
    const cls = [...node.classList].slice(0, 3);
    if (cls.length) s += '.' + cls.join('.');
    parts.unshift(s);
    if (node.tagName.includes('-')) break; // stop at the component
    node = node.parentElement;
  }
  const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
  return parts.join(' > ') + (text ? ` "${text}"` : '');
}

/** Hidden from sight: display none, visibility hidden, or zero-sized. */
export function isRendered(el: Element): boolean {
  const html = el as HTMLElement;
  if (!html.isConnected) return false;
  if (typeof html.checkVisibility === 'function') {
    if (
      !html.checkVisibility({ opacityProperty: true, visibilityProperty: true })
    )
      return false;
  }
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** Screen-reader-only text (the sr-only clip pattern). */
function isVisuallyHidden(el: Element): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (
      cs.position === 'absolute' &&
      (cs.clip === 'rect(0px, 0px, 0px, 0px)' ||
        cs.clipPath === 'inset(50%)') &&
      parseFloat(cs.width) <= 1
    )
      return true;
  }
  return false;
}

/**
 * True when a scroll container or a clip between the element and the page
 * keeps it from widening the page (a carousel row, a code block, a board
 * with its own horizontal scroll).
 */
function clippedByAncestor(el: Element, vw: number): boolean {
  for (
    let n = el.parentElement;
    n && n !== document.body;
    n = n.parentElement
  ) {
    const cs = getComputedStyle(n);
    if (cs.overflowX !== 'visible' || cs.contain.includes('paint')) {
      const r = n.getBoundingClientRect();
      // The clipping box itself has to fit, or the overflow just moves up.
      return r.left >= -1 && r.right <= vw + 1;
    }
  }
  return false;
}

/** Off-screen by design: parked outside the viewport (skip link, closed drawer). */
function parkedOffscreen(el: Element, r: DOMRect, vw: number, vh: number) {
  const fullyOut =
    r.right <= 0 || r.left >= vw || r.bottom <= 0 || r.top >= vh * 4;
  if (!fullyOut) return false;
  for (let n: Element | null = el; n; n = n.parentElement) {
    const pos = getComputedStyle(n).position;
    if (pos === 'fixed' || pos === 'absolute') return true;
  }
  return false;
}

/** Page-wide horizontal scroll: the classic "page wobbles sideways on a phone". */
export function pageScrollsSideways() {
  const doc = document.documentElement;
  return {
    scrollWidth: Math.max(doc.scrollWidth, document.body.scrollWidth),
    clientWidth: doc.clientWidth,
  };
}

/**
 * Every rendered element that pokes past the left or right edge of the
 * viewport without a scroll container to hold it.
 */
export function horizontalOverflow(root: Element = document.body): string[] {
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const out: string[] = [];
  const seen = new Set<Element>();
  const spills: { el: Element; right: number }[] = [];
  for (const el of root.querySelectorAll('*')) {
    if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
    if (!isRendered(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right <= vw + 1 && r.left >= -1) {
      // The box fits, but its text may spill out of it (a long word or URL
      // in a box that neither wraps nor clips it).
      const html = el as HTMLElement;
      const spill = html.scrollWidth - html.clientWidth;
      if (
        spill > 1 &&
        html.clientWidth > 0 &&
        getComputedStyle(el).overflowX === 'visible' &&
        r.left + html.scrollWidth > vw + 1 &&
        !clippedByAncestor(el, vw)
      ) {
        spills.push({ el, right: r.left + html.scrollWidth });
      }
      continue;
    }
    if (parkedOffscreen(el, r, vw, vh)) continue;
    if (isVisuallyHidden(el)) continue;
    if (clippedByAncestor(el, vw)) continue;
    // Report the outermost offender only; its children follow it out.
    if ([...seen].some((s) => s.contains(el))) continue;
    seen.add(el);
    out.push(
      `${describeEl(el)} spans ${Math.round(r.left)}–${Math.round(r.right)}px in a ${vw}px viewport`,
    );
  }
  // Spilled content: every ancestor of the culprit spills too, so name the
  // innermost box, skipping any already inside a reported offender.
  for (const s of spills) {
    if (spills.some((o) => o !== s && s.el.contains(o.el))) continue;
    if ([...seen].some((o) => o.contains(s.el) || s.el.contains(o))) continue;
    out.push(
      `${describeEl(s.el)} fits, but its content spills to ${Math.round(s.right)}px in a ${vw}px viewport`,
    );
  }
  return out;
}

const INTERACTIVE =
  'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="tab"], [role="link"], [role="menuitem"], [role="option"], [role="switch"], [role="checkbox"], [role="radio"]';

/** A link inside running text, which WCAG 2.5.8 exempts from target size. */
function isInlineTextLink(el: Element): boolean {
  if (el.tagName !== 'A') return false;
  if (getComputedStyle(el).display !== 'inline') return false;
  const parent = el.parentElement;
  if (!parent) return false;
  const ownText = [...parent.childNodes]
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent ?? '')
    .join('')
    .trim();
  return ownText.length > 0;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The area that actually takes the tap. A "stretched link" (an ::after with
 * inset 0, used on cards) covers its positioned ancestor; a checkbox or radio
 * inside its <label> is hit through the label.
 */
function hitArea(el: Element): Box {
  let box: Box = el.getBoundingClientRect();
  const after = getComputedStyle(el, '::after');
  if (
    after.content !== 'none' &&
    after.position === 'absolute' &&
    after.top === '0px' &&
    after.left === '0px'
  ) {
    for (let n = el.parentElement; n; n = n.parentElement) {
      if (getComputedStyle(n).position !== 'static') {
        box = n.getBoundingClientRect();
        break;
      }
    }
  }
  const label = (el as HTMLInputElement).labels?.[0];
  if (label && isRendered(label)) {
    const lr = label.getBoundingClientRect();
    box = {
      left: Math.min(box.left, lr.left),
      top: Math.min(box.top, lr.top),
      right: Math.max(box.right, lr.right),
      bottom: Math.max(box.bottom, lr.bottom),
    };
  }
  return box;
}

/** The fixed-position layer an element lives in (null: the page itself). */
function fixedLayer(el: Element): Element | null {
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (getComputedStyle(n).position === 'fixed') return n;
  }
  return null;
}

function distanceToBox(x: number, y: number, b: Box): number {
  const dx = Math.max(b.left - x, 0, x - b.right);
  const dy = Math.max(b.top - y, 0, y - b.bottom);
  return Math.hypot(dx, dy);
}

/**
 * Controls that fail the WCAG 2.2 AA target size (2.5.8): smaller than
 * `min`×`min` px, unless a `min`-px circle centred on them touches no other
 * control (the spacing exception). Inline links in running text are exempt.
 */
export function smallTargets(
  min = 24,
  root: Element = document.body,
): string[] {
  const targets = [...root.querySelectorAll(INTERACTIVE)]
    .filter(
      (el) =>
        isRendered(el) &&
        !isVisuallyHidden(el) &&
        !el.closest('[inert], [aria-hidden="true"]') &&
        !isInlineTextLink(el),
    )
    .map((el) => {
      const box = hitArea(el);
      const w = box.right - box.left;
      const h = box.bottom - box.top;
      return {
        el,
        layer: fixedLayer(el),
        box,
        w,
        h,
        cx: box.left + w / 2,
        cy: box.top + h / 2,
        small: w + 0.5 < min || h + 0.5 < min,
      };
    });

  const r = min / 2;
  const out: string[] = [];
  for (const t of targets) {
    if (!t.small) continue;
    const crowded = targets.find((o) => {
      if (o === t || o.el.contains(t.el) || t.el.contains(o.el)) return false;
      // Page content scrolled under a fixed bar is not crowding it.
      if (o.layer !== t.layer) return false;
      return o.small
        ? Math.hypot(o.cx - t.cx, o.cy - t.cy) < min
        : distanceToBox(t.cx, t.cy, o.box) < r;
    });
    if (crowded) {
      out.push(
        `${describeEl(t.el)} is ${Math.round(t.w)}×${Math.round(t.h)}px and crowds ${describeEl(crowded.el)}`,
      );
    }
  }
  return out;
}

/** Visible text set below `min` px, which phones render too small to read. */
export function tinyText(min = 11, root: Element = document.body): string[] {
  const out: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const seen = new Set<Element>();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || seen.has(el) || !(n.textContent ?? '').trim()) continue;
    seen.add(el);
    if (!isRendered(el) || isVisuallyHidden(el) || el.closest('svg')) continue;
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (px < min) out.push(`${describeEl(el)} is ${px}px`);
  }
  return out;
}

/**
 * On a phone the fixed tab bar sits over the bottom of the page. After
 * scrolling to the end, the last piece of content must sit above it.
 */
export async function contentBehindTabBar(
  settle: () => Promise<void> = async () => undefined,
): Promise<string | null> {
  const bar = document.querySelector('jb-tab-bar');
  const main = document.querySelector('main#main');
  if (!bar || !main || !isRendered(bar)) return null;
  // Scrolling can wake @defer (on viewport) blocks that make the page longer,
  // so keep going until the height stops changing, as a reader would.
  let height = -1;
  for (
    let i = 0;
    i < 6 && height !== document.documentElement.scrollHeight;
    i++
  ) {
    height = document.documentElement.scrollHeight;
    window.scrollTo(0, height);
    await settle();
  }
  const barTop = bar.getBoundingClientRect().top;
  let lowest: Element | null = null;
  let bottom = -Infinity;
  for (const el of main.querySelectorAll('*')) {
    if (!isRendered(el) || isVisuallyHidden(el)) continue;
    const pos = getComputedStyle(el).position;
    if (pos === 'fixed' || pos === 'sticky') continue;
    const r = el.getBoundingClientRect();
    if (r.bottom > bottom) {
      bottom = r.bottom;
      lowest = el;
    }
  }
  window.scrollTo(0, 0);
  if (!lowest || bottom <= barTop + 1) return null;
  return `${describeEl(lowest)} ends at ${Math.round(bottom)}px, under the tab bar at ${Math.round(barTop)}px`;
}

/** Fails with a readable list when a probe found anything. */
export function report(label: string, found: string[]): string {
  return found.length
    ? `${label}:\n  - ${found.slice(0, 15).join('\n  - ')}${found.length > 15 ? `\n  …and ${found.length - 15} more` : ''}`
    : '';
}
