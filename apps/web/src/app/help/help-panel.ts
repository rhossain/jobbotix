import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { Auth } from '../core/auth';
import { SupportRepo } from '../core/data/repos';
import { Viewport } from '../core/viewport';
import { Logo } from '../shell/logo';
import { Tour } from '../shell/tour';
import { Button, Icon } from '../ui';
import { HELP_EMAIL, articleById, type HelpArticle } from './articles';
import { HelpArticleView } from './help-article-view';
import { HelpChat, type HelpMessage } from './help-chat';
import { searchHelp, suggestionsFor } from './search';

const MAX_QUESTION = 500;

/**
 * The Help chat window. Beside the page on wide screens, so the steps can be
 * followed while reading them; the whole screen on phones.
 *
 * It answers from the help articles, in the browser: a question finds the
 * best article, which is shown in full with a button to the right page, and
 * up to two others are offered. When nothing fits, or the answer did not
 * help, the question can go to the support team by email.
 */
@Component({
  selector: 'jb-help-panel',
  imports: [Button, HelpArticleView, Icon, Logo, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'jb-help-panel print:hidden',
    role: 'dialog',
    'aria-modal': 'false',
    'aria-labelledby': 'help-panel-title',
    '[class.is-open]': 'chat.open()',
    '[attr.inert]': 'chat.open() ? null : ""',
    '(keydown.escape)': 'close()',
  },
  template: `
    <header class="flex items-center gap-2 border-b border-line py-2 pr-2 pl-4">
      <span
        class="grid size-9 shrink-0 place-items-center rounded-full bg-brand-tint"
        aria-hidden="true"
        ><jb-logo [wordmark]="false" [size]="20"
      /></span>
      <div class="min-w-0 flex-1">
        <h2
          id="help-panel-title"
          tabindex="-1"
          class="text-base font-semibold text-ink outline-none"
        >
          Help
        </h2>
        <p class="truncate text-xs text-ink-muted">
          Answers from help articles
        </p>
      </div>
      @if (chat.messages().length) {
        <button
          type="button"
          jbButton="ghost"
          iconOnly
          aria-label="Start again"
          title="Start again"
          (click)="restart()"
        >
          <jb-icon name="rotate-cw" />
        </button>
      }
      <a
        jbButton="ghost"
        iconOnly
        routerLink="/help"
        aria-label="All help articles"
        title="All help articles"
        (click)="followed()"
      >
        <jb-icon name="book-open" />
      </a>
      <button
        type="button"
        jbButton="ghost"
        iconOnly
        aria-label="Close help"
        (click)="close()"
      >
        <jb-icon name="x" />
      </button>
    </header>

    <div
      #scroller
      class="relative flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-4 py-4"
      aria-live="polite"
      aria-relevant="additions"
    >
      <div class="bubble bot">
        <p class="font-medium text-ink">{{ greeting() }}</p>
        <p class="mt-1 text-sm text-ink-muted">
          Ask how to do something in Jobbotix, or pick a question.
        </p>
      </div>

      @if (!chat.messages().length) {
        <div>
          <p class="mb-2 text-xs font-semibold text-ink-faint">
            Suggested for this page
          </p>
          <div class="flex flex-col items-start gap-2">
            @for (s of suggestions(); track s.id) {
              <button type="button" class="chip" (click)="pick(s)">
                {{ s.title }}
              </button>
            }
          </div>
        </div>
      }

      @for (m of chat.messages(); track m.id) {
        @switch (m.from === 'me' ? 'me' : m.kind) {
          @case ('me') {
            <p class="bubble me">{{ text(m) }}</p>
          }
          @case ('answer') {
            @if (answer(m); as x) {
              <div class="bubble bot w-full">
                <p class="text-xs text-ink-muted">{{ x.intro }}</p>
                <h3 class="mt-1 font-semibold text-ink">
                  {{ x.article.title }}
                </h3>
                <jb-help-article-view
                  class="mt-1 block"
                  [article]="x.article"
                  [compact]="true"
                  (go)="followed()"
                />
                @if (x.also.length) {
                  <p class="mt-4 text-xs font-semibold text-ink-faint">
                    Also see
                  </p>
                  <div class="mt-1.5 flex flex-col items-start gap-1.5">
                    @for (o of x.also; track o.id) {
                      <button type="button" class="chip" (click)="pick(o)">
                        {{ o.title }}
                      </button>
                    }
                  </div>
                }
                <div
                  class="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3"
                >
                  @switch (x.feedback) {
                    @case ('yes') {
                      <p class="text-sm text-ink-muted">
                        <jb-icon
                          name="circle-check"
                          [size]="16"
                          class="text-good"
                        />
                        Glad that helped.
                      </p>
                    }
                    @case ('no') {
                      <p class="text-sm text-ink-muted">Thanks for saying.</p>
                    }
                    @default {
                      <p class="mr-auto text-sm text-ink-muted">
                        Did this answer your question?
                      </p>
                      <span class="flex gap-2">
                        <button
                          type="button"
                          jbButton
                          size="sm"
                          (click)="feedback(m.id, 'yes')"
                        >
                          <jb-icon name="thumbs-up" /> Yes
                        </button>
                        <button
                          type="button"
                          jbButton
                          size="sm"
                          (click)="feedback(m.id, 'no')"
                        >
                          <jb-icon name="thumbs-down" /> No
                        </button>
                      </span>
                    }
                  }
                </div>
              </div>
            }
          }
          @case ('none') {
            <div class="bubble bot">
              <p class="text-sm text-ink">
                I could not find a help article for that.
              </p>
              <p class="mt-1 text-sm text-ink-muted">
                Try other words, look through all help, or send your question to
                the support team.
              </p>
              <div class="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  jbButton="primary"
                  size="sm"
                  (click)="toSupport()"
                >
                  <jb-icon name="mail" /> Send to support
                </button>
                <a jbButton size="sm" routerLink="/help" (click)="followed()"
                  ><jb-icon name="book-open" /> All help</a
                >
              </div>
            </div>
          }
          @case ('text') {
            <p class="bubble bot text-sm text-ink">{{ text(m) }}</p>
          }
          @case ('support') {
            @if (support(m); as s) {
              <div class="bubble bot w-full">
                @if (s.state === 'sent') {
                  <p class="text-sm text-ink">
                    <jb-icon
                      name="circle-check"
                      [size]="16"
                      class="text-good"
                    />
                    Sent. The support team will reply to {{ email() }}.
                  </p>
                } @else {
                  <p class="text-sm font-medium text-ink">
                    Send your question to the support team
                  </p>
                  <p class="mt-1 text-xs text-ink-muted">
                    They reply by email to {{ email() }}. The page you are on
                    and this conversation go with it, so you need not repeat
                    yourself.
                  </p>
                  <label class="sr-only" [for]="'support-' + m.id"
                    >Your question for support</label
                  >
                  <textarea
                    class="jb-input mt-2 min-h-24 w-full resize-y text-sm"
                    maxlength="2000"
                    [id]="'support-' + m.id"
                    [value]="s.draft"
                    [disabled]="s.state === 'sending'"
                    (input)="draftSupport(m.id, $any($event.target).value)"
                  ></textarea>
                  @if (s.state === 'failed') {
                    <p class="mt-2 text-sm text-bad" role="alert">
                      {{ s.error }} You can also write to
                      <a class="underline" [href]="'mailto:' + helpEmail">{{
                        helpEmail
                      }}</a
                      >.
                    </p>
                  }
                  <div class="mt-2 flex justify-end">
                    <button
                      type="button"
                      jbButton="primary"
                      size="sm"
                      [busy]="s.state === 'sending'"
                      [disabled]="s.state === 'sending' || !s.draft.trim()"
                      (click)="sendSupport(m.id)"
                    >
                      <jb-icon name="send" /> Send
                    </button>
                  </div>
                }
              </div>
            }
          }
        }
      }
    </div>

    <form
      class="border-t border-line p-3"
      (submit)="$event.preventDefault(); ask()"
    >
      <div class="flex items-end gap-2">
        <label class="sr-only" for="help-question">Your question</label>
        <textarea
          #input
          id="help-question"
          rows="1"
          class="jb-input max-h-32 min-h-11 flex-1 resize-none text-sm"
          placeholder="Ask a question…"
          autocomplete="off"
          [attr.maxlength]="maxQuestion"
          [value]="question()"
          (input)="onType($any($event.target))"
          (keydown.enter)="onEnter($event)"
        ></textarea>
        <button
          type="submit"
          jbButton="primary"
          iconOnly
          aria-label="Ask"
          class="shrink-0"
          [disabled]="!question().trim()"
        >
          <jb-icon name="send" />
        </button>
      </div>
      <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <button
          type="button"
          class="text-brand-ink underline-offset-2 hover:underline"
          (click)="startTour()"
        >
          Take the tour
        </button>
        <button
          type="button"
          class="text-brand-ink underline-offset-2 hover:underline"
          (click)="toSupport()"
        >
          Contact support
        </button>
      </div>
    </form>
  `,
  styles: `
    .bubble {
      max-width: 92%;
      border-radius: 16px;
      padding: 0.7rem 0.9rem;
    }
    .bubble.bot {
      align-self: flex-start;
      border-top-left-radius: 6px;
      background: var(--surface-sunken);
    }
    .bubble.me {
      align-self: flex-end;
      border-top-right-radius: 6px;
      background: var(--brand);
      color: var(--ink-on-brand);
      font-size: 0.875rem;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .chip {
      max-width: 100%;
      padding: 0.45rem 0.8rem;
      border: 1px solid var(--line-strong);
      border-radius: 999px;
      background: var(--surface);
      color: var(--ink);
      font: inherit;
      font-size: 0.875rem;
      text-align: left;
      cursor: pointer;
      transition:
        border-color var(--dur-fast) var(--motion-ease),
        background-color var(--dur-fast) var(--motion-ease);
    }
    .chip:hover {
      border-color: var(--brand);
      background: var(--brand-tint);
    }
    .chip:focus-visible {
      outline: 2px solid var(--brand);
      outline-offset: 2px;
    }
  `,
})
export class HelpPanel {
  protected readonly chat = inject(HelpChat);
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly viewport = inject(Viewport);
  private readonly tour = inject(Tour);
  private readonly supportRepo = inject(SupportRepo);
  private readonly doc = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly scroller =
    viewChild.required<ElementRef<HTMLElement>>('scroller');
  private readonly input =
    viewChild.required<ElementRef<HTMLTextAreaElement>>('input');

  protected readonly helpEmail = HELP_EMAIL;
  protected readonly maxQuestion = MAX_QUESTION;
  protected readonly question = signal('');

  private readonly page = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects.split(/[?#]/)[0]),
    ),
    { initialValue: this.router.url.split(/[?#]/)[0] },
  );

  protected readonly suggestions = computed(() => suggestionsFor(this.page()));
  protected readonly email = computed(() => this.auth.user()?.email ?? 'you');
  protected readonly greeting = computed(() => {
    const name = this.auth.profile()?.name?.trim().split(/\s+/)[0];
    return name ? `Hi ${name}, how can I help?` : 'Hi, how can I help?';
  });

  constructor() {
    // Opening: focus the question box on wide screens; on phones the title,
    // so the keyboard does not cover the window straight away.
    effect(() => {
      if (!this.chat.open()) return;
      untracked(() => {
        const q = this.chat.pending();
        if (q) {
          this.chat.pending.set(null);
          this.ask(q);
        }
        setTimeout(() => {
          if (this.viewport.phone())
            this.doc.getElementById('help-panel-title')?.focus();
          else this.input().nativeElement.focus();
        }, 0);
      });
    });

    // New messages: keep the newest in view.
    effect(() => {
      this.chat.messages();
      untracked(() => setTimeout(() => this.toBottom(), 0));
    });

    afterNextRender(() => this.toBottom());
  }

  protected text(m: HelpMessage): string {
    return 'text' in m ? m.text : '';
  }

  protected answer(m: HelpMessage) {
    if (m.from !== 'bot' || m.kind !== 'answer') return null;
    const article = articleById(m.articleId);
    if (!article) return null;
    const also = m.also
      .map((id) => articleById(id))
      .filter((a): a is HelpArticle => !!a);
    return { article, also, intro: m.intro, feedback: m.feedback };
  }

  protected support(m: HelpMessage) {
    return m.from === 'bot' && m.kind === 'support' ? m : null;
  }

  protected onType(el: HTMLTextAreaElement) {
    this.question.set(el.value);
    // Grow with the text, up to the max height set in the template.
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  protected onEnter(e: Event) {
    const k = e as KeyboardEvent;
    if (k.shiftKey || k.isComposing) return;
    e.preventDefault();
    this.ask();
  }

  /** Asks the typed question, or `text` when given. */
  protected ask(text = this.question()) {
    const q = text.trim().slice(0, MAX_QUESTION);
    if (!q) return;
    this.chat.add({ from: 'me', text: q });
    if (text === this.question()) {
      this.question.set('');
      const el = this.input().nativeElement;
      el.value = '';
      el.style.height = '';
    }
    const hits = searchHelp(q, this.page());
    if (!hits.length) {
      this.chat.add({ from: 'bot', kind: 'none', question: q });
      return;
    }
    const [best, ...rest] = hits;
    this.chat.add({
      from: 'bot',
      kind: 'answer',
      articleId: best.article.id,
      also: rest.map((h) => h.article.id),
      intro: 'Here is what I found:',
    });
  }

  /** A suggested question: asked as if typed, answered with that article. */
  protected pick(a: HelpArticle) {
    this.chat.add({ from: 'me', text: a.title });
    this.chat.add({
      from: 'bot',
      kind: 'answer',
      articleId: a.id,
      also: [],
      intro: 'Here is how:',
    });
  }

  protected feedback(id: number, value: 'yes' | 'no') {
    this.chat.patch(id, { feedback: value });
    if (value === 'no') {
      this.chat.add({
        from: 'bot',
        kind: 'text',
        text: 'Sorry about that. Try asking in other words, or send your question to the support team below.',
      });
      this.toSupport();
    }
  }

  /** Opens a support form in the chat, filled with the last question asked. */
  protected toSupport() {
    const open = this.chat
      .messages()
      .find(
        (m) => m.from === 'bot' && m.kind === 'support' && m.state !== 'sent',
      );
    if (open) {
      setTimeout(
        () => this.doc.getElementById(`support-${open.id}`)?.focus(),
        0,
      );
      return;
    }
    const lastQuestion =
      [...this.chat.messages()].reverse().find((m) => m.from === 'me')?.text ??
      '';
    const id = this.chat.add({
      from: 'bot',
      kind: 'support',
      draft: lastQuestion,
      state: 'editing',
    });
    setTimeout(() => this.doc.getElementById(`support-${id}`)?.focus(), 0);
  }

  protected draftSupport(id: number, draft: string) {
    this.chat.patch(id, { draft } as Partial<HelpMessage>);
  }

  protected async sendSupport(id: number) {
    const m = this.chat.messages().find((x) => x.id === id);
    if (!m || m.from !== 'bot' || m.kind !== 'support') return;
    const message = m.draft.trim();
    if (!message) return;
    this.chat.patch(id, { state: 'sending' } as Partial<HelpMessage>);
    try {
      await this.supportRepo.send({
        message,
        page: this.page(),
        conversation: this.transcript(id),
      });
      this.chat.patch(id, { state: 'sent' } as Partial<HelpMessage>);
    } catch (e) {
      this.chat.patch(id, {
        state: 'failed',
        error: (e as Error).message || 'It could not be sent.',
      } as Partial<HelpMessage>);
    }
  }

  /** The conversation before message `upTo`, as lines support can read. */
  private transcript(upTo: number): string {
    return this.chat
      .messages()
      .filter((m) => m.id < upTo)
      .map((m) => {
        if (m.from === 'me') return `Asked: ${m.text}`;
        switch (m.kind) {
          case 'answer': {
            const a = articleById(m.articleId);
            const fb = m.feedback ? ` (helpful: ${m.feedback})` : '';
            return `Shown: ${a?.title ?? m.articleId}${fb}`;
          }
          case 'none':
            return 'No article found';
          default:
            return '';
        }
      })
      .filter(Boolean)
      .join('\n')
      .slice(0, 4000);
  }

  protected restart() {
    this.chat.clear();
    this.input().nativeElement.focus();
  }

  /** A link in the chat was followed: on phones the page needs the screen. */
  protected followed() {
    if (this.viewport.phone()) this.chat.close();
  }

  protected startTour() {
    this.chat.close();
    this.tour.start();
  }

  protected close() {
    const inside = this.host.nativeElement.contains(this.doc.activeElement);
    this.chat.close();
    if (inside) (this.doc.activeElement as HTMLElement | null)?.blur();
  }

  /**
   * Shows the newest exchange: the question and the start of its answer.
   * A long answer is read from its top, not scrolled past.
   */
  private toBottom() {
    const el = this.scroller().nativeElement;
    const last = el.lastElementChild as HTMLElement | null;
    const prev = last?.previousElementSibling as HTMLElement | null;
    if (!last || !prev) return;
    const fits = last.offsetHeight + prev.offsetHeight < el.clientHeight - 24;
    el.scrollTop = fits ? el.scrollHeight : prev.offsetTop - 12;
  }
}
