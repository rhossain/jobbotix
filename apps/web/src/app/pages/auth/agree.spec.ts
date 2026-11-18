import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  Router,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { Auth } from '../../core/auth';
import { Agree } from './agree';

async function setup(next?: string) {
  const acceptTerms = vi.fn().mockResolvedValue(undefined);
  const signOut = vi.fn().mockResolvedValue(undefined);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: Auth, useValue: { acceptTerms, signOut } },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: { queryParamMap: convertToParamMap(next ? { next } : {}) },
        },
      },
    ],
  });
  const go = vi
    .spyOn(TestBed.inject(Router), 'navigateByUrl')
    .mockResolvedValue(true);
  const fixture = TestBed.createComponent(Agree);
  fixture.detectChanges();
  const el: HTMLElement = fixture.nativeElement;
  const press = async (id: string) => {
    (el.querySelector(id) as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  return { el, press, acceptTerms, signOut, go };
}

describe('Agree', () => {
  it('links both pages and records agreement, then goes on', async () => {
    const { el, press, acceptTerms, go } = await setup('/jobs/new');
    const links = [...el.querySelectorAll('a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(links).toEqual(expect.arrayContaining(['/terms', '/privacy']));
    await press('#agree-continue');
    expect(acceptTerms).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith('/jobs/new', { replaceUrl: true });
  });

  it('stays and says why when it could not be saved', async () => {
    const { el, press, acceptTerms, go } = await setup();
    acceptTerms.mockRejectedValue(new Error('Offline'));
    await press('#agree-continue');
    expect(el.textContent).toContain('Offline');
    expect(go).not.toHaveBeenCalled();
  });

  it('lets the person sign out instead', async () => {
    const { press, signOut, acceptTerms } = await setup();
    await press('#agree-sign-out');
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(acceptTerms).not.toHaveBeenCalled();
  });
});
