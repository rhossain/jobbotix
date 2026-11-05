import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The top of every page: the h1, an optional lead line, and an actions slot.
 * `<jb-page-header title="Roles" lead="…"><div actions>…</div></jb-page-header>`
 * Extra lead content (counts, run summaries) goes in a [lead] element.
 */
@Component({
  selector: 'jb-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div
      class="flex flex-col gap-4 md:flex-row md:items-end md:justify-between md:gap-8"
    >
      <div class="min-w-0">
        <ng-content select="[eyebrow]" />
        <h1
          class="text-[1.75rem] leading-tight font-semibold tracking-tight text-ink md:text-3xl"
        >
          {{ title() }}
        </h1>
        @if (lead()) {
          <p class="mt-2 max-w-[var(--reading-max)] text-ink-muted">
            {{ lead() }}
          </p>
        }
        <ng-content select="[lead]" />
      </div>
      <div
        class="flex flex-wrap items-center gap-2 empty:hidden md:flex-nowrap md:justify-end"
      >
        <ng-content select="[actions]" />
      </div>
    </div>
  `,
})
export class PageHeader {
  readonly title = input.required<string>();
  readonly lead = input<string | null>(null);
}
