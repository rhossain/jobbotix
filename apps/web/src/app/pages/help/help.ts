import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Auth } from '../../core/auth';
import { HELP_AREAS, HELP_ARTICLES, HELP_EMAIL } from '../../help/articles';
import { HelpChat } from '../../help/help-chat';
import { searchHelp } from '../../help/search';
import { Tour } from '../../shell/tour';
import { Button, Icon, PageHeader } from '../../ui';
import { GUIDES, guideLength } from './guides';

/**
 * Help: search every article, browse them by topic, and the short how-to
 * videos with their steps written out. Open to everyone, signed in or not,
 * so it can be linked from emails and found by search engines.
 */
@Component({
  selector: 'jb-help',
  imports: [Button, Icon, PageHeader, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <jb-page-header
      title="Help"
      lead="Answers to common questions, and short videos that show how to use Jobbotix."
    >
      @if (auth.isSignedIn()) {
        <div actions class="flex flex-wrap gap-2">
          <button type="button" jbButton (click)="tour.start()">
            <jb-icon name="compass" /> Take the tour
          </button>
          <button type="button" jbButton="primary" (click)="chat.show()">
            <jb-icon name="message-circle-question-mark" /> Ask a question
          </button>
        </div>
      }
    </jb-page-header>

    <div class="relative mt-6 max-w-3xl">
      <label for="help-search" class="sr-only">Search help</label>
      <jb-icon
        name="search"
        [size]="18"
        class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint"
      />
      <input
        id="help-search"
        type="search"
        class="jb-input pl-10"
        placeholder="Search help, for example: add a job from LinkedIn"
        autocomplete="off"
        [value]="query()"
        (input)="query.set($any($event.target).value)"
      />
    </div>

    @if (query().trim()) {
      <section class="mt-6 max-w-3xl" aria-live="polite">
        @if (results().length) {
          <ul class="flex flex-col gap-2">
            @for (a of results(); track a.id) {
              <li>
                <a
                  class="jb-card block p-4 no-underline"
                  [routerLink]="['/help', a.id]"
                >
                  <span class="block font-semibold text-ink">{{
                    a.title
                  }}</span>
                  <span class="mt-1 block text-sm text-ink-muted">{{
                    a.summary
                  }}</span>
                </a>
              </li>
            }
          </ul>
        } @else {
          <p class="text-ink-muted">
            Nothing found for that. Try other words, or write to
            <a class="text-brand-ink underline" [href]="'mailto:' + email">{{
              email
            }}</a
            >.
          </p>
        }
      </section>
    } @else {
      <section class="mt-8" aria-labelledby="topics-h">
        <h2 id="topics-h" class="text-lg font-semibold text-ink">
          Questions by topic
        </h2>
        <div class="mt-4 grid gap-4 md:grid-cols-2">
          @for (area of areas; track area.id) {
            <section
              class="jb-card p-5"
              [attr.aria-labelledby]="'area-' + area.id"
            >
              <h3 [id]="'area-' + area.id" class="font-semibold text-ink">
                {{ area.label }}
              </h3>
              <ul class="mt-2 flex flex-col">
                @for (a of byArea()[area.id]; track a.id) {
                  <li>
                    <a
                      class="flex min-h-10 items-center gap-2 py-1.5 text-sm text-brand-ink no-underline hover:underline"
                      [routerLink]="['/help', a.id]"
                      >{{ a.title }}</a
                    >
                  </li>
                }
              </ul>
            </section>
          }
        </div>
      </section>

      <section class="mt-10" aria-labelledby="videos-h">
        <h2 id="videos-h" class="text-lg font-semibold text-ink">
          Short videos
        </h2>
        <p class="mt-1 max-w-3xl text-sm text-ink-muted">
          In the order to do them. They have no sound; every step is written on
          screen and again under the video.
        </p>
        <nav class="mt-4 flex flex-wrap gap-2" aria-label="Videos on this page">
          @for (g of guides; track g.id; let i = $index) {
            <a jbButton size="sm" routerLink="/help" [fragment]="g.id"
              >{{ i + 1 }}. {{ g.title }}</a
            >
          }
        </nav>

        <ol class="mt-6 flex max-w-3xl flex-col gap-6">
          @for (g of guides; track g.id; let i = $index) {
            <li
              [id]="g.id"
              class="jb-card flex scroll-mt-20 flex-col gap-4 p-5 md:p-6"
            >
              <div>
                <h3 class="text-lg font-semibold text-ink">
                  {{ i + 1 }}. {{ g.title }}
                  @if (g.optional) {
                    <span class="font-normal text-ink-faint">(optional)</span>
                  }
                </h3>
                <p class="mt-1 text-sm text-ink-muted">
                  {{ g.lead }} {{ length(g.seconds) }} video.
                </p>
              </div>
              <video
                class="aspect-video w-full rounded-control border border-line bg-black"
                controls
                playsinline
                preload="none"
                width="1280"
                height="720"
                [poster]="'/help/' + g.id + '.jpg'"
                [src]="'/help/' + g.id + '.mp4'"
                [attr.aria-label]="'Video: ' + g.title"
              ></video>
              <details class="text-sm" [open]="open === g.id">
                <summary class="cursor-pointer font-medium text-ink">
                  Read the steps instead
                </summary>
                <ol
                  class="mt-3 flex list-decimal flex-col gap-1.5 pl-5 text-ink-muted"
                >
                  @for (s of g.steps; track s) {
                    <li>{{ s }}</li>
                  }
                </ol>
              </details>
              @if (auth.isSignedIn()) {
                <div>
                  <a jbButton="primary" size="sm" [routerLink]="g.link"
                    >{{ g.linkLabel }} <jb-icon name="chevron-right"
                  /></a>
                </div>
              }
            </li>
          }
        </ol>
      </section>
    }

    <p class="mt-10 max-w-3xl text-sm text-ink-muted">
      Still stuck?
      @if (auth.isSignedIn()) {
        <button
          type="button"
          class="text-brand-ink underline"
          (click)="chat.show()"
        >
          Ask in the Help chat</button
        >, or write to
      } @else {
        Write to
      }
      <a class="text-brand-ink underline" [href]="'mailto:' + email">{{
        email
      }}</a>
      and say what you were trying to do.
    </p>
  `,
})
export class HelpPage {
  protected readonly tour = inject(Tour);
  protected readonly auth = inject(Auth);
  protected readonly chat = inject(HelpChat);
  private readonly doc = inject(DOCUMENT);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly guides = GUIDES;
  protected readonly areas = HELP_AREAS;
  protected readonly email = HELP_EMAIL;
  /** The guide a "Watch how" link pointed at: its steps start open. */
  protected open: string | null = this.route.snapshot.fragment;

  protected readonly query = signal('');
  protected readonly results = computed(() =>
    searchHelp(this.query(), '', 8).map((h) => h.article),
  );
  protected readonly byArea = computed(() => {
    const out: Record<string, typeof HELP_ARTICLES> = {};
    for (const area of HELP_AREAS)
      out[area.id] = HELP_ARTICLES.filter((a) => a.area === area.id);
    return out;
  });

  constructor() {
    afterNextRender(() => {
      this.route.fragment
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((id) => {
          if (!id) return;
          this.doc
            .getElementById(id)
            ?.scrollIntoView({ block: 'start', behavior: 'auto' });
        });
    });
  }

  protected length(seconds: number): string {
    return guideLength(seconds);
  }
}
