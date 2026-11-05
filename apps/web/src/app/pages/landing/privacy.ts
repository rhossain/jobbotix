import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'jb-privacy',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="mx-auto max-w-2xl py-6 text-[15px] leading-relaxed">
      <nav class="text-sm">
        <a routerLink="/" class="text-ink-muted hover:underline">← Jobbotix</a>
      </nav>
      <h1 class="mt-4 text-2xl font-semibold tracking-tight">Privacy</h1>
      <p class="mt-1 text-sm text-ink-muted">
        Plain words, because that is the only kind worth reading.
      </p>

      <h2 class="mt-8 text-lg font-semibold">What is stored</h2>
      <ul class="mt-2 list-disc space-y-1 pl-5">
        <li>Your account: email, display name, timezone.</li>
        <li>
          Your search profile: the roles, stacks and rules you set, and your
          scoring weights.
        </li>
        <li>
          Job postings your runs or you add: the posting's public text and link,
          the score and reasons, and anything you write about it (notes,
          letters, answers).
        </li>
        <li>
          Activity on those postings (status changes, reminders, run summaries)
          so the tracker can show history.
        </li>
      </ul>

      <h2 class="mt-8 text-lg font-semibold">Where it lives</h2>
      <p class="mt-2">
        In a Supabase project (Postgres) with row-level security: every row
        carries your user id and the database refuses to show it to anyone else,
        including other users. Email digests go out through Resend to the
        address on your account.
      </p>

      <h2 class="mt-8 text-lg font-semibold">What is never stored</h2>
      <ul class="mt-2 list-disc space-y-1 pl-5">
        <li>
          Your password (handled by Supabase Auth; we only ever see a hash).
        </li>
        <li>
          Your Anthropic API key in plain text. If you add one, it is kept in
          Supabase Vault and read only by the function that makes a request on
          your behalf.
        </li>
        <li>
          Anything from job boards beyond the posting itself: no cookies, no
          accounts, no scraping of people.
        </li>
        <li>
          Applications. Jobbotix never submits one; you do that on the
          employer's site.
        </li>
      </ul>

      <h2 class="mt-8 text-lg font-semibold">Who can see what</h2>
      <p class="mt-2">
        Only you can see your data. The admin can see the list of accounts and
        invite codes, not your roles, notes or letters. Aggregate market
        signals, if we ever show them, are counts across users with nothing
        identifying.
      </p>

      <h2 class="mt-8 text-lg font-semibold">Deleting your account</h2>
      <p class="mt-2">
        Email the address on the sign-in page from your account email and
        everything above is deleted within seven days; the database cascades
        from your user row, so nothing is left behind.
      </p>

      <p class="mt-8 text-sm text-ink-muted">Last updated November 2026.</p>
    </article>
  `,
})
export class Privacy {}
