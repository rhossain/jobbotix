import { Injectable, computed, effect, inject, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { can, upgradeMessage, type Feature } from '@jobbotix/shared-types';
import { Confirm } from '../ui/confirm';
import { Auth } from './auth';
import { PlanRepo, UpgradeRequiredError } from './data/repos';

/**
 * What the signed-in account may use. The server decides every gated call;
 * this is the app's copy of that answer, so a page can say "that is part of
 * Pro" before the user tries. Until the answer arrives (and whenever billing
 * is off) every feature counts as on.
 */
@Injectable({ providedIn: 'root' })
export class Plan {
  private readonly repo = inject(PlanRepo);
  private readonly auth = inject(Auth);
  private readonly confirm = inject(Confirm);
  private readonly router = inject(Router);

  readonly entitlements = this.repo.entitlements;
  /** AI on credits for this account (off until the Pro route is switched on). */
  readonly route = this.repo.route;
  readonly loaded = this.repo.loaded;

  /**
   * Whether plans mean anything for this account yet: billing is enforced
   * for it, or it holds a plan or credits. While false, the app says nothing
   * about plans at all.
   */
  readonly inEffect = computed(() => {
    const e = this.entitlements();
    return (
      e.enforced || e.plan !== 'free' || e.credits > 0 || this.route().enabled
    );
  });

  constructor() {
    effect(() => {
      if (this.auth.isSignedIn()) untracked(() => void this.repo.load());
    });
  }

  can(feature: Feature): boolean {
    return can(this.entitlements(), feature);
  }

  refresh(): Promise<void> {
    return this.repo.load();
  }

  /** Says which plan the feature belongs to and offers the way there. */
  async offer(feature: Feature): Promise<void> {
    const go = await this.confirm.ask({
      title: upgradeMessage(feature),
      body: 'Your plan does not include it. Settings shows what your plan covers.',
      action: 'See your plan',
      cancel: 'Not now',
    });
    if (go) await this.router.navigate(['/settings'], { fragment: 'plan' });
  }

  /**
   * For a catch block: true when the error was the server refusing a call
   * the plan does not cover. The upgrade offer has been shown; the caller
   * shows nothing more.
   */
  async handled(e: unknown): Promise<boolean> {
    if (!(e instanceof UpgradeRequiredError)) return false;
    void this.repo.load(); // the app's copy of the plan was out of date
    await this.offer(e.feature);
    return true;
  }
}
