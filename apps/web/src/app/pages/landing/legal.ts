import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The facts the Terms and the Refund Policy need about who runs Jobbotix.
 * They are blank on purpose: fill them in (and have someone qualified read
 * both pages) before the pages are published. A blank shows on the page as a
 * marked gap, so it cannot be missed.
 */
export const LEGAL = {
  /** The person or company that runs Jobbotix and is party to the Terms. */
  operator: '',
  /** Postal address of the operator. */
  address: '',
  /** Where users write about their account, billing and refunds. */
  email: 'support@jobbotix.com',
  /** The country whose law governs the Terms. */
  governingLaw: '',
  /** The date these pages take effect, e.g. "1 December 2026". */
  effective: '',
};

/** A fact from LEGAL, or a marked gap while it is blank. */
@Component({
  selector: 'jb-legal-fact',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (value()) {
      {{ value() }}
    } @else {
      <mark class="rounded-sm bg-warn-tint px-1 text-warn"
        >[to fill in: {{ what() }}]</mark
      >
    }`,
})
export class LegalFact {
  readonly value = input.required<string>();
  readonly what = input.required<string>();
}

/** The banner on a page that is written but not published. */
@Component({
  selector: 'jb-draft-note',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p
      class="mt-4 rounded-control border border-line bg-warn-tint px-3.5 py-2.5 text-sm text-warn"
      role="note"
    >
      <span class="font-semibold">Draft, not published.</span>
      This page shows in development builds only.
      <ng-content />
    </p>
  `,
})
export class DraftNote {}
