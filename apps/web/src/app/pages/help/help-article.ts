import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { Auth } from '../../core/auth';
import {
  HELP_AREAS,
  HELP_ARTICLES,
  HELP_EMAIL,
  articleById,
} from '../../help/articles';
import { HelpArticleView } from '../../help/help-article-view';
import { HelpChat } from '../../help/help-chat';
import { BackLink, Button, Icon } from '../../ui';

/** One help article on its own page: /help/<id>. */
@Component({
  selector: 'jb-help-article',
  imports: [BackLink, Button, HelpArticleView, Icon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <jb-back-link link="/help" label="Help" />
    @if (article(); as a) {
      <article class="mt-3 max-w-[var(--reading-max)]">
        <p class="text-sm font-medium text-brand-ink">{{ area() }}</p>
        <h1
          class="mt-1 text-[1.75rem] leading-tight font-semibold tracking-tight text-ink md:text-3xl"
        >
          {{ a.title }}
        </h1>
        <jb-help-article-view class="mt-4 block" [article]="a" />
      </article>

      @if (related().length) {
        <section
          class="mt-10 max-w-[var(--reading-max)]"
          aria-labelledby="related-h"
        >
          <h2 id="related-h" class="font-semibold text-ink">
            More about {{ area().toLowerCase() }}
          </h2>
          <ul class="mt-2 flex flex-col">
            @for (r of related(); track r.id) {
              <li>
                <a
                  class="flex min-h-10 items-center py-1.5 text-sm text-brand-ink no-underline hover:underline"
                  [routerLink]="['/help', r.id]"
                  >{{ r.title }}</a
                >
              </li>
            }
          </ul>
        </section>
      }

      <div class="jb-card mt-10 max-w-[var(--reading-max)] p-5">
        <p class="font-medium text-ink">Did not find what you needed?</p>
        <div class="mt-3 flex flex-wrap gap-2">
          @if (auth.isSignedIn()) {
            <button
              type="button"
              jbButton="primary"
              size="sm"
              (click)="chat.show()"
            >
              <jb-icon name="message-circle-question-mark" /> Ask in the Help
              chat
            </button>
          }
          <a jbButton size="sm" [href]="'mailto:' + email"
            ><jb-icon name="mail" /> Write to {{ email }}</a
          >
        </div>
      </div>
    } @else {
      <h1 class="mt-3 text-2xl font-semibold text-ink">Article not found</h1>
      <p class="mt-2 text-ink-muted">
        It may have moved. All help articles are on the
        <a class="text-brand-ink underline" routerLink="/help">Help page</a>.
      </p>
    }
  `,
})
export class HelpArticlePage {
  /** From the address, /help/:id. */
  readonly id = input('');
  protected readonly auth = inject(Auth);
  protected readonly chat = inject(HelpChat);
  protected readonly email = HELP_EMAIL;

  protected readonly article = computed(() => articleById(this.id()));
  protected readonly area = computed(
    () => HELP_AREAS.find((x) => x.id === this.article()?.area)?.label ?? '',
  );
  protected readonly related = computed(() => {
    const a = this.article();
    return a
      ? HELP_ARTICLES.filter((x) => x.area === a.area && x.id !== a.id).slice(
          0,
          6,
        )
      : [];
  });

  constructor() {
    const title = inject(Title);
    effect(() => {
      const a = this.article();
      title.setTitle(a ? `${a.title} · Help · Jobbotix` : 'Help · Jobbotix');
    });
  }
}
