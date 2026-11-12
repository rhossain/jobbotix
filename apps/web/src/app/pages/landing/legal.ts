import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The facts the Terms and the Refund Policy need about who runs Jobbotix.
 * A blank shows on the page as a marked gap, so it cannot be missed. Only
 * `effective` is blank now: it is set on the day the pages are published.
 * Someone qualified should still read both pages before then.
 */
export const LEGAL = {
  /** The person or company that runs Jobbotix and is party to the Terms. */
  operator: 'MD SAZZAD HOSSAIN',
  /**
   * Where the operator is based. City and country only for now: replace it
   * with a full postal address if a payment company or the law asks for one.
   */
  address: 'Dhaka, Bangladesh',
  /** Where users write about their account, billing and refunds. */
  email: 'support@jobbotix.com',
  /** The country whose law governs the Terms. */
  governingLaw: 'Bangladesh',
  /** Where a dispute is heard, unless the user's own law says otherwise. */
  courts: 'Dhaka, Bangladesh',
  /**
   * The company that takes payments as merchant of record. Named in one
   * place because the choice is not final until its review accepts Jobbotix.
   */
  paymentProvider: 'Polar',
  /** The date these pages take effect, e.g. "1 December 2026". */
  effective: '',
};

/** A fact from LEGAL, or a marked gap while it is blank. */
@Component({
  selector: 'jb-legal-fact',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The value sits in a span so the template's own line breaks are dropped
  // and a comma or full stop after the fact stays attached to it.
  template: `@if (value()) {
      <span>{{ value() }}</span>
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
