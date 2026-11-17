import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { demoDataProviders } from '../../app.config';
import { AccountDataRepo, RolesRepo } from '../../core/data/repos';
import { RoleDetail } from './role-detail';

const POST =
  'Senior Angular Engineer at Acme. Remote, worldwide. You will build dashboards with Angular and RxJS and work with a small product team.';

async function setup(url: string) {
  localStorage.clear();
  TestBed.configureTestingModule({
    providers: [provideRouter([]), ...demoDataProviders],
  });
  const roles = TestBed.inject(RolesRepo);
  await TestBed.inject(AccountDataRepo).importRoles([
    {
      company: 'Vandelay',
      title: 'Latex Frontend Engineer',
      url,
      status: 'shortlist',
      location: '',
      salary: '',
      notes: '',
      source: 'LinkedIn export',
    },
  ]);
  const role = roles.roles().find((r) => r.url === url);
  if (!role) throw new Error('the job was not imported');
  const rescore = vi
    .spyOn(roles, 'rescore')
    .mockResolvedValue({ score: 71, method: 'heuristic' });
  const fixture = TestBed.createComponent(RoleDetail);
  fixture.componentRef.setInput('id', role.id);
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  await settle();
  const el: HTMLElement = fixture.nativeElement;
  const current = () => roles.roles().find((r) => r.id === role.id);
  return { el, settle, rescore, current };
}

describe('RoleDetail: a job that came in without its post', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('asks for the post, keeps it on the job and scores from it', async () => {
    const { el, settle, rescore, current } = await setup(
      'https://www.linkedin.com/jobs/view/4012345678/',
    );
    const card = el.querySelector('#paste-post');
    expect(card?.textContent).toContain('Paste the job post to get a score');
    expect(card?.textContent).toContain(
      'Jobbotix does not open pages on LinkedIn',
    );

    // too short to be a job post: nothing is saved
    (el.querySelector('#paste-post-save') as HTMLButtonElement).click();
    await settle();
    expect(el.querySelector('#paste-post [role=alert]')?.textContent).toContain(
      'Paste the whole job post',
    );
    expect(rescore).not.toHaveBeenCalled();
    expect(current()?.posting_text).toBe('');

    const box = el.querySelector('#paste-post-text') as HTMLTextAreaElement;
    box.value = POST;
    box.dispatchEvent(new Event('input'));
    (el.querySelector('#paste-post-save') as HTMLButtonElement).click();
    await settle();
    expect(current()?.posting_text).toBe(POST);
    expect(rescore).toHaveBeenCalledTimes(1);
    // the post is on the job now, so the card is gone
    expect(el.querySelector('#paste-post')).toBeNull();
  });

  it('does not mention LinkedIn for a job from somewhere else', async () => {
    const { el } = await setup('https://vandelay.example/careers/9');
    const card = el.querySelector('#paste-post');
    expect(card).not.toBeNull();
    expect(card?.textContent).not.toContain('LinkedIn');
  });
});
