import type { AbstractControl } from '@angular/forms';

/** Plain sentences for a sign-in or sign-up box that was left empty or mistyped. */
const EMAIL_HELP = {
  required: 'Enter your email address.',
  email:
    'That email address does not look right. Check for a missing @ or a typo.',
};

export function emailHelp(c: AbstractControl): string {
  if (c.hasError('required')) return EMAIL_HELP.required;
  return c.hasError('email') ? EMAIL_HELP.email : '';
}

/** Puts the cursor in the first box that still needs fixing. */
export function focusFirstInvalid(form: HTMLElement): void {
  form.querySelector<HTMLElement>('input.ng-invalid')?.focus();
}
