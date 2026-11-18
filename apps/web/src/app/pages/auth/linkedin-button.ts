import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';

/**
 * "Continue with LinkedIn" under a sign-in or sign-up form: LinkedIn's own
 * sign-in (Sign In with LinkedIn using OpenID Connect). The person signs in
 * on LinkedIn's page; Jobbotix never sees their LinkedIn password.
 *
 * The button is words only, in Jobbotix's own style. LinkedIn's logo may be
 * shown only from LinkedIn's official artwork, unaltered, so none is drawn
 * here.
 */
@Component({
  selector: 'jb-linkedin-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="my-5 flex items-center gap-3 text-xs uppercase tracking-wide text-ink-muted"
      aria-hidden="true"
    >
      <span class="h-px flex-1 bg-line"></span>
      or
      <span class="h-px flex-1 bg-line"></span>
    </div>
    <button
      id="linkedin-continue"
      type="button"
      class="jb-btn jb-btn-lg w-full"
      [disabled]="busy()"
      (click)="go.emit()"
    >
      {{ busy() ? 'Opening LinkedIn…' : 'Continue with LinkedIn' }}
    </button>
    @if (error()) {
      <p id="linkedin-error" class="mt-3 text-sm text-bad" role="alert">
        {{ error() }}
      </p>
    }
  `,
})
export class LinkedInButton {
  readonly busy = input(false);
  readonly error = input('');
  readonly go = output<void>();
}

/**
 * What to tell someone whose LinkedIn sign-in came back with an error. The
 * auth server puts `error`, `error_code` and `error_description` in the
 * address it sends the browser back to. Null when the address has none.
 */
export function linkedInProblem(params: {
  get(name: string): string | null;
}): string | null {
  const error = params.get('error') ?? '';
  const code = params.get('error_code') ?? '';
  const text = params.get('error_description') ?? '';
  if (!error && !code && !text) return null;
  const all = `${error} ${code} ${text}`.toLowerCase();
  // Before "denied": a suspended account can be refused as access_denied.
  if (all.includes('banned'))
    return 'This account has been suspended. Write to support@jobbotix.com to ask about it.';
  if (all.includes('cancel') || all.includes('denied'))
    return 'You left the LinkedIn sign-in before it finished, so nothing changed. Try again when you are ready.';
  // The database refuses a new account that has no invite code.
  if (all.includes('saving new user'))
    return 'No Jobbotix account uses the email address on your LinkedIn account, and a new one needs an invite code. Open "Create an account", enter your invite code and that email address, then continue with LinkedIn.';
  if (
    all.includes('unverified') ||
    code === 'provider_email_needs_verification'
  )
    return 'LinkedIn has not confirmed the email address on your account. Confirm it on LinkedIn, or sign in here with your email and password.';
  if (all.includes('email'))
    return 'LinkedIn did not send an email address, so Jobbotix cannot tell which account is yours. Sign in with your email and password.';
  return 'Signing in with LinkedIn did not work this time. Try again, or sign in with your email and password.';
}

/** Reads the error the auth server left in the address: the query, or the part after #. */
export function readAuthError(
  query: { get(name: string): string | null },
  fragment: string | null,
): string | null {
  return (
    linkedInProblem(query) ??
    (fragment ? linkedInProblem(new URLSearchParams(fragment)) : null)
  );
}
