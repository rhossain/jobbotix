import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Auth } from '../../core/auth';
import { Signup } from './signup';

async function setup() {
  const signUp = vi.fn().mockResolvedValue(undefined);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: Auth,
        useValue: {
          signUp,
          signupIsOpen: async () => true,
          inviteCodeIsValid: async () => true,
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
  return { fixture, el, button, signUp, fill };
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
});
