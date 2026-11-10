import { Injectable, inject } from '@angular/core';
import { Toast } from '../shared/toast';

/**
 * Says why a draft was written without a model. The AI functions fall back
 * to local drafting when a connection is rate limited, rejects its key or
 * answers unreadably, and send the reason as `aiNote`; this shows it, so a
 * fallback is never silent.
 */
@Injectable({ providedIn: 'root' })
export class AiNotes {
  private readonly toast = inject(Toast);

  /** Shows the `aiNote` of a function's reply, if it carries one. */
  report(reply: unknown) {
    const note = (reply as { aiNote?: unknown } | null | undefined)?.aiNote;
    if (typeof note === 'string' && note.trim())
      this.toast.show(note.trim(), { tone: 'info', ms: 12_000 });
  }
}
