import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Centered card used by every auth page. */
@Component({
  selector: 'jb-auth-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mx-auto mt-8 w-full max-w-sm">
      <h1 class="text-2xl font-semibold tracking-tight">{{ heading() }}</h1>
      @if (lead()) {
        <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
          {{ lead() }}
        </p>
      }
      <div class="mt-6">
        <ng-content />
      </div>
    </section>
  `,
})
export class AuthShell {
  readonly heading = input.required<string>();
  readonly lead = input<string>('');
}
