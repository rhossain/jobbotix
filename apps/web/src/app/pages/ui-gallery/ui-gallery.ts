import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { Theme, type ThemePreference } from '../../core/theme';
import { Toast } from '../../shared/toast';
import {
  BarRow,
  Button,
  Confirm,
  CopyButton,
  EmptyState,
  Field,
  FieldControl,
  Icon,
  MatchRing,
  PageHeader,
  Sheet,
  Skeleton,
  Stat,
  Tabs,
  type TabItem,
} from '../../ui';

/**
 * Every UI-kit component in every state, in the current theme. Development
 * builds only (the route is not registered in production). Use it to check a
 * change to the kit before touching pages.
 */
@Component({
  selector: 'jb-ui-gallery',
  imports: [
    BarRow,
    Button,
    CopyButton,
    EmptyState,
    Field,
    FieldControl,
    Icon,
    MatchRing,
    PageHeader,
    Sheet,
    Skeleton,
    Stat,
    Tabs,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <jb-page-header
      title="UI kit"
      lead="Every component in every state. Development builds only."
    >
      <div actions>
        <jb-tabs
          variant="segmented"
          prefix="theme"
          [controls]="false"
          label="Theme"
          [tabs]="themes"
          [value]="theme.preference()"
          (valueChange)="setTheme($event)"
        />
      </div>
    </jb-page-header>

    <div class="mt-10 flex flex-col gap-12">
      <section class="flex flex-col gap-4">
        <h2 class="jb-section-title">Buttons</h2>
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" jbButton="primary">Primary</button>
          <button type="button" jbButton>Secondary</button>
          <button type="button" jbButton="ghost">Ghost</button>
          <button type="button" jbButton="danger">Delete</button>
          <button type="button" jbButton="primary" disabled>Disabled</button>
          <button
            type="button"
            jbButton="primary"
            [busy]="busy()"
            (click)="fakeBusy()"
          >
            Save changes
          </button>
          <button type="button" jbButton [busy]="busy()">Busy secondary</button>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" jbButton="primary" size="sm">Small</button>
          <button type="button" jbButton size="lg">
            <jb-icon name="sparkles" /> Large with icon
          </button>
          <button type="button" jbButton iconOnly aria-label="Settings">
            <jb-icon name="settings" />
          </button>
          <button type="button" jbButton="ghost" iconOnly aria-label="More">
            <jb-icon name="ellipsis" />
          </button>
          <jb-copy-button text="Hello from Jobbotix" confirm="Copied" />
          <jb-copy-button text="Hello" [iconOnly]="true" variant="ghost" />
        </div>
      </section>

      <section class="flex flex-col gap-4">
        <h2 class="jb-section-title">Match ring</h2>
        <div class="flex flex-wrap items-center gap-6">
          @for (s of [92, 71, 44]; track s) {
            <jb-match-ring [score]="s" size="xs" />
            <jb-match-ring [score]="s" size="sm" />
            <jb-match-ring [score]="s" size="md" />
            <jb-match-ring [score]="s" size="lg" />
          }
        </div>
      </section>

      <section class="flex flex-col gap-4">
        <h2 class="jb-section-title">Tags, status, chips, switch</h2>
        <div class="flex flex-wrap items-center gap-2">
          <span class="jb-tag">Full-time</span>
          <span class="jb-tag jb-tag-ai">AI-assisted dev</span>
          @for (st of statuses; track st) {
            <span class="jb-status s-{{ st }} inline-flex items-center">{{
              st
            }}</span>
          }
        </div>
        <div class="flex flex-wrap items-center gap-2">
          @for (d of days; track d) {
            <button
              type="button"
              class="jb-chip"
              [attr.aria-pressed]="on().includes(d)"
              (click)="toggleDay(d)"
            >
              {{ d }}
            </button>
          }
          <label class="ml-4 inline-flex items-center gap-2 text-sm">
            <input type="checkbox" role="switch" class="jb-switch" checked />
            AI-assisted only
          </label>
        </div>
      </section>

      <section class="grid gap-5 md:grid-cols-2">
        <h2 class="jb-section-title md:col-span-2">Fields</h2>
        <jb-field label="Full name" hint="As it appears on your resume">
          <input jbInput placeholder="Sazzad Hossain" />
        </jb-field>
        <jb-field
          label="Email"
          error="Enter an email address like you@example.com"
        >
          <input jbInput type="email" value="not-an-email" />
        </jb-field>
        <jb-field label="Seniority">
          <select jbInput>
            <option>Senior</option>
            <option>Lead</option>
          </select>
        </jb-field>
        <jb-field label="Notes" [optional]="true">
          <textarea
            jbInput
            [autogrow]="true"
            rows="2"
            placeholder="Grows as you type"
          ></textarea>
        </jb-field>
      </section>

      <section class="flex flex-col gap-4">
        <h2 class="jb-section-title">Tabs</h2>
        <jb-tabs
          prefix="demo"
          [controls]="false"
          label="Role sections"
          [tabs]="tabs"
          [(value)]="tab"
        />
        <p class="text-sm text-ink-muted">Selected: {{ tab() }}</p>
      </section>

      <section class="flex flex-col gap-4">
        <h2 class="jb-section-title">Stats and bars</h2>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <jb-stat
            label="Applied this week"
            value="6"
            sub="+2 on last week"
            tone="brand"
          />
          <jb-stat label="Response rate" value="33%" sub="2 of 6" />
          <jb-stat label="Interviews" value="2" tone="signal" />
          <jb-stat
            label="Stale"
            value="3"
            tone="warn"
            sub="untouched 3+ days"
          />
        </div>
        <div class="jb-card flex max-w-xl flex-col gap-3 p-5">
          <jb-bar-row label="New" [value]="18" [max]="18" />
          <jb-bar-row label="Applied" [value]="6" [max]="18" />
          <jb-bar-row label="Interview" [value]="2" [max]="18" tone="signal" />
          <jb-bar-row label="Offer" [value]="1" [max]="18" tone="good" />
        </div>
      </section>

      <section class="flex flex-col gap-4">
        <h2 class="jb-section-title">Empty state</h2>
        <jb-empty-state title="No roles yet" icon="inbox">
          Your first run lands here tomorrow at 06:45, or add a posting
          yourself.
          <div actions>
            <button type="button" jbButton="primary">
              <jb-icon name="plus" /> Add a role
            </button>
          </div>
        </jb-empty-state>
      </section>

      <section class="grid gap-6 md:grid-cols-2">
        <h2 class="jb-section-title md:col-span-2">Skeletons</h2>
        <jb-skeleton shape="card" [count]="2" />
        <div class="flex flex-col gap-6">
          <jb-skeleton shape="row" [count]="3" />
          <jb-skeleton shape="line" [count]="3" />
        </div>
      </section>

      <section class="flex flex-col gap-4">
        <h2 class="jb-section-title">Overlays</h2>
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            jbButton
            (click)="
              toast.success('Marked Applied', {
                action: { label: 'Undo', run: undo },
              })
            "
          >
            Toast with Undo
          </button>
          <button
            type="button"
            jbButton
            (click)="toast.show('Could not save the note')"
          >
            Error toast
          </button>
          <button type="button" jbButton (click)="toast.show('Link copied')">
            Info toast
          </button>
          <button type="button" jbButton="danger" (click)="ask()">
            Confirm dialog
          </button>
          <button type="button" jbButton (click)="sheet.set(true)">
            <jb-icon name="list-filter" /> Open sheet
          </button>
        </div>
        <p class="text-sm text-ink-muted">Last answer: {{ answer() }}</p>
      </section>
    </div>

    <jb-sheet [(open)]="sheet" title="Filters">
      <div class="flex flex-col gap-4">
        <jb-field label="Status">
          <select jbInput>
            <option>Any status</option>
          </select>
        </jb-field>
        <jb-field label="Score">
          <select jbInput>
            <option>Any score</option>
          </select>
        </jb-field>
        <label class="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" role="switch" class="jb-switch" /> AI-assisted
          only
        </label>
      </div>
      <div footer>
        <button type="button" jbButton (click)="sheet.set(false)">Clear</button>
        <button type="button" jbButton="primary" (click)="sheet.set(false)">
          Show 12 roles
        </button>
      </div>
    </jb-sheet>
  `,
})
export class UiGallery {
  protected readonly theme = inject(Theme);
  protected readonly toast = inject(Toast);
  private readonly confirm = inject(Confirm);

  protected readonly themes: TabItem<ThemePreference>[] = [
    { id: 'system', label: 'System', icon: 'monitor' },
    { id: 'light', label: 'Light', icon: 'sun' },
    { id: 'dark', label: 'Dark', icon: 'moon' },
  ];
  protected readonly tabs: TabItem[] = [
    { id: 'fit', label: 'Fit' },
    { id: 'resume', label: 'Resume' },
    { id: 'prep', label: 'Prep' },
    { id: 'posting', label: 'Posting' },
    { id: 'activity', label: 'Activity', count: 7 },
  ];
  protected readonly statuses = [
    'new',
    'shortlist',
    'applied',
    'interview',
    'offer',
    'rejected',
    'skipped',
  ];
  protected readonly days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  protected readonly on = signal(['Mon', 'Wed', 'Fri']);
  protected readonly tab = signal('fit');
  protected readonly busy = signal(false);
  protected readonly sheet = signal(false);
  protected readonly answer = signal('—');

  protected setTheme(p: ThemePreference) {
    this.theme.set(p);
  }

  protected toggleDay(d: string) {
    this.on.update((l) =>
      l.includes(d) ? l.filter((x) => x !== d) : [...l, d],
    );
  }

  protected fakeBusy() {
    this.busy.set(true);
    setTimeout(() => this.busy.set(false), 1600);
  }

  protected readonly undo = () => {
    this.toast.show('Restored');
  };

  protected async ask() {
    const ok = await this.confirm.ask({
      title: 'Delete this version?',
      body: 'The saved version is removed for good. Your current resume is not affected.',
      action: 'Delete version',
      danger: true,
    });
    this.answer.set(ok ? 'confirmed' : 'cancelled');
  }
}
