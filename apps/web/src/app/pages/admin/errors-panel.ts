import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import type { AppErrorRow } from '@jobbotix/shared-types';
import { AdminRepo } from '../../core/data/repos';
import { RelativeDayPipe } from '../../shared/format';
import { Button, Icon } from '../../ui';

interface ErrorGroup {
  fingerprint: string;
  name: string;
  message: string;
  path: string;
  stack: string;
  userAgent: string;
  total: number;
  users: number;
  lastSeen: string;
}

/** Groups daily rows into one line per error, most recent first. */
export function groupErrors(rows: AppErrorRow[]): ErrorGroup[] {
  const by = new Map<string, ErrorGroup & { who: Set<string> }>();
  for (const r of rows) {
    const g = by.get(r.fingerprint);
    if (!g) {
      by.set(r.fingerprint, {
        fingerprint: r.fingerprint,
        name: r.name,
        message: r.message,
        path: r.path,
        stack: r.stack,
        userAgent: r.user_agent,
        total: r.count,
        users: 0,
        lastSeen: r.last_seen,
        who: new Set([r.user_id ?? 'signed out']),
      });
      continue;
    }
    g.total += r.count;
    g.who.add(r.user_id ?? 'signed out');
    if (r.last_seen > g.lastSeen) {
      g.lastSeen = r.last_seen;
      g.message = r.message;
      g.stack = r.stack;
      g.userAgent = r.user_agent;
    }
  }
  return [...by.values()]
    .map(({ who, ...g }) => ({ ...g, users: who.size }))
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

/** Admin: errors people hit in the app over the last week. */
@Component({
  selector: 'jb-errors-panel',
  imports: [Button, Icon, RelativeDayPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section class="jb-card p-5 md:p-6" aria-labelledby="errors-h">
      <div class="flex items-center justify-between gap-2">
        <h2 id="errors-h" class="jb-section-title">Errors, last 7 days</h2>
        <button type="button" jbButton="ghost" size="sm" (click)="load()">
          <jb-icon name="rotate-cw" [size]="16" /> Refresh
        </button>
      </div>
      <p class="mt-1 text-sm text-ink-muted">
        Uncaught errors in the app, grouped. Edge Function failures are in the
        Supabase dashboard under Edge Functions → Logs.
      </p>
      @if (failed()) {
        <p class="mt-3 text-sm text-bad">{{ failed() }}</p>
      } @else if (loaded() && !groups().length) {
        <p class="mt-3 text-sm text-ink-muted">No errors reported. Good.</p>
      } @else {
        <ul class="mt-3 flex flex-col divide-y divide-line text-sm">
          @for (g of groups(); track g.fingerprint) {
            <li class="py-3">
              <details>
                <summary
                  class="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1"
                >
                  <span
                    class="min-w-0 flex-1 font-medium text-ink wrap-anywhere"
                    >{{ g.name }}: {{ g.message }}</span
                  >
                  <span class="text-xs text-ink-muted tabular-nums"
                    >{{ g.total }}× · {{ g.users }}
                    {{ g.users === 1 ? 'person' : 'people' }} ·
                    {{ g.lastSeen | relativeDay }} · {{ g.path }}</span
                  >
                </summary>
                <pre
                  class="mt-2 max-h-64 overflow-auto rounded-control bg-sunken p-3 font-mono text-xs whitespace-pre-wrap text-ink-muted"
                  >{{ g.stack || 'No stack trace' }}

{{ g.userAgent }}</pre>
              </details>
            </li>
          }
        </ul>
      }
    </section>
  `,
})
export class ErrorsPanel {
  private readonly repo = inject(AdminRepo);
  private readonly rows = signal<AppErrorRow[]>([]);
  readonly groups = computed(() => groupErrors(this.rows()));
  readonly loaded = signal(false);
  readonly failed = signal('');

  constructor() {
    void this.load();
  }

  async load() {
    try {
      this.rows.set(await this.repo.errors(7));
      this.failed.set('');
    } catch (e) {
      this.failed.set((e as Error).message || 'Could not load errors');
    } finally {
      this.loaded.set(true);
    }
  }
}
