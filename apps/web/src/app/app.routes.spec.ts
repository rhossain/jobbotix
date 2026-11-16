import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { appRoutes } from './app.routes';

@Component({ template: '' })
class Stub {}

/** The old /roles addresses, with stand-ins for the pages they forward to. */
const routes = [
  ...appRoutes.filter((r) => r.path?.startsWith('roles')),
  { path: 'jobs', component: Stub },
  { path: 'jobs/new', component: Stub },
  { path: 'jobs/:id', component: Stub },
];

describe('old /roles links', () => {
  let router: Router;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter(routes)] });
    router = TestBed.inject(Router);
  });

  it.each([
    ['/roles', '/jobs'],
    ['/roles/abc-123', '/jobs/abc-123'],
    ['/roles/new', '/jobs/new'],
  ])('%s opens %s', async (from, to) => {
    await router.navigateByUrl(from);
    expect(router.url).toBe(to);
  });

  it('keeps what a bookmarklet or share sheet hands over', async () => {
    await router.navigateByUrl(
      '/roles/new?via=bookmarklet&url=https%3A%2F%2Facme.example%2Fjobs%2F1',
    );
    expect(router.url).toBe(
      '/jobs/new?via=bookmarklet&url=https:%2F%2Facme.example%2Fjobs%2F1',
    );
  });
});
