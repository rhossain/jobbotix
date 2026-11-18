import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Auth } from '../../core/auth';
import { Signup } from './signup';

async function setup(open = true, codeIsValid = true) {
  const signUp = vi.fn().mockResolvedValue(undefined);
  const calls: string[] = [];
  const reserveLinkedInSignup = vi.fn(async () => {
    calls.push('reserve');
  });
  const signInWithLinkedIn = vi.fn(async () => {
    calls.push('linkedin');
  });
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: Auth,
        useValue: {
          signUp,
          reserveLinkedInSignup,
          signInWithLinkedIn,
          signupIsOpen: async () => open,
          inviteCodeIsValid: async () => codeIsValid,
          isSignedIn: () => false,
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(Signup);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  const el: HTMLElement = fixture.nativeElement;
  const button = el.querySelector('button[type=submit]') as HTMLButtonElement;
  const type = (id: string, value: string) => {
    const input = el.querySelector<HTMLInputElement>(id);
    if (!input) throw new Error(`${id} not found`);
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };
  const fill = (confirm: string) => {
    type('#signup-name', 'Alex Morgan');
    type('#signup-email', 'alex@example.com');
    type('#signup-password', 'secret-words');
    type('#signup-confirm', confirm);
  };
  const linkedIn = () =>
    el.querySelector('#linkedin-continue') as HTMLButtonElement;
  const press = async () => {
    linkedIn().click();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  return {
    fixture,
    el,
    button,
    signUp,
    fill,
    type,
    press,
    calls,
    reserveLinkedInSignup,
    signInWithLinkedIn,
  };
}

describe('Signup', () => {
  it('asks for the password a second time', async () => {
    const { fixture, el, button, signUp, fill } = await setup();
    fill('');
    button.click();
    fixture.detectChanges();
    expect(el.textContent).toContain('Type the password a second time');
    expect(signUp).not.toHaveBeenCalled();
    expect(el.ownerDocument.activeElement?.id).toBe('signup-confirm');
  });

  it('does not create the account when the two passwords differ', async () => {
    const { fixture, el, button, signUp, fill } = await setup();
    fill('secret-wards');
    button.click();
    fixture.detectChanges();
    expect(el.textContent).toContain('The two passwords are not the same');
    expect(signUp).not.toHaveBeenCalled();
  });

  it('creates the account when they match', async () => {
    const { fixture, button, signUp, fill } = await setup();
    fill('secret-words');
    button.click();
    await fixture.whenStable();
    expect(signUp).toHaveBeenCalledTimes(1);
    expect(signUp.mock.calls[0][0]).toMatchObject({
      email: 'alex@example.com',
      password: 'secret-words',
    });
  });

  it('shows or hides both password boxes with the eye', async () => {
    const { fixture, el } = await setup();
    const first = el.querySelector('#signup-password') as HTMLInputElement;
    const second = el.querySelector('#signup-confirm') as HTMLInputElement;
    const eyes = el.querySelectorAll<HTMLButtonElement>('jb-eye-toggle button');
    expect(eyes.length).toBe(2);
    eyes[0].click();
    fixture.detectChanges();
    expect([first.type, second.type]).toEqual(['text', 'text']);
    eyes[1].click();
    fixture.detectChanges();
    expect([first.type, second.type]).toEqual(['password', 'password']);
  });

  describe('with LinkedIn', () => {
    it('goes straight to LinkedIn while sign-up is open', async () => {
      const { press, calls, signInWithLinkedIn, signUp } = await setup(true);
      await press();
      expect(calls).toEqual(['linkedin']);
      expect(signInWithLinkedIn).toHaveBeenCalledWith('/today');
      expect(signUp).not.toHaveBeenCalled();
    });

    it('asks for the invite code and the email address, and nothing else', async () => {
      const { el, press, type, calls } = await setup(false);
      await press();
      expect(calls).toEqual([]);
      expect(el.textContent).toContain('Enter the invite code');
      expect(el.ownerDocument.activeElement?.id).toBe('signup-invite');
      // the name and the passwords are not needed for this route
      expect(el.textContent).not.toContain('Enter your name.');
      expect(el.textContent).not.toContain('Choose a password');

      type('#signup-invite', 'abc123');
      await press();
      expect(calls).toEqual([]);
      expect(el.textContent).toContain('Enter your email address.');
      expect(el.ownerDocument.activeElement?.id).toBe('signup-email');
    });

    it('hands the code in for that email address before going to LinkedIn', async () => {
      const { press, type, calls, reserveLinkedInSignup, signUp } =
        await setup(false);
      type('#signup-invite', 'abc123');
      type('#signup-email', 'alex@example.com');
      await press();
      expect(calls).toEqual(['reserve', 'linkedin']);
      expect(reserveLinkedInSignup).toHaveBeenCalledWith(
        'abc123',
        'alex@example.com',
      );
      expect(signUp).not.toHaveBeenCalled();
    });

    it('does not leave for LinkedIn with a wrong invite code', async () => {
      const { el, press, type, calls } = await setup(false, false);
      type('#signup-invite', 'nope');
      type('#signup-email', 'alex@example.com');
      await press();
      expect(calls).toEqual([]);
      expect(el.querySelector('#linkedin-error')?.textContent).toContain(
        'not valid',
      );
    });

    it('stays on the page when the code could not be handed in', async () => {
      const { el, press, type, calls, reserveLinkedInSignup } =
        await setup(false);
      reserveLinkedInSignup.mockRejectedValue(
        new Error('Signing up with LinkedIn is not switched on yet.'),
      );
      type('#signup-invite', 'abc123');
      type('#signup-email', 'alex@example.com');
      await press();
      expect(calls).toEqual([]);
      expect(el.querySelector('#linkedin-error')?.textContent).toContain(
        'not switched on yet',
      );
    });
  });
});
