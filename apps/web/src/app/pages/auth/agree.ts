import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Auth, isLocalPath } from '../../core/auth';
import { AuthShell } from './auth-shell';

/**
 * Asked once of an account with no record of agreeing to the current Terms:
 * accounts opened before terms were recorded, a sign-up through LinkedIn
 * from the Sign in page, and everyone after the Terms change.
 */
@Component({
  selector: 'jb-agree',
  imports: [RouterLink, AuthShell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <jb-auth-shell
      heading="Before you go on"
      lead="Please read and agree to how Jobbotix works."
    >
      <p class="text-sm text-ink-muted">
        The
        <a routerLink="/terms" target="_blank" class="text-brand-ink underline"
          >Terms</a
        >
        say what Jobbotix does for you and what it asks of you. The
        <a
          routerLink="/privacy"
          target="_blank"
          class="text-brand-ink underline"
          >Privacy page</a
        >
        says what is kept about you and who sees it. Both open in a new tab.
      </p>
      @if (error()) {
        <p class="mt-4 text-sm text-bad" role="alert">{{ error() }}</p>
      }
      <button
        id="agree-continue"
        type="button"
        class="jb-btn-primary jb-btn-lg mt-6 w-full"
        [disabled]="busy()"
        (click)="agree()"
      >
        {{ busy() ? 'Saving…' : 'I agree, continue' }}
      </button>
      <p footer>
        Not now?
        <button
          id="agree-sign-out"
          type="button"
          class="font-medium text-brand-ink underline"
          (click)="signOut()"
        >
          Sign out
        </button>
      </p>
    </jb-auth-shell>
  `,
})
export class Agree {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly busy = signal(false);
  readonly error = signal('');

  async agree() {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.acceptTerms();
      const next = this.route.snapshot.queryParamMap.get('next');
      await this.router.navigateByUrl(
        next && isLocalPath(next) ? next : '/today',
        { replaceUrl: true },
      );
    } catch (e) {
      this.error.set((e as Error).message || 'Could not save. Try again.');
    } finally {
      this.busy.set(false);
    }
  }

  async signOut() {
    await this.auth.signOut();
    await this.router.navigateByUrl('/');
  }
}
