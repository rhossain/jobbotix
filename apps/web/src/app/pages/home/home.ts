import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'jb-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="max-w-2xl">
      <h1 class="text-3xl font-semibold tracking-tight">
        Your job search, running every morning.
      </h1>
      <p class="mt-3 text-neutral-600 dark:text-neutral-300">
        Jobbotix searches remote boards overnight, scores each role against your
        profile, drafts the cover letter and screening answers, and hands you a
        short list. Applying is the only step left to you.
      </p>
      <p class="mt-6 text-sm text-neutral-500">
        Phase 0 scaffold. Sign-up, search profiles and the roles tracker arrive
        in the next commits.
      </p>
    </section>
  `,
})
export class Home {}
