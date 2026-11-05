import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Logo } from '../../shell/logo';

/**
 * Centred card used by every auth page: the mark, the heading and lead,
 * then the form. Links under the form go in a [footer] element.
 */
@Component({
  selector: 'jb-auth-shell',
  imports: [Logo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="mx-auto flex min-h-[calc(100dvh-10rem)] w-full max-w-md flex-col justify-center py-6"
    >
      <div class="jb-card p-6 shadow-raised md:p-8">
        <jb-logo [wordmark]="false" [size]="40" />
        <h1 class="mt-5 text-2xl font-semibold tracking-tight text-ink">
          {{ heading() }}
        </h1>
        @if (lead()) {
          <p class="mt-1.5 text-ink-muted">{{ lead() }}</p>
        }
        <div class="jb-auth-form mt-6">
          <ng-content />
        </div>
      </div>
      <div class="mt-5 px-2 text-center text-sm text-ink-muted empty:hidden">
        <ng-content select="[footer]" />
      </div>
    </section>
  `,
  styles: `
    .jb-auth-form ::ng-deep label > span:first-child {
      font-weight: 500;
      color: var(--ink);
    }
  `,
})
export class AuthShell {
  readonly heading = input.required<string>();
  readonly lead = input<string>('');
}
