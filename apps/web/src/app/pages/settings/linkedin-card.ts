import { ChangeDetectionStrategy, Component } from '@angular/core';
import { environment } from '../../../environments/environment';
import { LinkedInImport } from './linkedin-import';
import { LinkedInSignIn } from './linkedin-sign-in';

/**
 * Settings → LinkedIn: everything Jobbotix does with a LinkedIn account, in
 * one place. Signing in with it (LinkedIn's own sign-in, which shares a name
 * and an email address and nothing else), and bringing in the person's own
 * data from the file LinkedIn gives them. LinkedIn offers apps no way to
 * read saved jobs, applications or connections directly, so connecting the
 * account does not fetch them; the card says so.
 */
@Component({
  selector: 'jb-linkedin-card',
  imports: [LinkedInImport, LinkedInSignIn],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (signIn || data) {
      <section
        id="linkedin"
        class="jb-card flex flex-col gap-5 p-5 md:p-6"
        aria-labelledby="linkedin-h"
      >
        <div>
          <h2 id="linkedin-h" class="jb-section-title">LinkedIn</h2>
          <p id="linkedin-lead" class="mt-1 text-sm text-ink-muted">
            @if (signIn && data) {
              Sign in with your LinkedIn account, and bring in your jobs and
              connections from it. LinkedIn does not let other apps read those
              directly, so connecting your account does not fetch them: you
              bring them in yourself, from the file LinkedIn gives you.
            } @else if (data) {
              LinkedIn does not let other apps read your saved jobs,
              applications or connections directly. You bring them in yourself,
              from the file LinkedIn gives you.
            } @else {
              Use your LinkedIn account as a way to sign in to Jobbotix.
            }
          </p>
        </div>
        @if (signIn) {
          <jb-linkedin-sign-in />
        }
        @if (signIn && data) {
          <hr class="border-line" />
        }
        @if (data) {
          <jb-linkedin-import />
        }
      </section>
    }
  `,
})
export class LinkedInCard {
  protected readonly signIn = environment.linkedinConnect;
  protected readonly data = environment.linkedinImport;
}
