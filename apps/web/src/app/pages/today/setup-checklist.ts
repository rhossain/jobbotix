import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Auth } from '../../core/auth';
import {
  ResumesRepo,
  SearchProfileRepo,
  SettingsRepo,
} from '../../core/data/repos';
import { Button, Icon } from '../../ui';

const DISMISS_KEY = 'jb-setup-dismissed';

interface Step {
  id: string;
  label: string;
  why: string;
  link: string;
  action: string;
  done: boolean;
  optional?: boolean;
}

/** Getting started on Today: the four things that make the morning run useful. */
@Component({
  selector: 'jb-setup-checklist',
  imports: [Button, Icon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (show()) {
      <section class="jb-card p-5 md:p-6" aria-labelledby="setup-h">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h2 id="setup-h" class="text-lg font-semibold text-ink">
              Get set up
            </h2>
            <p class="mt-1 text-sm text-ink-muted">
              {{ doneCount() }} of {{ steps().length }} done. Each step makes
              the matches better.
            </p>
          </div>
          <button
            type="button"
            jbButton="ghost"
            size="sm"
            iconOnly
            aria-label="Hide the setup list"
            title="Hide"
            (click)="dismiss()"
          >
            <jb-icon name="x" [size]="16" />
          </button>
        </div>
        <ol class="mt-4 flex flex-col gap-2.5">
          @for (s of steps(); track s.id) {
            <li class="flex items-start gap-3 text-sm">
              <span
                class="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full"
                [class.bg-brand]="s.done"
                [class.text-on-brand]="s.done"
                [class.border]="!s.done"
                [class.border-line]="!s.done"
                aria-hidden="true"
              >
                @if (s.done) {
                  <jb-icon name="check" [size]="14" />
                }
              </span>
              <div class="min-w-0 flex-1">
                <p
                  class="font-medium"
                  [class.text-ink]="!s.done"
                  [class.text-ink-muted]="s.done"
                  [class.line-through]="s.done"
                >
                  {{ s.label }}
                  @if (s.optional) {
                    <span class="font-normal text-ink-faint">(optional)</span>
                  }
                  <span class="sr-only">{{ s.done ? ': done' : '' }}</span>
                </p>
                @if (!s.done) {
                  <p class="text-ink-muted">{{ s.why }}</p>
                }
              </div>
              @if (!s.done) {
                <a jbButton size="sm" class="shrink-0" [routerLink]="s.link">{{
                  s.action
                }}</a>
              }
            </li>
          }
        </ol>
      </section>
    }
  `,
})
export class SetupChecklist {
  private readonly auth = inject(Auth);
  private readonly resumes = inject(ResumesRepo);
  private readonly profiles = inject(SearchProfileRepo);
  private readonly settings = inject(SettingsRepo);
  private readonly dismissed = signal(readDismissed());

  readonly steps = computed<Step[]>(() => {
    const p = this.profiles.profile();
    return [
      {
        id: 'resume',
        label: 'Add your resume',
        why: 'Import a PDF or Word file; letters, tailored resumes and the profile below all start from it.',
        link: '/resume',
        action: 'Add resume',
        done: !!this.resumes.master(),
      },
      {
        id: 'profile',
        label: 'Say what you are looking for',
        why: 'Target roles and stacks decide which postings reach you. Search profile can fill them from your resume.',
        link: '/search',
        action: 'Set profile',
        done: !!p && p.target_roles.length > 0 && p.stacks.length > 0,
      },
      {
        id: 'country',
        label: 'Say where you can work from',
        why: 'Roles open only to some countries are kept when yours is one of them.',
        link: '/search',
        action: 'Set country',
        done: !!p?.home_country,
      },
      {
        id: 'key',
        label: 'Connect an AI provider',
        why: 'Model scoring, letters and research run on your own key; Gemini and Groq have free tiers. Without one Jobbotix uses local templates.',
        link: '/settings',
        action: 'Connect',
        done:
          this.settings.connections().length > 0 ||
          !!this.auth.profile()?.anthropic_key_ref,
        optional: true,
      },
    ];
  });
  readonly doneCount = computed(
    () => this.steps().filter((s) => s.done).length,
  );
  /** Shown until the required steps are done, unless hidden. */
  readonly show = computed(
    () =>
      !this.dismissed() &&
      this.profiles.loaded() &&
      this.steps().some((s) => !s.done && !s.optional),
  );

  constructor() {
    if (!this.resumes.loaded()) void this.resumes.load();
    if (!this.profiles.loaded()) void this.profiles.load();
    // The AI step reads the connections; fetch them once, and only while the
    // list is on screen.
    let asked = false;
    effect(() => {
      if (!this.show() || asked) return;
      asked = true;
      untracked(() => void this.settings.load());
    });
  }

  dismiss() {
    this.dismissed.set(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* the list just comes back next visit */
    }
  }
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}
