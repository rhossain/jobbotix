import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PRICING, usd } from '@jobbotix/shared-types';
import { DraftNote, LEGAL, LegalFact } from './legal';

/**
 * Terms of Service. A draft: the route exists in development builds only
 * until the effective date in legal.ts is set, someone qualified has read it,
 * and billing goes live (subscription TODO, section 7).
 */
@Component({
  selector: 'jb-terms',
  imports: [DraftNote, LegalFact, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="mx-auto max-w-2xl py-6 text-base leading-relaxed text-ink">
      <nav class="text-sm">
        <a routerLink="/" class="text-ink-muted no-underline hover:text-ink"
          >‹ Jobbotix</a
        >
      </nav>
      <h1 class="mt-4 text-3xl font-semibold tracking-tight">Terms</h1>
      <p class="mt-1 text-sm text-ink-muted">
        The agreement between you and Jobbotix, in plain words.
      </p>
      <jb-draft-note>
        Have a lawyer read it before publishing. The date at the foot is set on
        the day it goes live.
      </jb-draft-note>

      <h2 class="mt-10 text-xl font-semibold">Who you are dealing with</h2>
      <p class="mt-2">
        Jobbotix is run by
        <jb-legal-fact [value]="legal.operator" what="legal name" />,
        <jb-legal-fact [value]="legal.address" what="postal address" />. Write
        to <jb-legal-fact [value]="legal.email" what="contact email" /> about
        anything on this page. By creating an account you agree to these terms
        and to the <a routerLink="/privacy" class="underline">privacy page</a>.
      </p>

      <h2 class="mt-10 text-xl font-semibold">What Jobbotix does</h2>
      <p class="mt-2">
        Jobbotix finds remote job postings, scores them against the search
        profile you set, keeps track of your applications, and drafts resumes,
        cover letters, answers and interview prep for you to edit. It never
        submits an application for you, and it does not promise an interview or
        a job.
      </p>

      <h2 class="mt-10 text-xl font-semibold">Your account</h2>
      <ul class="mt-2 list-disc space-y-1 pl-5">
        <li>You must be at least 18 to use Jobbotix.</li>
        <li>
          An account is for one person. Keep your sign-in details to yourself;
          what happens under your account is your responsibility.
        </li>
        <li>
          You can delete your account at any time from Settings. That removes
          your data straight away, as the privacy page describes.
        </li>
      </ul>

      <h2 class="mt-10 text-xl font-semibold">Your content</h2>
      <p class="mt-2">
        Your resume, notes, letters and everything else you add stay yours. You
        allow Jobbotix to store and process them only to run the service for
        you. That includes sending the parts a task needs to an AI provider when
        you ask for AI work; the privacy page names each provider and what it
        receives. Only add content you have the right to use.
      </p>

      <h2 class="mt-10 text-xl font-semibold">What the AI writes</h2>
      <p class="mt-2">
        Scores and drafts come from software and can be wrong, incomplete or out
        of date. Jobbotix asks the model to use only what is in your resume, but
        you are the one who sends an application: read every draft and correct
        it before you use it. You are responsible for what you submit to an
        employer.
      </p>

      <h2 class="mt-10 text-xl font-semibold">Your own AI keys</h2>
      <p class="mt-2">
        If you connect your own key for an AI provider, your agreement with that
        provider applies to those calls, and any charges or limits on that key
        are between you and the provider. Jobbotix stores the key encrypted and
        uses it only for the work you ask for.
      </p>

      <h2 class="mt-10 text-xl font-semibold">Plans and payment</h2>
      <ul class="mt-2 list-disc space-y-1 pl-5">
        <li>
          The Free plan costs nothing. Pro costs {{ monthly }} a month, or
          {{ quarterly }} for three months paid at once. The price you see at
          checkout is the price you pay; taxes may be added where they apply.
        </li>
        <li>
          Payments are handled by {{ legal.paymentProvider }}, which sells Pro
          to you as the merchant of record: it takes the payment, adds any tax
          and sends the invoice. Jobbotix never sees your card number.
        </li>
        <li>
          Pro renews at the end of each period until you cancel. You can cancel
          at any time from Settings; Pro then stays on until the end of the
          period you paid for, and nothing more is charged.
        </li>
        <li>
          If a renewal payment fails, Pro stays on for {{ graceDays }} days
          while the payment is retried. After that the account goes back to
          Free, and none of your data is removed.
        </li>
        <li>
          If the price of Pro changes, you are told by email at least 30 days
          before, and the change applies from your next renewal, never inside a
          period you already paid for.
        </li>
        <li>
          Refunds are covered by the
          <a routerLink="/refunds" class="underline">refund policy</a>.
        </li>
      </ul>

      <h2 class="mt-10 text-xl font-semibold">Credits</h2>
      <ul class="mt-2 list-disc space-y-1 pl-5">
        <li>
          Pro includes {{ credits }} AI credits each month. A credit pays for AI
          work done on Jobbotix's own AI account, so you need no key of your
          own. The pricing page lists what each kind of work costs.
        </li>
        <li>
          Monthly credits are for that month: the ones you do not use do not
          carry over.
        </li>
        <li>
          Top-up credits ({{ topUpCredits }} for {{ topUp }}) are used after the
          monthly ones and stay on your account for 12 months from purchase.
        </li>
        <li>
          When an AI call fails, its credits are returned. Credits are not
          money: they cannot be transferred, sold or cashed out.
        </li>
        <li>
          To keep the service working for everyone, a daily limit applies to AI
          work on credits. The app tells you when you reach it.
        </li>
      </ul>

      <h2 class="mt-10 text-xl font-semibold">Fair use</h2>
      <p class="mt-2">Do not:</p>
      <ul class="mt-2 list-disc space-y-1 pl-5">
        <li>use Jobbotix to break the law or someone else's rights;</li>
        <li>
          resell it, share one account between people, or create accounts by
          script;
        </li>
        <li>
          copy the job pool in bulk, or probe, overload or try to get around the
          limits of the service;
        </li>
        <li>
          ask for refunds again and again, or open new accounts, in order to use
          Pro or trial credits without paying;
        </li>
        <li>try to reach another person's data.</li>
      </ul>
      <p class="mt-2">
        An account that does any of this can be suspended or closed. Where that
        is possible you are told first and given a chance to put it right.
      </p>

      <h2 class="mt-10 text-xl font-semibold">Job postings and other sites</h2>
      <p class="mt-2">
        Postings belong to the employers and job boards that published them.
        Jobbotix links to them and is not connected to those employers or
        boards. A posting can be wrong, filled or withdrawn; check it on the
        employer's site before you apply.
      </p>

      <h2 class="mt-10 text-xl font-semibold">Changes and availability</h2>
      <p class="mt-2">
        Jobbotix changes as it grows: features are added, changed and sometimes
        removed. It is run with care but without a guarantee that it is always
        available or free of faults. If a feature you pay for is removed, you
        can cancel and ask for a refund of the unused part of your period.
      </p>

      <h2 class="mt-10 text-xl font-semibold">Responsibility</h2>
      <p class="mt-2">
        Jobbotix is provided as it is. To the extent the law allows, Jobbotix is
        not liable for lost job opportunities, lost income or other indirect
        losses, and its total liability to you is limited to what you paid for
        Jobbotix in the 12 months before the claim. Nothing here limits rights
        the law says cannot be limited, including your rights as a consumer.
      </p>

      <h2 class="mt-10 text-xl font-semibold">Law</h2>
      <p class="mt-2">
        These terms are governed by the law of
        <jb-legal-fact [value]="legal.governingLaw" what="country" />, and a
        dispute is heard by the courts of {{ legal.courts }}. If you are a
        consumer, the protections of the law where you live still apply to you,
        and so does any right it gives you to use your own courts.
      </p>

      <h2 class="mt-10 text-xl font-semibold">Changes to these terms</h2>
      <p class="mt-2">
        When these terms change in a way that matters, you are told by email at
        least 14 days before the change takes effect. If you do not agree, you
        can cancel and delete your account before then.
      </p>

      <p class="mt-8 text-sm text-ink-muted">
        In effect from
        <jb-legal-fact [value]="legal.effective" what="date" />.
      </p>
    </article>
  `,
})
export class Terms {
  protected readonly legal = LEGAL;
  protected readonly monthly = usd(PRICING.pro.monthlyUsd);
  protected readonly quarterly = usd(PRICING.pro.quarterlyUsd);
  protected readonly credits = PRICING.pro.monthlyCredits;
  protected readonly topUp = usd(PRICING.topUp.usd);
  protected readonly topUpCredits = PRICING.topUp.credits;
  protected readonly graceDays = PRICING.graceDays;
}
