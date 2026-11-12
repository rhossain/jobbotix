import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PROVIDER_ORDER, PROVIDERS } from '@jobbotix/shared-types';

@Component({
  selector: 'jb-privacy',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="mx-auto max-w-2xl py-6 text-base leading-relaxed text-ink">
      <nav class="text-sm">
        <a routerLink="/" class="text-ink-muted no-underline hover:text-ink"
          >‹ Jobbotix</a
        >
      </nav>
      <h1 class="mt-4 text-3xl font-semibold tracking-tight">Privacy</h1>
      <p class="mt-1 text-sm text-ink-muted">
        Plain words, because that is the only kind worth reading.
      </p>

      <h2 class="mt-10 text-xl font-semibold">What is stored</h2>
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

      <h2 class="mt-10 text-xl font-semibold">Where it lives</h2>
      <p class="mt-2">
        In a Supabase project (Postgres) with row-level security: every row
        carries your user id and the database refuses to show it to anyone else,
        including other users. Email digests go out through Resend to the
        address on your account.
      </p>

      <h2 class="mt-10 text-xl font-semibold">What is never stored</h2>
      <ul class="mt-2 list-disc space-y-1 pl-5">
        <li>
          Your password (handled by Supabase Auth; we only ever see a hash).
        </li>
        <li>
          Your AI provider keys in plain text. A key you connect is kept in
          Supabase Vault, read only by the function that makes a request on your
          behalf, and never sent back to your browser.
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

      <h2 id="ai" class="mt-10 text-xl font-semibold">AI providers</h2>
      <p class="mt-2">
        Jobbotix calls a model only with a key you connected yourself in
        Settings, and only for the work you ask for or switched on: scoring the
        strongest postings in your runs, reading a posting you add, tailoring a
        resume, drafting letters, screening answers, messages and interview
        prep, reading a resume file, and company research. For those calls the
        provider receives the posting text and your resume as you saved it
        (including the contact details on it), plus your voice samples for
        drafts. Nothing else from your account is sent. A photo you add to your
        resume is stored with your account for the resume alone: it is never
        sent to an AI provider, and it is deleted when you remove it or delete
        your account.
      </p>
      <ul class="mt-2 list-disc space-y-1 pl-5">
        @for (p of providers; track p.id) {
          <li>
            <span class="font-medium">{{ p.name }}.</span> {{ p.dataNote }}
          </li>
        }
      </ul>
      <p class="mt-2">
        Each provider's own terms cover what it receives. Without a connection
        nothing is sent to any model: scoring and drafting use Jobbotix's
        built-in rules and templates.
      </p>

      <h2 class="mt-10 text-xl font-semibold">Who can see what</h2>
      <p class="mt-2">
        Only you can see your data. The person who runs Jobbotix (the admin) can
        see what is needed to run the service and to answer you, and nothing of
        what you write:
      </p>
      <ul class="mt-2 list-disc space-y-1 pl-5">
        <li>
          <span class="font-medium">Your account:</span> email, name, timezone,
          sign-up date and last sign-in, to know who an account belongs to.
        </li>
        <li>
          <span class="font-medium">Billing:</span> your plan, payments and AI
          credits, to answer billing questions and give refunds. Never a card
          number; the payment company holds those.
        </li>
        <li>
          <span class="font-medium">AI usage:</span> how many AI calls you made,
          on which provider and model, how many tokens, and whether a connection
          is failing, to keep costs in check and to see why something broke.
          Never your keys or what was sent.
        </li>
        <li>
          <span class="font-medium">Activity:</span> how many roles you track by
          status and when your runs happened, to see whether the service is
          working for you. Counts only.
        </li>
      </ul>
      <p class="mt-2">
        The admin cannot see your roles, resume, letters, answers or notes. If
        you ask for help, you can open your roles and master resume to the admin
        for 7 days from Settings, under Support access; it closes by itself, and
        your notes and letters stay closed even then. Every time the admin opens
        an account or changes something on it, that is recorded. The admin can
        also suspend or delete an account that breaks the rules. Aggregate
        market signals, if we ever show them, are counts across users with
        nothing identifying.
      </p>

      <h2 class="mt-10 text-xl font-semibold">Deleting your account</h2>
      <p class="mt-2">
        Settings → Delete your account removes your account and everything above
        straight away, including your saved AI keys; the database cascades from
        your user row, so nothing is left behind. Settings → Your data downloads
        a copy first.
      </p>

      <p class="mt-8 text-sm text-ink-muted">Last updated November 2026.</p>
    </article>
  `,
})
export class Privacy {
  /** The providers a user can connect, with what each does with data. */
  protected readonly providers = PROVIDER_ORDER.map((id) => PROVIDERS[id]);
}
