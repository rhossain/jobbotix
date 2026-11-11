import { Injectable, computed, inject, signal } from '@angular/core';
import {
  DEFAULT_TEMPLATE_ID,
  RESUME_TEMPLATES,
  templateOf,
  type ResumeTemplate,
} from '../shared/resume-templates';
import { Auth } from './auth';
import { SettingsRepo } from './data/repos';
import { Plan } from './plan';

const STORAGE_KEY = 'jobbotix.resume-template';

function readLocal(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_TEMPLATE_ID;
  } catch {
    return DEFAULT_TEMPLATE_ID;
  }
}

/**
 * The resume template an account has chosen: one choice, used for the
 * master resume and every tailored copy, on screen, in print and in the PDF.
 *
 * It is kept on the profile. The browser keeps a copy too, which stands in
 * until the profile has answered, and on a server that does not know the
 * column yet (the app can be ahead of the database).
 *
 * Classic is for everyone; the others belong to the plan's "extra resume
 * templates". The gate is here in the app: a template only changes how the
 * browser draws the resume, so there is nothing for the server to refuse.
 */
@Injectable({ providedIn: 'root' })
export class ResumeTemplateChoice {
  private readonly auth = inject(Auth);
  private readonly settings = inject(SettingsRepo);
  private readonly plan = inject(Plan);
  private readonly local = signal(readLocal());

  readonly all = RESUME_TEMPLATES;
  /** Every template is open to this account. */
  readonly extras = computed(() => this.plan.can('extra_templates'));
  /** What the account picked, whether or not its plan still covers it. */
  readonly chosen = computed(() =>
    templateOf(
      this.settings.profile()?.resume_template ??
        this.auth.profile()?.resume_template ??
        this.local(),
    ),
  );
  /** The template in effect: Classic when the plan does not cover the pick. */
  readonly template = computed(() => {
    const t = this.chosen();
    return this.locked(t) ? templateOf(DEFAULT_TEMPLATE_ID) : t;
  });

  locked(t: ResumeTemplate): boolean {
    return t.pro && !this.extras();
  }

  /**
   * Picks a template. False when the plan does not cover it: the offer to
   * upgrade has been shown and nothing changed.
   */
  async choose(id: string): Promise<boolean> {
    const t = templateOf(id);
    if (this.locked(t)) {
      await this.plan.offer('extra_templates');
      return false;
    }
    this.local.set(t.id);
    try {
      localStorage.setItem(STORAGE_KEY, t.id);
    } catch {
      /* private mode: the choice lasts for this visit */
    }
    try {
      await this.settings.updateProfile({ resume_template: t.id });
    } catch (e) {
      // A server without the column yet, or offline: the browser's copy
      // stands, and the next choice tries again.
      console.warn(`Resume template kept on this device only: ${String(e)}`);
    }
    return true;
  }
}
