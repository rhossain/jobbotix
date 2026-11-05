import { Injectable, computed, signal } from '@angular/core';
import type { Session, User } from '@supabase/supabase-js';
import type { ProfileRow } from '@jobbotix/shared-types';
import { injectSupabase } from './supabase';

export type AuthStatus = 'loading' | 'signed_out' | 'signed_in';

/**
 * Session state as signals. `ready` resolves once the stored session (if any)
 * has been read, so guards can wait for it instead of flashing the login page.
 */
@Injectable({ providedIn: 'root' })
export class Auth {
  private readonly supabase = injectSupabase();

  private readonly _session = signal<Session | null>(null);
  private readonly _profile = signal<ProfileRow | null>(null);
  private readonly _status = signal<AuthStatus>('loading');

  readonly session = this._session.asReadonly();
  readonly profile = this._profile.asReadonly();
  readonly status = this._status.asReadonly();
  readonly user = computed<User | null>(() => this._session()?.user ?? null);
  readonly isSignedIn = computed(() => this._status() === 'signed_in');
  readonly isAdmin = computed(() => this._profile()?.is_admin ?? false);

  readonly ready: Promise<void>;

  constructor() {
    this.ready = this.supabase.auth
      .getSession()
      .then(({ data }) => this.apply(data.session));
    this.supabase.auth.onAuthStateChange((_event, session) => {
      void this.apply(session);
    });
  }

  async signUp(input: {
    email: string;
    password: string;
    name: string;
    inviteCode: string;
  }) {
    const { error } = await this.supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        data: {
          name: input.name,
          invite_code: input.inviteCode.trim()
            ? input.inviteCode.trim().toUpperCase()
            : undefined,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      },
    });
    if (error) throw new Error(friendly(error.message));
  }

  async signIn(email: string, password: string) {
    const { error } = await this.supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw new Error(friendly(error.message));
  }

  async signOut() {
    await this.supabase.auth.signOut();
  }

  async requestPasswordReset(email: string) {
    const { error } = await this.supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}/reset-password`,
    });
    if (error) throw new Error(friendly(error.message));
  }

  async updatePassword(password: string) {
    const { error } = await this.supabase.auth.updateUser({ password });
    if (error) throw new Error(friendly(error.message));
  }

  /** Whether anyone can sign up right now (admin switch in settings). */
  async signupIsOpen(): Promise<boolean> {
    const { data } = await this.supabase.rpc('signup_is_open');
    return data === true;
  }

  async inviteCodeIsValid(code: string): Promise<boolean> {
    const { data } = await this.supabase.rpc('invite_code_is_valid', {
      p_code: code.trim().toUpperCase(),
    });
    return data === true;
  }

  async refreshProfile() {
    const user = this.user();
    if (!user) {
      this._profile.set(null);
      return;
    }
    const { data } = await this.supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();
    this._profile.set(data ?? null);
  }

  private async apply(session: Session | null) {
    this._session.set(session);
    if (session) {
      await this.refreshProfile();
      this._status.set('signed_in');
    } else {
      this._profile.set(null);
      this._status.set('signed_out');
    }
  }
}

/** Turn Supabase auth messages into sentences a person can act on. */
function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invite code'))
    return 'That invite code is not valid. Check it with the person who gave it to you.';
  if (m.includes('invalid login credentials'))
    return 'Email or password is wrong.';
  if (m.includes('already registered'))
    return 'An account with this email already exists. Sign in instead.';
  if (m.includes('password should be'))
    return 'Use at least 8 characters for the password.';
  if (m.includes('rate limit'))
    return 'Too many attempts. Wait a minute and try again.';
  return message;
}
