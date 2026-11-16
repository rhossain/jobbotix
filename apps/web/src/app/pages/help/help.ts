import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterNextRender,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Tour } from '../../shell/tour';
import { Button, Icon, PageHeader } from '../../ui';
import { GUIDES, guideLength } from './guides';

/** Short how-to videos, each with its steps written out for reading instead. */
@Component({
  selector: 'jb-help',
  imports: [Button, Icon, PageHeader, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <jb-page-header
      title="Help"
      lead="Four short videos show how to use Jobbotix, in the order to do them. They have no sound; every step is written on screen and again under the video."
    >
      <div actions>
        <button type="button" jbButton (click)="tour.start()">
          <jb-icon name="compass" /> Take the tour
        </button>
      </div>
    </jb-page-header>

    <nav class="mt-6 flex flex-wrap gap-2" aria-label="Videos on this page">
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
            <h2 class="text-lg font-semibold text-ink">
              {{ i + 1 }}. {{ g.title }}
              @if (g.optional) {
                <span class="font-normal text-ink-faint">(optional)</span>
              }
            </h2>
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
          <div>
            <a jbButton="primary" size="sm" [routerLink]="g.link"
              >{{ g.linkLabel }} <jb-icon name="chevron-right"
            /></a>
          </div>
        </li>
      }
    </ol>

    <p class="mt-8 max-w-3xl text-sm text-ink-muted">
      Still stuck? Write to
      <a class="text-brand-ink underline" href="mailto:support@jobbotix.com"
        >support&#64;jobbotix.com</a
      >
      and say what you were trying to do.
    </p>
  `,
})
export class HelpPage {
  protected readonly tour = inject(Tour);
  private readonly doc = inject(DOCUMENT);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly guides = GUIDES;
  /** The guide a "Watch how" link pointed at: its steps start open. */
  protected open: string | null = this.route.snapshot.fragment;

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
