import { Injectable, computed, signal } from '@angular/core';
import type { EmailOtpType, Session, User } from '@supabase/supabase-js';
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
  /** A verify() in flight, so several callers share one request. */
  private verifying: Promise<SessionEnded | null> | null = null;

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
    const { data, error } = await this.supabase.auth.signUp({
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
    // Accounts that need no email confirmation come back signed in. Apply the
    // session now so the caller's next navigation sees it (the auth listener
    // fires too, but only after the profile loads, which is too late for guards).
    if (data.session) await this.apply(data.session);
  }

  async signIn(email: string, password: string) {
    const { data, error } = await this.supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw new Error(friendly(error.message));
    // Same as signUp: be signed in before the caller navigates.
    await this.apply(data.session);
  }

  async signOut() {
    await this.supabase.auth.signOut();
  }

  /**
   * Asks the server whether this session's account is still there and still
   * allowed in. A deleted or suspended account keeps a working token for up
   * to an hour, and the pages keep what they already loaded, so without this
   * the app stays usable in a browser that was signed in before.
   *
   * When the account is gone or suspended the session is dropped from this
   * browser and the reason is returned; otherwise null. Being offline, or
   * any error that does not say the account is gone, changes nothing.
   */
  verify(): Promise<SessionEnded | null> {
    this.verifying ??= this.runVerify().finally(() => {
      this.verifying = null;
    });
    return this.verifying;
  }

  private async runVerify(): Promise<SessionEnded | null> {
    if (!this._session()) return null;
    const { error } = await this.supabase.auth.getUser();
    let why: SessionEnded | null = null;
    if (error) {
      if (accountGone(error)) why = 'removed';
    } else {
      // A suspended account still has its profile row; the admin's reason
      // for suspending stays between the admin and the account's email.
      await this.refreshProfile();
      if (this._profile()?.suspended_at) why = 'suspended';
    }
    if (!why) return null;
    // Local only: the server has nothing left to sign out for a deleted user.
    await this.supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    await this.apply(null);
    return why;
  }

  async requestPasswordReset(email: string) {
    const { error } = await this.supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}/reset-password`,
    });
    if (error) throw new Error(friendly(error.message));
  }

  /** Trade the one-time token from an auth email link for a session. */
  async confirmEmailLink(tokenHash: string, type: EmailOtpType) {
    const { data, error } = await this.supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    if (error) throw new Error(friendly(error.message));
    // Be signed in before the caller navigates, as in signIn.
    if (data.session) await this.apply(data.session);
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

/** Why a session was ended from the server's side. */
export type SessionEnded = 'removed' | 'suspended';

/**
 * True when the auth server says the account behind this token no longer
 * exists (or its session was revoked). A network failure has no such status
 * and never signs anyone out.
 */
export function accountGone(error: {
  status?: number;
  code?: string;
  message?: string;
}): boolean {
  if (error.status === 403 || error.status === 404) return true;
  if (
    error.code === 'user_not_found' ||
    error.code === 'session_not_found' ||
    error.code === 'user_banned'
  )
    return true;
  return /does not exist|user not found|session.*not.*found/i.test(
    error.message ?? '',
  );
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
  if (m.includes('expired') || m.includes('link is invalid'))
    return 'This link has expired or was already used. Ask for a new one and try again.';
  if (m.includes('rate limit'))
    return 'Too many attempts. Wait a minute and try again.';
  return message;
}
