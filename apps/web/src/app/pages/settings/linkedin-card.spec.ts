import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { environment } from '../../../environments/environment';
import { demoDataProviders } from '../../app.config';
import { LinkedInCard } from './linkedin-card';

async function render(signIn: boolean, data: boolean) {
  environment.linkedinConnect = signIn;
  environment.linkedinImport = data;
  TestBed.configureTestingModule({
    providers: [provideRouter([]), ...demoDataProviders],
  });
  const fixture = TestBed.createComponent(LinkedInCard);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('LinkedInCard', () => {
  const was = { ...environment };
  afterEach(() => Object.assign(environment, was));

  it('keeps signing in and the data file in one LinkedIn card', async () => {
    const el = await render(true, true);
    expect(el.querySelectorAll('section.jb-card').length).toBe(1);
    expect(el.querySelector('#linkedin-h')?.textContent).toContain('LinkedIn');
    expect(el.querySelector('#linkedin-sign-in')).not.toBeNull();
    expect(el.querySelector('#linkedin-data')).not.toBeNull();
    // connecting the account is not what fetches the jobs: said up front
    expect(el.querySelector('#linkedin-lead')?.textContent).toContain(
      'connecting your account does not fetch them',
    );
  });

  it('shows the data file alone while signing in is switched off', async () => {
    const el = await render(false, true);
    expect(el.querySelector('#linkedin-sign-in')).toBeNull();
    expect(el.querySelector('#linkedin-data')).not.toBeNull();
    expect(el.querySelector('#li-file')).not.toBeNull();
    expect(el.querySelector('#linkedin-lead')?.textContent).not.toContain(
      'Sign in',
    );
  });

  it('is not there at all when both are off', async () => {
    const el = await render(false, false);
    expect(el.querySelector('#linkedin')).toBeNull();
  });
});
