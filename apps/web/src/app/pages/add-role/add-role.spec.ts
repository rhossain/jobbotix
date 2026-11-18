import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  Router,
} from '@angular/router';
import { RolesRepo } from '../../core/data/repos';
import { environment } from '../../../environments/environment';
import { AddRole } from './add-role';

const LINKEDIN = 'https://www.linkedin.com/jobs/view/4012345678';
const POST =
  'Senior Angular Engineer at Acme. Remote, worldwide. You will build dashboards with Angular and RxJS and work with a small product team.';

async function setup(query: Record<string, string> = {}) {
  const addFromUrl = vi.fn().mockResolvedValue({ id: 'r1', existed: false });
  const listen = vi.spyOn(window, 'addEventListener');
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: RolesRepo, useValue: { addFromUrl } },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: convertToParamMap(query) } },
      },
    ],
  });
  vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(AddRole);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  const el: HTMLElement = fixture.nativeElement;
  const type = (id: string, value: string) => {
    const input = el.querySelector<HTMLInputElement | HTMLTextAreaElement>(id);
    if (!input) throw new Error(`${id} not found`);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const submit = async () => {
    (el.querySelector('button[type=submit]') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const listensForPageText = () =>
    listen.mock.calls.some(([name]) => name === 'message');
  return { fixture, el, addFromUrl, type, submit, listensForPageText };
}

describe('AddRole with a LinkedIn link', () => {
  // The live app, where the text is optional and pages are read for the
  // user. (The demo always asks for the text, whatever the link.)
  const demo = environment.demo;
  beforeEach(() => (environment.demo = false));
  afterEach(() => {
    environment.demo = demo;
    vi.restoreAllMocks();
  });

  it('asks for the text of the post and sends nothing without it', async () => {
    const { el, addFromUrl, type, submit } = await setup();
    type('#add-url', LINKEDIN);
    expect(el.querySelector('#add-linkedin')?.textContent).toContain(
      'Jobbotix does not open LinkedIn pages',
    );
    await submit();
    expect(addFromUrl).not.toHaveBeenCalled();
    expect(el.querySelector('[role=alert]')?.textContent).toContain(
      'Jobbotix does not open pages on LinkedIn',
    );
    expect(el.ownerDocument.activeElement?.id).toBe('add-text');
  });

  it('adds the job once the post is pasted, keeping the link', async () => {
    const { addFromUrl, type, submit } = await setup();
    type('#add-url', LINKEDIN);
    type('#add-text', POST);
    await submit();
    // kept under the job's own short link
    expect(addFromUrl).toHaveBeenCalledWith(`${LINKEDIN}/`, POST);
  });

  it('keeps the short job link when the link came from a search page', async () => {
    const { addFromUrl, type, submit } = await setup();
    type(
      '#add-url',
      'https://www.linkedin.com/jobs/search-results/?currentJobId=4480004226&eBP=CwEAAAGh7aVVoBeW&refId=hrbf%3D%3D&trackingId=BX%2FrO6%3D%3D&keywords=Frontend%20Developer&geoId=103363366',
    );
    type('#add-text', POST);
    await submit();
    expect(addFromUrl).toHaveBeenCalledWith(
      'https://www.linkedin.com/jobs/view/4480004226/',
      POST,
    );
  });

  it('knows short links and country sites, and leaves other sites alone', async () => {
    const { el, type } = await setup();
    for (const url of [
      'https://lnkd.in/gAbCdEf',
      'https://bd.linkedin.com/jobs/view/1',
    ]) {
      type('#add-url', url);
      expect(el.querySelector('#add-linkedin'), url).not.toBeNull();
    }
    type('#add-url', 'https://boards.greenhouse.io/acme/jobs/1');
    expect(el.querySelector('#add-linkedin')).toBeNull();
  });

  it('does not add a LinkedIn link shared from the phone by itself', async () => {
    const { el, addFromUrl } = await setup({
      text: `Check out this job at Acme: ${LINKEDIN}`,
    });
    await Promise.resolve();
    expect(addFromUrl).not.toHaveBeenCalled();
    expect(el.querySelector<HTMLInputElement>('#add-url')?.value).toBe(
      LINKEDIN,
    );
    expect(el.querySelector('#add-linkedin')).not.toBeNull();
    expect(el.querySelector('#add-old-button')).toBeNull();
  });

  it('never listens for page text sent by an old bookmarklet', async () => {
    const opener = Object.getOwnPropertyDescriptor(window, 'opener');
    Object.defineProperty(window, 'opener', {
      value: {},
      configurable: true,
    });
    try {
      const li = await setup({ via: 'bookmarklet', url: LINKEDIN });
      expect(li.listensForPageText()).toBe(false);
      expect(li.addFromUrl).not.toHaveBeenCalled();
      expect(li.el.querySelector('#add-linkedin')).not.toBeNull();
      // and says the saved bookmark should be swapped for the current one
      expect(li.el.querySelector('#add-old-button')).not.toBeNull();
    } finally {
      if (opener) Object.defineProperty(window, 'opener', opener);
      else Reflect.deleteProperty(window, 'opener');
    }
  });

  it('still adds a job from any other site in one step', async () => {
    const { addFromUrl } = await setup({
      url: 'https://boards.greenhouse.io/acme/jobs/1',
    });
    await Promise.resolve();
    expect(addFromUrl).toHaveBeenCalledWith(
      'https://boards.greenhouse.io/acme/jobs/1',
      '',
    );
  });
});
