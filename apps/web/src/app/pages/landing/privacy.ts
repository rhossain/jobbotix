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
          Your job preferences: the job titles, skills and rules you set, and
          your match score settings.
        </li>
        <li>
          Job postings your runs or you add: the posting's public text and link,
          the score and reasons, and anything you write about it (notes,
          letters, answers).
        </li>
        <li>
          Activity on those postings (status changes, reminders, run summaries)
          so Jobbotix can show history.
        </li>
      </ul>

      <h2 class="mt-10 text-xl font-semibold">Where it lives</h2>
      <p class="mt-2">
        In a Supabase project (Postgres) with row-level security: every row
        carries your user id and the database refuses to show it to anyone else,
        including other users. The daily emails go out through Resend to the
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

      <h2 id="linkedin" class="mt-10 text-xl font-semibold">
        Your LinkedIn file
      </h2>
      <p class="mt-2">
        Jobbotix never signs in to LinkedIn and never opens one of its pages. If
        you import the file LinkedIn gives you from "Get a copy of your data",
        it is opened in your browser and is not uploaded. Only this is taken
        from it, and only when you press Import:
      </p>
      <ul class="mt-2 list-disc space-y-1 pl-5">
        <li>
          <span class="font-medium">Jobs you saved and applied to:</span> the
          company, job title, link and day. They become ordinary jobs in your
          account.
        </li>
        <li>
          <span class="font-medium">Your connections,</span> if you leave that
          box ticked: each person's name, company, job title, profile link and
          the day you connected. Never their email address or phone number, even
          where the file has one. These are other people's details, so only you
          can see them; they are never shared, pooled across users or shown to
          the admin, even with Support access. Settings → Your data → Delete my
          LinkedIn connections removes them at once, and a new import takes the
          place of the old list.
        </li>
        <li>
          <span class="font-medium">Your profile,</span> work history, education
          and skills, if you choose to fill your resume from them.
        </li>
      </ul>
      <p class="mt-2">
        Everything else in the file (messages, invitations, searches and the
        rest) is never opened. The text of a job post you paste from LinkedIn
        stays on your own job: it is left out of share links and is not reused
        for anyone else.
      </p>

      <h2 id="linkedin-sign-in" class="mt-10 text-xl font-semibold">
        Signing in with LinkedIn
      </h2>
      <p class="mt-2">
        "Continue with LinkedIn" is LinkedIn's own sign-in. You type your
        LinkedIn password on LinkedIn's page, never here, and LinkedIn asks you
        before it shares anything. It then sends Jobbotix only this:
      </p>
      <ul class="mt-2 list-disc space-y-1 pl-5">
        <li>
          <span class="font-medium">Your name and email address.</span> They
          become the name and email of your Jobbotix account. If an account with
          that email address already exists, you are signed in to it; no second
          account is made.
        </li>
        <li>
          <span class="font-medium">The link to your profile photo</span> and a
          number that tells one LinkedIn sign-in from another; LinkedIn may also
          send the language you use it in. These are kept with your sign-in
          record. Jobbotix does not show the photo or use it for anything.
        </li>
      </ul>
      <p class="mt-2">
        That is all. Signing in this way gives Jobbotix no access to your
        LinkedIn account: it cannot read your profile, connections, messages or
        jobs, and it cannot post or apply for you. It is a way to sign in, not a
        check of who you are. Deleting your Jobbotix account deletes what
        LinkedIn sent with it, and you can withdraw the permission at any time
        in your LinkedIn settings.
      </p>

      <h2 id="ai" class="mt-10 text-xl font-semibold">AI providers</h2>
      <p class="mt-2">
        Jobbotix calls a model only with a key you connected yourself in
        Settings, and only for the work you ask for or switched on: scoring the
        strongest postings in your runs, reading a posting you add, tailoring a
        resume, drafting letters, screening answers, messages and interview
        prep, reading a resume file, and company research. For those calls the
        provider receives the posting text and the wording of your resume, plus
        your voice samples for drafts. Your email, phone number and links are
        left out, and your name, headline and location are added only where a
        draft needs them (a letter, a message, screening answers, interview
        prep). Reading a resume file is the exception: the text of the file is
        sent as it is, contact details included. Nothing else from your account
        is sent. A photo you add to your resume is stored with your account for
        the resume alone: it is never sent to an AI provider, and it is deleted
        when you remove it or delete your account.
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
      <p class="mt-2">
        Two results are kept once for everyone, so the same work is not paid for
        twice, and neither says who it came from. When a model reads a posting
        you add, the fields it finds (company, title, location, pay, stack) are
        stored against a fingerprint of that posting, and the next person who
        adds the same posting gets them without a model call. And when Jobbotix
        pays for web research on a company, what it found about the company is
        reused for 30 days for anyone who looks at that company. Your account,
        your resume and your notes are never part of either.
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
          <span class="font-medium">Activity:</span> how many jobs you track by
          status and when your runs happened, to see whether the service is
          working for you. Counts only.
        </li>
      </ul>
      <p class="mt-2">
        The admin cannot see your jobs, resume, letters, answers or notes. If
        you ask for help, you can open your jobs and resume to the admin for 7
        days from Settings, under Support access; it closes by itself, and your
        notes and letters stay closed even then. Every time the admin opens an
        account or changes something on it, that is recorded. The admin can also
        suspend or delete an account that breaks the rules. Aggregate market
        signals, if we ever show them, are counts across users with nothing
        identifying.
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
