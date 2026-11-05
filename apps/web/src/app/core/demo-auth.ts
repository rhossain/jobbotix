import { Injectable, computed, inject, signal } from '@angular/core';
import type { Session, User } from '@supabase/supabase-js';
import type { ProfileRow } from '@jobbotix/shared-types';
import type { AuthStatus } from './auth';
import { MemoryRolesRepo } from './data/memory-repos';
import { DEMO_USER_ID } from './data/sample-data';

/**
 * Stand-in for Auth in demo mode: always signed in as a demo admin, no network.
 * Same public surface as Auth so pages and guards need no changes.
 */
@Injectable()
export class DemoAuth {
  private readonly state = inject(MemoryRolesRepo);
  private readonly demoProfile: ProfileRow = this.state.snapshot().profileRow;
  private readonly demoUser = {
    id: DEMO_USER_ID,
    email: this.demoProfile.email,
  } as unknown as User;

  private readonly _status = signal<AuthStatus>('signed_in');
  readonly session = signal<Session | null>(null).asReadonly();
  /** Live view of the demo profile so Settings edits show up in the header. */
  readonly profile = computed<ProfileRow | null>(
    () => this.state.snapshot().profileRow,
  );
  readonly status = this._status.asReadonly();
  readonly user = computed<User | null>(() =>
    this._status() === 'signed_in' ? this.demoUser : null,
  );
  readonly isSignedIn = computed(() => this._status() === 'signed_in');
  readonly isAdmin = computed(() => this.isSignedIn());
  readonly ready = Promise.resolve();

  async signUp() {
    this._status.set('signed_in');
  }
  async signIn() {
    this._status.set('signed_in');
  }
  async signOut() {
    this._status.set('signed_out');
  }
  async requestPasswordReset() {
    /* no-op in demo */
  }
  async updatePassword() {
    /* no-op in demo */
  }
  async inviteCodeIsValid() {
    return true;
  }
  async signupIsOpen() {
    return false;
  }
  async refreshProfile() {
    /* static */
  }
}
