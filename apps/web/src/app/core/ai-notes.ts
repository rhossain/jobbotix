import { Injectable, inject } from '@angular/core';
import { Toast } from '../shared/toast';
import { PlanRepo } from './data/repos';

/**
 * What the app does with the reply of every AI function.
 *
 * Says why a draft was written without a model: the functions fall back to
 * local drafting when a connection is rate limited, rejects its key or
 * answers unreadably, or when credits could not be used, and send the reason
 * as `aiNote`; this shows it, so a fallback is never silent.
 *
 * And, where AI runs on credits, reads the balance again: the call may have
 * spent some.
 */
@Injectable({ providedIn: 'root' })
export class AiNotes {
  private readonly toast = inject(Toast);
  private readonly plan = inject(PlanRepo);

  /** Shows the `aiNote` of a function's reply, if it carries one. */
  report(reply: unknown) {
    const note = (reply as { aiNote?: unknown } | null | undefined)?.aiNote;
    if (typeof note === 'string' && note.trim())
      this.toast.show(note.trim(), { tone: 'info', ms: 12_000 });
    if (this.plan.route().enabled) void this.plan.load();
  }
}
