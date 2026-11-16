import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { EmailOtpType } from '@supabase/supabase-js';
import { Auth } from '../../core/auth';
import { AuthShell } from './auth-shell';

const LINK_TYPES: readonly EmailOtpType[] = [
  'signup',
  'email',
  'recovery',
  'invite',
  'magiclink',
  'email_change',
];

export interface ConfirmLink {
  tokenHash: string;
  type: EmailOtpType;
}

/** Reads the token and link type an auth email put in the URL, or null if either is unusable. */
export function readConfirmLink(params: {
  get(name: string): string | null;
}): ConfirmLink | null {
  const tokenHash = params.get('token_hash')?.trim() ?? '';
  const type = params.get('type') as EmailOtpType | null;
  if (!tokenHash || !type || !LINK_TYPES.includes(type)) return null;
  return { tokenHash, type };
}

/** Where a confirmed link sends the person: recovery links go on to choose a password. */
export function afterConfirm(type: EmailOtpType): string {
  return type === 'recovery' ? '/reset-password' : '/';
}

/**
 * Landing page for links in auth emails (confirm sign-up, reset password,
 * change email). The emails link here, on our own domain, with a one-time
 * token; this page trades it for a session and moves on.
 */
@Component({
  selector: 'jb-auth-confirm',
  imports: [RouterLink, AuthShell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error()) {
      <jb-auth-shell heading="This link did not work">
        <p class="text-sm text-bad" role="alert">{{ error() }}</p>
        <p footer>
          <a routerLink="/login" class="font-medium text-brand-ink underline"
            >Go to sign in</a
          >
        </p>
      </jb-auth-shell>
    } @else {
      <jb-auth-shell heading="Confirming your email">
        <p class="text-sm text-ink-muted" role="status">One moment…</p>
      </jb-auth-shell>
    }
  `,
})
export class AuthConfirm implements OnInit {
  private readonly auth = inject(Auth);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly error = signal('');

  async ngOnInit() {
    const link = readConfirmLink(this.route.snapshot.queryParamMap);
    if (!link) {
      this.error.set(
        'The link is incomplete. Open it again from the email, or ask for a new one.',
      );
      return;
    }
    try {
      await this.auth.confirmEmailLink(link.tokenHash, link.type);
      // replaceUrl keeps the one-time token out of the browser history.
      await this.router.navigateByUrl(afterConfirm(link.type), {
        replaceUrl: true,
      });
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }
}
