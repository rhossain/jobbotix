import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { Auth, type LinkedInConnection } from '../../core/auth';
import { Toast } from '../../shared/toast';
import { Button, Confirm } from '../../ui';

/**
 * What to tell someone whose "Connect LinkedIn" came back with an error in
 * the address. Null when the address has none.
 */
export function linkProblem(params: {
  get(name: string): string | null;
}): string | null {
  const error = params.get('error') ?? '';
  const code = params.get('error_code') ?? '';
  const text = params.get('error_description') ?? '';
  if (!error && !code && !text) return null;
  const all = `${error} ${code} ${text}`.toLowerCase();
  if (all.includes('identity_already_exists') || all.includes('already linked'))
    return 'That LinkedIn account already signs in to another Jobbotix account, so it was not connected here. Use a different LinkedIn account, or sign in to the other Jobbotix account.';
  if (all.includes('cancel') || all.includes('denied'))
    return 'You left LinkedIn before it finished, so nothing changed.';
  return 'Connecting LinkedIn did not work this time. Nothing changed; try again.';
}

/**
 * Settings: the accounts connected to this one. For now that is LinkedIn as
 * an extra way to sign in (LinkedIn's own sign-in; it gives Jobbotix no
 * access to the LinkedIn account). Connecting it here also covers a LinkedIn
 * account on a different email address, which "Continue with LinkedIn" on
 * the sign-in page cannot match to this account by itself.
 */
@Component({
  selector: 'jb-connected-accounts',
  imports: [Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (show) {
      <section
        id="connected-accounts"
        class="jb-card flex flex-col gap-3 p-5 md:p-6"
      >
        <h2 class="jb-section-title">Connected accounts</h2>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="min-w-0 flex-1 basis-64">
            <p class="font-medium text-ink">LinkedIn</p>
            <p id="ca-linkedin-state" class="mt-0.5 text-sm text-ink-muted">
              @if (state(); as s) {
                @if (s.connected) {
                  Connected{{ s.email ? ' as ' + s.email : '' }}. You can sign
                  in with LinkedIn.
                  @if (!s.canDisconnect) {
                    It is the only way into this account, so it stays connected.
                  }
                } @else {
                  Not connected. Connect it to sign in with LinkedIn as well,
                  even when your LinkedIn account uses a different email
                  address. Jobbotix gets no access to your LinkedIn account.
                }
              } @else if (failed()) {
                Could not check this just now.
              } @else {
                Checking…
              }
            </p>
          </div>
          @if (state(); as s) {
            @if (!s.connected) {
              <button
                id="ca-linkedin-connect"
                type="button"
                jbButton
                [busy]="busy()"
                [disabled]="busy()"
                (click)="connect()"
              >
                Connect LinkedIn
              </button>
            } @else if (s.canDisconnect) {
              <button
                id="ca-linkedin-disconnect"
                type="button"
                jbButton
                [busy]="busy()"
                [disabled]="busy()"
                (click)="disconnect()"
              >
                Disconnect
              </button>
            }
          }
        </div>
        @if (problem()) {
          <p id="ca-linkedin-problem" class="text-sm text-bad" role="alert">
            {{ problem() }}
          </p>
        }
      </section>
    }
  `,
})
export class ConnectedAccounts {
  private readonly auth = inject(Auth);
  private readonly toast = inject(Toast);
  private readonly confirm = inject(Confirm);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly show = environment.linkedinConnect;
  readonly state = signal<LinkedInConnection | null>(null);
  readonly failed = signal(false);
  readonly busy = signal(false);
  readonly problem = signal('');
  /** Resolves when the first check is done. */
  readonly ready: Promise<void> = this.show ? this.start() : Promise.resolve();

  private async start() {
    const q = this.route.snapshot.queryParamMap;
    // Back from LinkedIn after pressing Connect.
    const back = q.get('linkedin') === 'back';
    const problem = back ? linkProblem(q) : null;
    await this.load();
    if (problem) this.problem.set(problem);
    else if (back && this.state()?.connected)
      this.toast.show('LinkedIn connected');
    if (back)
      // The address is used once; a reload should not repeat the message.
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {},
        replaceUrl: true,
      });
  }

  private async load() {
    try {
      this.state.set(await this.auth.linkedInConnection());
      this.failed.set(false);
    } catch {
      this.failed.set(true);
    }
  }

  /** Off to LinkedIn's own page; the browser comes back to Settings. */
  async connect() {
    if (this.busy()) return;
    this.busy.set(true);
    this.problem.set('');
    try {
      await this.auth.connectLinkedIn();
      // The browser is leaving for LinkedIn, so the button stays busy. Where
      // nothing leaves (the demo), the connection is already made.
      await this.load();
      if (this.state()?.connected) {
        this.busy.set(false);
        this.toast.show('LinkedIn connected');
      }
    } catch (e) {
      this.problem.set((e as Error).message);
      this.busy.set(false);
    }
  }

  async disconnect() {
    if (this.busy()) return;
    const ok = await this.confirm.ask({
      title: 'Disconnect LinkedIn?',
      body: 'You will sign in with your email and password only. You can connect LinkedIn again at any time.',
      action: 'Disconnect',
    });
    if (!ok) return;
    this.busy.set(true);
    this.problem.set('');
    try {
      await this.auth.disconnectLinkedIn();
      await this.load();
      this.toast.show('LinkedIn disconnected');
    } catch (e) {
      this.problem.set((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }
}
