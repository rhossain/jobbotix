import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Auth } from '../../core/auth';
import { Login } from './login';

function setup() {
  const signIn = vi.fn().mockResolvedValue(undefined);
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: Auth, useValue: { signIn } }],
  });
  const fixture = TestBed.createComponent(Login);
  fixture.detectChanges();
  const el: HTMLElement = fixture.nativeElement;
  const button = el.querySelector('button[type=submit]') as HTMLButtonElement;
  const type = (id: string, value: string) => {
    const input = el.querySelector<HTMLInputElement>(id);
    if (!input) throw new Error(`${id} not found`);
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };
  return { fixture, el, button, signIn, type };
}

describe('Login', () => {
  it('keeps Sign in pressable and says what is missing', () => {
    const { fixture, el, button, signIn } = setup();
    expect(button.disabled).toBe(false);
    expect(el.textContent).not.toContain('Enter your email address.');

    button.click();
    fixture.detectChanges();
    expect(el.textContent).toContain('Enter your email address.');
    expect(el.textContent).toContain('Enter your password.');
    expect(signIn).not.toHaveBeenCalled();
    expect(el.ownerDocument.activeElement?.id).toBe('login-email');
  });

  it('points out a mistyped email address', () => {
    const { fixture, el, button, type } = setup();
    type('#login-email', 'alex.example.com');
    type('#login-password', 'secret-words');
    button.click();
    fixture.detectChanges();
    expect(el.textContent).toContain('does not look right');
  });

  it('can show the password while it is typed', () => {
    const { fixture, el } = setup();
    const password = el.querySelector('#login-password') as HTMLInputElement;
    expect(password.type).toBe('password');
    const eye = el.querySelector('jb-eye-toggle button') as HTMLButtonElement;
    expect(eye.getAttribute('aria-label')).toBe('Show password');
    eye.click();
    fixture.detectChanges();
    expect(password.type).toBe('text');
    expect(eye.getAttribute('aria-label')).toBe('Hide password');
    eye.click();
    fixture.detectChanges();
    expect(password.type).toBe('password');
  });

  it('signs in once both boxes are filled', async () => {
    const { fixture, button, signIn, type } = setup();
    type('#login-email', 'alex@example.com');
    type('#login-password', 'secret-words');
    button.click();
    await fixture.whenStable();
    expect(signIn).toHaveBeenCalledWith('alex@example.com', 'secret-words');
  });
});
