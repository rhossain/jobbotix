import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  CREDIT_PRICES,
  PRICING,
  monthlyCovers,
  quarterlySaving,
  usd,
} from '@jobbotix/shared-types';
import { Auth } from '../../core/auth';
import { RESUME_TEMPLATES } from '../../shared/resume-templates';
import { Button, Icon } from '../../ui';
import { LEGAL, PRO_ON_SALE, ProSoonNote, seller } from './legal';
import { REFUND_RULES } from './refunds';

interface CompareRow {
  what: string;
  free: string | boolean;
  pro: string | boolean;
}

/** Free against Pro, limited to what exists in the app today. */
export const COMPARE: CompareRow[] = [
  {
    what: 'Job sourcing, keyword scoring, tracker, board and daily digest',
    free: true,
    pro: true,
  },
  { what: 'Master resume with PDF export', free: true, pro: true },
  { what: 'Interview tracker and contacts', free: true, pro: true },
  {
    what: 'AI scoring, cover letters, tailored resumes and screening answers on your own key (Gemini and Groq have free tiers)',
    free: true,
    pro: true,
  },
  {
    what: 'AI with no key of your own',
    free: `${PRICING.trialCredits} trial credits, once`,
    pro: `${PRICING.pro.monthlyCredits} credits every month`,
  },
  { what: 'Interview prep sheet for a role', free: false, pro: true },
  { what: 'Company research with web search', free: false, pro: true },
  {
    what: 'AI review of your resume',
    free:
      PRICING.limits.free.resumeReviews === 1
        ? 'One, to try it'
        : `${PRICING.limits.free.resumeReviews}, to try it`,
    pro: 'As often as you like',
  },
  {
    what: 'Search profiles, each matched every hour',
    free: `${PRICING.limits.free.searchProfiles}`,
    pro: `Up to ${PRICING.limits.pro.searchProfiles}`,
  },
  {
    what: 'Email about new roles',
    free: 'Daily digest',
    pro: 'Daily digest, and at once when a role scores high',
  },
  {
    what: 'Insights',
    free: 'Weekly counts, funnel and timing',
    pro: 'Plus what is getting replies: by source, score, timing and cover letter',
  },
  {
    what: 'Resume templates, all one column and readable by ATS',
    free: 'Classic',
    pro: `All ${RESUME_TEMPLATES.length}, one with a photo`,
  },
  { what: 'Resume as a Word file (.docx)', free: false, pro: true },
  {
    what: 'Credit top-ups',
    free: false,
    pro: `${PRICING.topUp.credits} credits for ${usd(PRICING.topUp.usd)}`,
  },
];

/**
 * Pricing. Published on 13 November 2026, before checkout exists, so the
 * prices are public and a payment company can review the site. While
 * PRO_ON_SALE is false the page says Pro is not on sale and the Pro button is
 * off (subscription TODO, section 7).
 */
@Component({
  selector: 'jb-pricing',
  imports: [Button, Icon, ProSoonNote, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-4xl py-6 text-ink">
      <nav class="text-sm">
        <a routerLink="/" class="text-ink-muted no-underline hover:text-ink"
          >‹ Jobbotix</a
        >
      </nav>
      <h1
        class="mt-4 max-w-2xl text-[clamp(2rem,5vw,3rem)] leading-[1.05] font-semibold tracking-[-0.03em]"
      >
        Free to run your search. Pro when you want more from it.
      </h1>
      <p class="mt-4 max-w-2xl text-lg text-ink-muted">
        The tracker, the job search and the scoring are free and stay free. Pro
        adds interview prep, company research, several search profiles, instant
        alerts and outcome insights, with AI credits so none of it needs a key
        of your own.
      </p>
      <jb-pro-soon-note>
        These are the prices it opens at. Until then every account is free, and
        AI works on a key of your own.
      </jb-pro-soon-note>

      <!-- Plans -->
      <div class="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2">
        <section class="jb-card flex flex-col gap-4 p-5 md:p-6">
          <h2 class="text-lg font-semibold">Free</h2>
          <p>
            <span class="text-4xl font-semibold tracking-tight">$0</span>
          </p>
          <ul class="flex flex-col gap-2 text-sm">
            @for (line of freeLines; track line) {
              <li class="flex items-start gap-2">
                <jb-icon
                  name="check"
                  [size]="16"
                  class="mt-0.5 shrink-0 text-good"
                />
                <span>{{ line }}</span>
              </li>
            }
          </ul>
          <div class="mt-auto pt-2">
            @if (open()) {
              <a jbButton routerLink="/signup">Create your account</a>
            } @else {
              <a jbButton routerLink="/" fragment="invite">Request an invite</a>
            }
          </div>
        </section>

        <section
          class="jb-card flex flex-col gap-4 border-brand p-5 md:p-6"
          aria-labelledby="pro-h"
        >
          <h2 id="pro-h" class="text-lg font-semibold">Pro</h2>
          <p>
            <span class="text-4xl font-semibold tracking-tight">{{
              monthly
            }}</span>
            <span class="text-ink-muted"> a month</span>
          </p>
          <p class="text-sm text-ink-muted">
            or {{ quarterly }} for three months, {{ saving }}% less. Cancel any
            time.
          </p>
          <ul class="flex flex-col gap-2 text-sm">
            @for (line of proLines; track line) {
              <li class="flex items-start gap-2">
                <jb-icon
                  name="check"
                  [size]="16"
                  class="mt-0.5 shrink-0 text-good"
                />
                <span>{{ line }}</span>
              </li>
            }
          </ul>
          <p class="rounded-control bg-brand-tint p-3 text-sm text-brand-ink">
            <span class="font-semibold">Founding price:</span>
            {{ foundingMonthly }} a month or {{ foundingQuarterly }} for three
            months for the first {{ seats }} customers, for as long as they stay
            subscribed.
          </p>
          <div class="mt-auto flex flex-wrap items-center gap-2 pt-2">
            <button type="button" jbButton="primary" disabled>
              {{ onSale ? 'Get Pro' : 'Opening soon' }}
            </button>
            @if (!onSale) {
              <span class="text-xs text-ink-muted"
                >Pro cannot be bought yet.</span
              >
            }
          </div>
        </section>
      </div>

      <!-- Free against Pro -->
      <section class="mt-12">
        <h2 class="text-xl font-semibold">Free against Pro</h2>
        <div class="mt-4 overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-left text-xs text-ink-muted">
              <tr>
                <th class="py-2 pr-4 font-medium"></th>
                <th class="w-1/4 py-2 pr-4 font-medium">Free</th>
                <th class="w-1/4 py-2 font-medium">Pro</th>
              </tr>
            </thead>
            <tbody>
              @for (row of compare; track row.what) {
                <tr class="border-t border-line align-top">
                  <th class="py-2.5 pr-4 text-left font-normal" scope="row">
                    {{ row.what }}
                  </th>
                  @for (cell of [row.free, row.pro]; track $index) {
                    <td class="py-2.5 pr-4">
                      @if (cell === true) {
                        <jb-icon
                          name="check"
                          [size]="16"
                          class="text-good"
                          aria-label="Yes"
                        />
                      } @else if (cell === false) {
                        <span class="text-ink-muted">No</span>
                      } @else {
                        {{ cell }}
                      }
                    </td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
        <p class="mt-3 text-sm text-ink-muted">
          Accounts opened before {{ earlyBefore }} keep interview prep, AI
          resume reviews and instant alerts on the Free plan.
        </p>
      </section>

      <!-- Credits -->
      <section class="mt-12">
        <h2 class="text-xl font-semibold">What a credit buys</h2>
        <p class="mt-2 max-w-2xl text-sm text-ink-muted">
          A credit pays for AI work on Jobbotix's own AI account. Work done on
          your own key costs no credits, and neither does scoring postings or
          reading a posting you add.
        </p>
        <div class="mt-4 overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-left text-xs text-ink-muted">
              <tr>
                <th class="py-2 pr-4 font-medium">AI work</th>
                <th class="w-1/5 py-2 pr-4 text-right font-medium">Credits</th>
                <th class="w-1/4 py-2 text-right font-medium">
                  {{ credits }} credits cover
                </th>
              </tr>
            </thead>
            <tbody>
              @for (p of priced; track p.job) {
                <tr class="border-t border-line">
                  <th class="py-2.5 pr-4 text-left font-normal" scope="row">
                    {{ p.label }}
                  </th>
                  <td class="py-2.5 pr-4 text-right tabular-nums">
                    {{ p.credits }}
                  </td>
                  <td class="py-2.5 text-right tabular-nums text-ink-muted">
                    {{ covers(p.job) }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <!-- Questions -->
      <section class="mt-12 max-w-2xl">
        <h2 class="text-xl font-semibold">Questions</h2>
        <div class="mt-3 flex flex-col">
          @for (q of questions; track q.q) {
            <details class="border-t border-line py-3">
              <summary class="cursor-pointer font-medium">{{ q.q }}</summary>
              <p class="mt-2 text-sm text-ink-muted">{{ q.a }}</p>
            </details>
          }
        </div>
        <p class="mt-6 text-sm text-ink-muted">
          The details are in the
          <a routerLink="/terms" class="underline">terms</a>, the
          <a routerLink="/refunds" class="underline">refund policy</a> and the
          <a routerLink="/privacy" class="underline">privacy page</a>. Questions
          go to <a [href]="'mailto:' + email" class="underline">{{ email }}</a
          >.
        </p>
      </section>
    </div>
  `,
})
export class Pricing {
  private readonly auth = inject(Auth);
  protected readonly onSale = PRO_ON_SALE;
  protected readonly email = LEGAL.email;
  /** Whether anyone can sign up, or an invite is needed (as on the front page). */
  protected readonly open = signal(false);

  constructor() {
    void this.auth
      .signupIsOpen()
      .then((o) => this.open.set(o))
      .catch(() => undefined);
  }

  protected readonly monthly = usd(PRICING.pro.monthlyUsd);
  protected readonly quarterly = usd(PRICING.pro.quarterlyUsd);
  protected readonly saving = quarterlySaving();
  protected readonly foundingMonthly = usd(PRICING.founding.monthlyUsd);
  protected readonly foundingQuarterly = usd(PRICING.founding.quarterlyUsd);
  protected readonly seats = PRICING.founding.seats;
  protected readonly credits = PRICING.pro.monthlyCredits;
  protected readonly compare = COMPARE;
  protected readonly earlyBefore = PRICING.earlyBefore;
  protected readonly priced = CREDIT_PRICES.filter((p) => p.credits > 0);

  protected readonly freeLines = [
    'Remote job postings found for you every few hours',
    'Every posting scored against your search profile',
    'Tracker, board, interviews, contacts and the daily digest',
    'Master resume with PDF export',
    'AI on your own key for scoring, letters, tailored resumes and answers; Gemini and Groq have free tiers',
    `${PRICING.limits.free.searchProfiles === 1 ? 'One search profile' : `${PRICING.limits.free.searchProfiles} search profiles`} and ${PRICING.limits.free.resumeReviews === 1 ? 'one AI review' : `${PRICING.limits.free.resumeReviews} AI reviews`} of your resume`,
    `${PRICING.trialCredits} trial credits to try AI without a key${PRO_ON_SALE ? '' : ', when Pro opens'}`,
  ];
  protected readonly proLines = [
    'Everything in Free',
    `${PRICING.pro.monthlyCredits} AI credits every month, no key needed`,
    'Interview prep sheets and company research with web search',
    `Up to ${PRICING.limits.pro.searchProfiles} search profiles, and an email at once when a role scores high`,
    'Outcome insights: what is getting replies',
    'AI resume reviews as often as you like, every resume template and Word export',
    `Top up when you need more: ${PRICING.topUp.credits} credits for ${usd(PRICING.topUp.usd)}`,
    'Your own key still works, and costs no credits',
  ];

  protected readonly questions = [
    {
      q: 'Do I need Pro to use AI?',
      a: 'No. Connect your own key in Settings and AI scoring, cover letters, tailored resumes and screening answers work on the Free plan. Gemini and Groq have free tiers that need no card. Interview prep and company research are part of Pro whichever key runs them.',
    },
    {
      q: 'I already have an account. Do I lose anything?',
      a: `No. Accounts opened before ${PRICING.earlyBefore} keep interview prep, AI resume reviews and instant alerts on the Free plan. Several search profiles, outcome insights and Word export are new, and part of Pro for everyone.`,
    },
    {
      q: 'What happens when my credits run out?',
      a: `Nothing stops working: drafts fall back to your own key if you connected one, and to the built-in templates if not. You can add ${PRICING.topUp.credits} credits for ${usd(PRICING.topUp.usd)}, or wait for the next month's ${PRICING.pro.monthlyCredits}.`,
    },
    {
      q: 'Can I cancel when I find a job?',
      a: 'Yes, at any time from Settings. Pro stays on until the end of the period you paid for, then the account goes back to Free with everything you saved still there.',
    },
    {
      q: 'Can I get a refund?',
      a: `Yes. Your first Pro payment is refunded if you ask within ${REFUND_RULES.firstPaymentDays} days: in full when you used no more than ${REFUND_RULES.firstPaymentCredits} credits, and less when you used more. It is given once per person. The refund policy has the rest.`,
    },
    {
      q: 'Who takes the payment?',
      a: `${seller().replace(/^a /, 'A ')}, which Jobbotix sells through. It takes the payment, adds any tax and sends the invoice. Jobbotix never sees your card number.`,
    },
  ];

  /** "about 100" for 5 credits a piece out of 500. */
  covers(job: Parameters<typeof monthlyCovers>[0]) {
    return `about ${monthlyCovers(job)}`;
  }
}
