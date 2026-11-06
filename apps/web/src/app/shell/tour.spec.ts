import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, RouterOutlet, provideRouter } from '@angular/router';
import { Auth } from '../core/auth';
import { Viewport } from '../core/viewport';
import { TOUR_STEPS, Tour } from './tour';

@Component({ template: '<p data-tour="today-summary">Today</p>' })
class TodayStub {}

@Component({ template: '<form data-tour="search-profile">Search</form>' })
class SearchStub {}

@Component({ imports: [RouterOutlet], template: '<router-outlet />' })
class Host {}

describe('Tour', () => {
  let router: Router;
  let blockSearch = false;

  beforeEach(() => {
    localStorage.clear();
    blockSearch = false;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // jsdom lays nothing out; treat every element as on screen.
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([
      {},
    ] as unknown as DOMRectList);
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'today', component: TodayStub },
          {
            path: 'search',
            component: SearchStub,
            canActivate: [() => !blockSearch],
          },
          { path: '**', component: TodayStub },
        ]),
        {
          provide: Auth,
          useValue: { isSignedIn: signal(true), user: signal({ id: 'u1' }) },
        },
        { provide: Viewport, useValue: { phone: signal(false) } },
      ],
    });
    router = TestBed.inject(Router);
    TestBed.createComponent(Host).autoDetectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function settle() {
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(200);
      TestBed.tick();
    }
  }

  it('starts by itself on the first visit to Today, once', async () => {
    const tour = TestBed.inject(Tour);
    await router.navigateByUrl('/today');
    await settle();
    expect(tour.active()).toBe(true);
    expect(tour.index()).toBe(0);

    tour.end();
    expect(localStorage.getItem('jb-tour-seen:u1')).toBe('1');
    await router.navigateByUrl('/search');
    await router.navigateByUrl('/today');
    await settle();
    expect(tour.active()).toBe(false);
  });

  it('does not start on other pages', async () => {
    const tour = TestBed.inject(Tour);
    await router.navigateByUrl('/search');
    await settle();
    expect(tour.active()).toBe(false);
  });

  it('moves to each step’s page and finds its element', async () => {
    localStorage.setItem('jb-tour-seen:u1', '1');
    const tour = TestBed.inject(Tour);
    await router.navigateByUrl('/today');
    tour.start();
    await settle();
    expect(tour.ready()).toBe(true);
    expect(tour.target()).toBeNull(); // the welcome card has no target

    tour.next();
    await settle();
    expect(router.url).toBe('/search');
    expect(tour.target()?.dataset['tour']).toBe('search-profile');

    tour.back();
    await settle();
    expect(router.url).toBe('/today');
    expect(tour.index()).toBe(0);
  });

  it('ends when a page refuses to be left', async () => {
    localStorage.setItem('jb-tour-seen:u1', '1');
    blockSearch = true;
    const tour = TestBed.inject(Tour);
    await router.navigateByUrl('/today');
    tour.start();
    tour.next();
    await settle();
    expect(tour.active()).toBe(false);
  });

  it('finishes after the last step', async () => {
    const tour = TestBed.inject(Tour);
    tour.start(TOUR_STEPS.length - 1);
    await settle();
    expect(tour.isLast()).toBe(true);
    tour.next();
    expect(tour.active()).toBe(false);
  });
});
