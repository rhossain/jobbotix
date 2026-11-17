import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Auth } from '../../core/auth';
import { ResetPassword } from './reset-password';

function setup() {
  const updatePassword = vi.fn().mockResolvedValue(undefined);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: Auth, useValue: { updatePassword } },
    ],
  });
  const fixture = TestBed.createComponent(ResetPassword);
  fixture.detectChanges();
  const el: HTMLElement = fixture.nativeElement;
  const button = el.querySelector('button[type=submit]') as HTMLButtonElement;
  const type = (id: string, value: string) => {
    const input = el.querySelector<HTMLInputElement>(id);
    if (!input) throw new Error(`${id} not found`);
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };
  return { fixture, el, button, updatePassword, type };
}

describe('ResetPassword', () => {
  it('does not save when the two passwords differ', () => {
    const { fixture, el, button, updatePassword, type } = setup();
    type('#reset-password', 'secret-words');
    type('#reset-confirm', 'secret-wards');
    button.click();
    fixture.detectChanges();
    expect(el.textContent).toContain('The two passwords are not the same');
    expect(updatePassword).not.toHaveBeenCalled();
    expect(el.ownerDocument.activeElement?.id).toBe('reset-confirm');
  });

  it('asks for the second box when it is left empty', () => {
    const { fixture, el, button, updatePassword, type } = setup();
    type('#reset-password', 'secret-words');
    button.click();
    fixture.detectChanges();
    expect(el.textContent).toContain('Type the password a second time');
    expect(updatePassword).not.toHaveBeenCalled();
  });

  it('saves when they match', async () => {
    const { fixture, button, updatePassword, type } = setup();
    type('#reset-password', 'secret-words');
    type('#reset-confirm', 'secret-words');
    button.click();
    await fixture.whenStable();
    expect(updatePassword).toHaveBeenCalledWith('secret-words');
  });
});
