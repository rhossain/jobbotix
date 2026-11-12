import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DraftNote, LEGAL, LegalFact } from './legal';

/**
 * The numbers the refund policy turns on, in one place so the policy and any
 * later tooling (admin refunds, section 6) agree.
 */
export const REFUND_RULES = {
  /** Days after the first Pro payment in which it is refunded on request. */
  firstPaymentDays: 14,
  /** A first-payment refund is in full when no more credits than this were used. */
  firstPaymentCredits: 100,
  /** Days after a renewal in which it is refunded if no credit was used since. */
  renewalDays: 7,
  /** Days after a top-up in which it is refunded if none of it was used. */
  topUpDays: 14,
  /** Working days within which a refund request is answered. */
  answerWorkingDays: 3,
} as const;

/**
 * Refund Policy. A draft: the route exists in development builds only until
 * the effective date in legal.ts is set and billing goes live (subscription
 * TODO, section 7). The rules above were settled on 12 Nov 2026.
 */
@Component({
  selector: 'jb-refunds',
  imports: [DraftNote, LegalFact, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="mx-auto max-w-2xl py-6 text-base leading-relaxed text-ink">
      <nav class="text-sm">
        <a routerLink="/" class="text-ink-muted no-underline hover:text-ink"
          >‹ Jobbotix</a
        >
      </nav>
      <h1 class="mt-4 text-3xl font-semibold tracking-tight">Refunds</h1>
      <p class="mt-1 text-sm text-ink-muted">
        When you get your money back, and how to ask.
      </p>
      <jb-draft-note>
        Have a lawyer read it before publishing. The date at the foot is set on
        the day it goes live.
      </jb-draft-note>

      <h2 class="mt-10 text-xl font-semibold">The short version</h2>
      <ul class="mt-2 list-disc space-y-1 pl-5">
        <li>
          Your first Pro payment is refunded if you ask within
          {{ r.firstPaymentDays }} days: in full when you used no more than
          {{ r.firstPaymentCredits }} credits, and less when you used more.
        </li>
        <li>This refund is given once per person.</li>
        <li>You can cancel at any time; Pro stays on until the period ends.</li>
        <li>A charge made by mistake is always refunded.</li>
      </ul>

      <h2 class="mt-10 text-xl font-semibold">Your first payment</h2>
      <p class="mt-2">
        If Pro is not for you, write within {{ r.firstPaymentDays }} days of
        your first payment, monthly or three-month, and it is refunded in full.
        This applies when you have used no more than
        {{ r.firstPaymentCredits }} of that period's AI credits; above that, the
        refund is reduced by the share of the credits you used. Someone who used
        half of the period's credits gets half back, and someone who used all of
        them gets nothing back.
      </p>
      <p class="mt-2">
        This refund is given once per person, not once per account. If you were
        refunded before and subscribe again, under the same account or a new
        one, that payment is not a first payment.
      </p>

      <h2 class="mt-10 text-xl font-semibold">Renewals</h2>
      <p class="mt-2">
        A renewal you did not mean to pay for is refunded if you ask within
        {{ r.renewalDays }} days of the charge and have used no credits since
        it. Otherwise a paid period is not refunded in part: cancel, and Pro
        runs until the period ends without another charge. The three-month pass
        works the same way.
      </p>

      <h2 class="mt-10 text-xl font-semibold">Credit top-ups</h2>
      <p class="mt-2">
        A top-up is refunded within {{ r.topUpDays }} days if none of its
        credits were used. Used credits are not refunded.
      </p>

      <h2 class="mt-10 text-xl font-semibold">Always refunded</h2>
      <ul class="mt-2 list-disc space-y-1 pl-5">
        <li>A duplicate charge, or a charge after you cancelled.</li>
        <li>
          The unused part of your period, if Jobbotix removes a feature you pay
          for or closes the service.
        </li>
        <li>
          Anything the law where you live says must be refunded. Where the law
          gives you more than this page, the law applies.
        </li>
      </ul>

      <h2 class="mt-10 text-xl font-semibold">Not refunded</h2>
      <ul class="mt-2 list-disc space-y-1 pl-5">
        <li>
          A first payment asked about after {{ r.firstPaymentDays }} days.
        </li>
        <li>A renewal or a top-up after any of its credits were used.</li>
        <li>
          A second first-payment refund for the same person, whatever account or
          card is used.
        </li>
        <li>
          A period on an account that was suspended or closed for breaking the
          <a routerLink="/terms" class="underline">terms</a>.
        </li>
      </ul>
      <p class="mt-2">
        Asking for refunds again and again in order to use Pro without paying is
        misuse of this policy. Such requests are refused and the account can be
        closed. None of this takes away a refund the law where you live gives
        you.
      </p>

      <h2 class="mt-10 text-xl font-semibold">After a refund</h2>
      <p class="mt-2">
        A refund ends Pro on the account straight away, and the credits that
        came with the refunded payment are removed. The account goes back to
        Free and keeps everything you saved.
      </p>
      <p class="mt-2">
        Please write before you dispute a charge with your bank: a refund here
        is quicker. While a bank dispute is open, Pro on the account is paused.
      </p>

      <h2 class="mt-10 text-xl font-semibold">How to ask</h2>
      <p class="mt-2">
        Write to
        <jb-legal-fact [value]="legal.email" what="contact email" /> from the
        email address on your account and say which payment. You get an answer
        within {{ r.answerWorkingDays }} working days. Refunds go back through
        {{ legal.paymentProvider }}, which handles Jobbotix's payments, to the
        card or method you paid with; your bank can take 5 to 10 working days to
        show it.
      </p>

      <p class="mt-8 text-sm text-ink-muted">
        See also the <a routerLink="/terms" class="underline">terms</a>. In
        effect from <jb-legal-fact [value]="legal.effective" what="date" />.
      </p>
    </article>
  `,
})
export class Refunds {
  protected readonly legal = LEGAL;
  protected readonly r = REFUND_RULES;
}
