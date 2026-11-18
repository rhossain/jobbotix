import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { App } from './app';
import { SUPABASE } from './core/supabase';

/** Enough of supabase-js for the shell to boot signed out. */
const supabaseStub = {
  auth: {
    getSession: () => Promise.resolve({ data: { session: null }, error: null }),
    onAuthStateChange: () => ({
      data: { subscription: { unsubscribe: () => undefined } },
    }),
  },
};

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        { provide: SUPABASE, useValue: supabaseStub },
      ],
    }).compileComponents();
  });

  it('renders the product name in the header', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('header')?.textContent).toContain('Jobbotix');
  });

  it('shows no navigation while signed out', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('nav')).toBeNull();
  });

  it('never draws the app around the sign-in form, even with a session', async () => {
    @Component({ template: '<form id="signin"></form>' })
    class SignIn {}
    const session = {
      access_token: 't',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: 'u1', email: 'a@b.c' },
    };
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        // no guard on purpose: the layout must hold even if one is missed
        provideRouter([{ path: 'login', component: SignIn }]),
        {
          provide: SUPABASE,
          useValue: {
            ...supabaseStub,
            auth: {
              ...supabaseStub.auth,
              getSession: () =>
                Promise.resolve({ data: { session }, error: null }),
            },
            from: () => ({
              select: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: null }),
                }),
              }),
            }),
            channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
            removeChannel: () => Promise.resolve(),
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(App);
    await TestBed.inject(Router).navigateByUrl('/login');
    await fixture.whenStable();
    fixture.detectChanges();
    const page = fixture.nativeElement as HTMLElement;
    expect(page.querySelector('#signin')).not.toBeNull();
    expect(page.querySelector('jb-sidebar')).toBeNull();
    expect(page.querySelector('.jb-shell')).toBeNull();
  });
});
