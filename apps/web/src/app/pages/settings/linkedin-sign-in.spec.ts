import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  Router,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { Auth, type LinkedInConnection } from '../../core/auth';
import { Toast } from '../../shared/toast';
import { Confirm } from '../../ui';
import { LinkedInSignIn, linkProblem } from './linkedin-sign-in';

const OFF: LinkedInConnection = {
  connected: false,
  email: '',
  canDisconnect: false,
};
const ON: LinkedInConnection = {
  connected: true,
  email: 'alex@work.example',
  canDisconnect: true,
};

async function setup(
  state: LinkedInConnection,
  query: Record<string, string> = {},
  confirmed = true,
) {
  let now = state;
  const auth = {
    linkedInConnection: vi.fn(async () => now),
    connectLinkedIn: vi.fn().mockResolvedValue(undefined),
    disconnectLinkedIn: vi.fn(async () => {
      now = OFF;
    }),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: Auth, useValue: auth },
      { provide: Confirm, useValue: { ask: vi.fn(async () => confirmed) } },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: convertToParamMap(query) } },
      },
    ],
  });
  const navigate = vi
    .spyOn(TestBed.inject(Router), 'navigate')
    .mockResolvedValue(true);
  const fixture = TestBed.createComponent(LinkedInSignIn);
  await fixture.componentInstance.ready;
  fixture.detectChanges();
  const el: HTMLElement = fixture.nativeElement;
  const text = () => el.textContent ?? '';
  const press = async (id: string) => {
    (el.querySelector(id) as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const toast = TestBed.inject(Toast);
  return { fixture, el, text, press, auth, navigate, toast };
}

describe('LinkedInSignIn', () => {
  it('offers to connect LinkedIn and says what that does not give', async () => {
    const { text, press, auth, el } = await setup(OFF);
    expect(text()).toContain('Not connected');
    expect(text()).toContain('no access to your LinkedIn account');
    expect(el.querySelector('#ca-linkedin-disconnect')).toBeNull();
    await press('#ca-linkedin-connect');
    expect(auth.connectLinkedIn).toHaveBeenCalledTimes(1);
  });

  it('says why when LinkedIn could not be opened', async () => {
    const { el, press, auth } = await setup(OFF);
    auth.connectLinkedIn.mockRejectedValue(
      new Error('Connecting LinkedIn is not switched on yet.'),
    );
    await press('#ca-linkedin-connect');
    expect(el.querySelector('#ca-linkedin-problem')?.textContent).toContain(
      'not switched on yet',
    );
    expect(
      (el.querySelector('#ca-linkedin-connect') as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('shows the connected LinkedIn account and disconnects it after asking', async () => {
    const { text, press, auth, el, toast } = await setup(ON);
    expect(text()).toContain('Connected as alex@work.example');
    expect(el.querySelector('#ca-linkedin-connect')).toBeNull();
    await press('#ca-linkedin-disconnect');
    expect(auth.disconnectLinkedIn).toHaveBeenCalledTimes(1);
    expect(text()).toContain('Not connected');
    expect(toast.message()).toContain('disconnected');
  });

  it('leaves it connected when the question is answered no', async () => {
    const { text, press, auth } = await setup(ON, {}, false);
    await press('#ca-linkedin-disconnect');
    expect(auth.disconnectLinkedIn).not.toHaveBeenCalled();
    expect(text()).toContain('Connected as');
  });

  it('never offers to remove the only way into the account', async () => {
    const { text, el } = await setup({ ...ON, canDisconnect: false });
    expect(el.querySelector('#ca-linkedin-disconnect')).toBeNull();
    expect(text()).toContain('only way into this account');
  });

  it('confirms a connection on the way back from LinkedIn, once', async () => {
    const { toast, navigate, el } = await setup(ON, { linkedin: 'back' });
    expect(toast.message()).toBe('LinkedIn connected');
    expect(el.querySelector('#ca-linkedin-problem')).toBeNull();
    // the address is cleaned, so a reload does not say it again
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: {}, replaceUrl: true }),
    );
  });

  it('explains a LinkedIn account that belongs to another Jobbotix account', async () => {
    const { toast, el } = await setup(OFF, {
      linkedin: 'back',
      error: 'server_error',
      error_code: 'identity_already_exists',
      error_description: 'Identity is already linked to another user',
    });
    const said = el.querySelector('#ca-linkedin-problem')?.textContent ?? '';
    expect(said).toContain('another Jobbotix account');
    expect(said).not.toContain('Identity');
    expect(toast.message()).toBe('');
  });

  it('ignores an error in the address that is not from connecting', async () => {
    const { el, navigate } = await setup(OFF, { error: 'server_error' });
    expect(el.querySelector('#ca-linkedin-problem')).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('linkProblem', () => {
  const from = (q: string) => new URLSearchParams(q);
  it('is null without an error, calm about leaving, and plain otherwise', () => {
    expect(linkProblem(from('linkedin=back'))).toBeNull();
    expect(linkProblem(from('error=access_denied'))).toContain(
      'nothing changed',
    );
    const other = linkProblem(
      from(
        'error=server_error&error_description=Unable+to+exchange+external+code',
      ),
    );
    expect(other).toContain('did not work this time');
    expect(other).not.toContain('exchange');
  });
});
