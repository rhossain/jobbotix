import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button, Icon } from '../ui';
import type { HelpArticle } from './articles';

/**
 * One help article: the answer, the steps, anything else worth knowing and a
 * button to the page where it is done. Used in the Help chat and on the
 * article's own page. `(go)` fires when a link inside is followed.
 */
@Component({
  selector: 'jb-help-article-view',
  imports: [Button, Icon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let a = article();
    <p [class]="compact() ? 'text-sm text-ink' : 'text-base text-ink'">
      {{ a.summary }}
    </p>
    @if (a.steps?.length) {
      <ol
        class="mt-3 flex list-decimal flex-col gap-1.5 pl-5 marker:font-semibold marker:text-brand-ink"
        [class.text-sm]="compact()"
      >
        @for (s of a.steps; track $index) {
          <li class="pl-1 text-ink">{{ s }}</li>
        }
      </ol>
    }
    @for (n of a.notes ?? []; track $index) {
      <p class="mt-2 text-ink-muted" [class.text-sm]="compact()">{{ n }}</p>
    }
    @if (a.link || a.video) {
      <div class="mt-3 flex flex-wrap gap-2">
        @if (a.link; as l) {
          <a
            jbButton="primary"
            size="sm"
            [routerLink]="l.to"
            (click)="go.emit()"
            >{{ l.label }} <jb-icon name="chevron-right"
          /></a>
        }
        @if (a.video; as v) {
          <a
            jbButton
            size="sm"
            routerLink="/help"
            [fragment]="v"
            (click)="go.emit()"
            ><jb-icon name="circle-play" /> Watch how</a
          >
        }
      </div>
    }
  `,
})
export class HelpArticleView {
  readonly article = input.required<HelpArticle>();
  /** Smaller type, for the chat window. */
  readonly compact = input(false);
  readonly go = output<void>();
}
