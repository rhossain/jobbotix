import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The facts the Terms and the Refund Policy need about who runs Jobbotix.
 * A blank shows on the page as a marked gap, so it cannot be missed.
 * The pages were published on 13 November 2026, before a lawyer had read
 * them; that reading is still worth having before Pro goes on sale.
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
   * The company that takes payments as merchant of record. Blank until one
   * has accepted Jobbotix: the pages then speak of "a payment company" and
   * say that it is named at checkout (see seller() and sellerName()).
   */
  paymentProvider: '',
  /** The date these pages take effect. */
  effective: '13 November 2026',
};

/**
 * Whether Pro can be bought. While it cannot, the pricing, Terms and Refund
 * pages say so at the top, the Pro button is off, and what depends on Pro
 * (trial credits) is described as coming with it.
 */
export const PRO_ON_SALE = false;

/** How a sentence names who takes the payment: "Paddle" or "a payment company". */
export function sellerName(): string {
  return LEGAL.paymentProvider || 'a payment company';
}

/** The same with what a reader needs while no company is named. */
export function seller(): string {
  return LEGAL.paymentProvider
    ? LEGAL.paymentProvider
    : 'a payment company, named at checkout and on your receipt';
}

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

/**
 * The note at the top of a page about Pro while Pro is not on sale. It
 * renders nothing once PRO_ON_SALE is true.
 */
@Component({
  selector: 'jb-pro-soon-note',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!onSale) {
      <p
        class="mt-4 rounded-control border border-line bg-brand-tint px-3.5 py-2.5 text-sm text-brand-ink"
        role="note"
      >
        <span class="font-semibold">Pro is not on sale yet.</span>
        <ng-content />
      </p>
    }
  `,
})
export class ProSoonNote {
  protected readonly onSale = PRO_ON_SALE;
}
