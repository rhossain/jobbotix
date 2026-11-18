import { Injectable, computed, signal } from '@angular/core';
import type { EmailOtpType, Session, User } from '@supabase/supabase-js';
import type { ProfileRow } from '@jobbotix/shared-types';
import { injectSupabase } from './supabase';
import { TERMS_VERSION } from './terms';

export type AuthStatus = 'loading' | 'signed_out' | 'signed_in';

/** Supabase's name for LinkedIn's sign-in (OpenID Connect). */
const LINKEDIN = 'linkedin_oidc';

/** How LinkedIn stands as a way to sign in to the current account. */
export interface LinkedInConnection {
  connected: boolean;
  /** The email address of the connected LinkedIn account, when known. */
  email: string;
  /** False when LinkedIn is the only way into the account. */
  canDisconnect: boolean;
}

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
  /**
   * The account has no record of agreeing to the current Terms. False on a
   * database from before terms were recorded (the column is missing).
   */
  readonly needsTerms = computed(() => {
    const p = this._profile();
    if (!p || p.terms_accepted_at === undefined) return false;
    return !p.terms_accepted_at || p.terms_version !== TERMS_VERSION;
  });

  readonly ready: Promise<void>;
  /** A verify() in flight, so several callers share one request. */
  private verifying: Promise<SessionEnded | null> | null = null;
  /** The session last handed to apply(), and the work it started. */
  private applying: { token: string | null; done: Promise<void> } | null = null;

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
          // the box ticked on the Sign up page; the database records it
          terms_version: TERMS_VERSION,
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

  /**
   * Sends the browser to LinkedIn's own sign-in page (Sign In with LinkedIn
   * using OpenID Connect). It comes back to /login signed in, or with the
   * reason in the address. An account with the same confirmed email address
   * is the one signed in; a new account is subject to the invite rule.
   */
  async signInWithLinkedIn(next?: string | null) {
    const back = new URL('/login', location.origin);
    if (next && isLocalPath(next)) back.searchParams.set('next', next);
    const { error } = await this.supabase.auth.signInWithOAuth({
      provider: LINKEDIN,
      options: { redirectTo: back.toString() },
    });
    if (error) throw new Error(friendly(error.message));
  }

  /**
   * Hands in an invite code ahead of a LinkedIn sign-up, for the email
   * address the person's LinkedIn account uses. LinkedIn cannot carry the
   * code, so the database looks it up by that address when the account is
   * made. Kept for half an hour.
   */
  async reserveLinkedInSignup(inviteCode: string, email: string) {
    const args = {
      p_code: inviteCode.trim().toUpperCase(),
      p_email: email.trim(),
      p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    const missing = (e: { code?: string; message: string }) =>
      e.code === 'PGRST202' || /could not find the function/i.test(e.message);
    let { error } = await this.supabase.rpc('reserve_linkedin_signup', {
      ...args,
      p_terms_version: TERMS_VERSION,
    });
    // A database from before terms were recorded (migration 0064) has the
    // three-argument form only; the agreement is then asked for after.
    if (error && missing(error))
      ({ error } = await this.supabase.rpc('reserve_linkedin_signup', args));
    if (!error) return;
    // The function is not on this server yet.
    if (missing(error))
      throw new Error(
        'Signing up with LinkedIn is not switched on yet. Create the account with the form above for now.',
      );
    throw new Error(friendly(error.message));
  }

  /** Whether LinkedIn is attached to this account as a way to sign in. */
  async linkedInConnection(): Promise<LinkedInConnection> {
    const { data, error } = await this.supabase.auth.getUserIdentities();
    if (error) throw new Error(friendly(error.message));
    const all = data.identities;
    const linkedIn = all.find((i) => i.provider === LINKEDIN);
    const email = linkedIn?.identity_data?.['email'];
    return {
      connected: !!linkedIn,
      email: typeof email === 'string' ? email : '',
      // The auth server keeps at least one way into an account.
      canDisconnect: !!linkedIn && all.length > 1,
    };
  }

  /**
   * Attaches LinkedIn to the signed-in account as a second way to sign in,
   * whatever email address the LinkedIn account uses. The browser goes to
   * LinkedIn and comes back to Settings.
   */
  async connectLinkedIn() {
    const back = new URL('/settings/linkedin', location.origin);
    back.searchParams.set('linkedin', 'back');
    const { error } = await this.supabase.auth.linkIdentity({
      provider: LINKEDIN,
      options: { redirectTo: back.toString() },
    });
    if (error) throw new Error(friendly(error.message));
  }

  async disconnectLinkedIn() {
    const { data, error } = await this.supabase.auth.getUserIdentities();
    if (error) throw new Error(friendly(error.message));
    const linkedIn = data.identities.find((i) => i.provider === LINKEDIN);
    if (!linkedIn) return;
    if (data.identities.length < 2)
      throw new Error(friendly('single identity'));
    const { error: failed } = await this.supabase.auth.unlinkIdentity(linkedIn);
    if (failed) throw new Error(friendly(failed.message));
  }

  /** Records that the signed-in person agrees to the current Terms. */
  async acceptTerms() {
    const { error } = await this.supabase.rpc('accept_terms', {
      p_version: TERMS_VERSION,
    });
    if (error) throw new Error(friendly(error.message));
    await this.refreshProfile();
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
    const session = this._session();
    if (!session) return null;
    // A token at or near its end is left to the client's own refresh, which
    // signs a deleted account out by itself; asking with it would be refused
    // for being old, not for the account being gone.
    const left = (session.expires_at ?? 0) * 1000 - Date.now();
    if (left < 60_000) return null;
    let why: SessionEnded | null = null;
    try {
      // The profile row first. A suspended account still has it, marked
      // suspended, and this token can read it until it runs out. Asking the
      // auth server first does not work: it refuses a suspended account in
      // the same way as a deleted one, and the client may drop the session
      // on that refusal, after which the row cannot be read at all.
      const { data: row } = await this.supabase
        .from('profiles')
        .select('suspended_at')
        .eq('id', session.user.id)
        .maybeSingle();
      if (row?.suspended_at) {
        why = 'suspended';
      } else {
        // With the token passed in, the client asks without holding its auth
        // lock for the length of the request. Holding it made a page opened
        // meanwhile wait on the loading screen until the request ended.
        const { error } = await this.supabase.auth.getUser(
          session.access_token,
        );
        if (error && accountGone(error))
          why = error.code === 'user_banned' ? 'suspended' : 'removed';
      }
    } catch {
      return null; // offline, or the request did not get through
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

  private apply(session: Session | null): Promise<void> {
    // Start-up hands over the same session twice (once read from storage,
    // once announced by the client); when they overlap, the second shares
    // the first's work instead of fetching the profile again.
    const token = session?.access_token ?? null;
    if (this.applying && this.applying.token === token)
      return this.applying.done;
    const done = this.runApply(session).finally(() => {
      // Only while it is in flight: a later event with the same token (a
      // changed email, say) is applied afresh.
      if (this.applying?.done === done) this.applying = null;
    });
    this.applying = { token, done };
    return done;
  }

  private async runApply(session: Session | null) {
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

/** A path inside this app ("/jobs?x=1"), not an address somewhere else. */
export function isLocalPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && !path.includes('\\');
}

/** Why a session was ended from the server's side. */
export type SessionEnded = 'removed' | 'suspended';

/**
 * True when the auth server says the account behind this token no longer
 * exists (or its session was revoked). A network failure, an expired token
 * or any other refusal never signs anyone out.
 */
export function accountGone(error: {
  status?: number;
  code?: string;
  message?: string;
}): boolean {
  if (
    error.code === 'user_not_found' ||
    error.code === 'session_not_found' ||
    error.code === 'user_banned'
  )
    return true;
  // Older auth servers send the sentence without a code. A bare 403 is not
  // enough: an expired or malformed token is refused with 403 too.
  return /user from sub claim in jwt does not exist|session from session_id claim in jwt does not exist|user not found/i.test(
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
  if (m.includes('banned'))
    return 'This account has been suspended. Write to support@jobbotix.com to ask about it.';
  if (m.includes('not confirmed'))
    return 'Confirm your email address first: open the link in the email we sent you, then sign in.';
  if (m.includes('already registered'))
    return 'An account with this email already exists. Sign in instead.';
  if (m.includes('password should be'))
    return 'Use at least 8 characters for the password.';
  if (m.includes('expired') || m.includes('link is invalid'))
    return 'This link has expired or was already used. Ask for a new one and try again.';
  if (
    m.includes('provider is not enabled') ||
    m.includes('unsupported provider')
  )
    return 'Signing in with LinkedIn is not switched on here. Sign in with your email and password.';
  if (m.includes('manual linking'))
    return 'Connecting LinkedIn is not switched on yet.';
  if (m.includes('already linked') || m.includes('identity_already_exists'))
    return 'That LinkedIn account already signs in to another Jobbotix account.';
  if (
    m.includes('single identity') ||
    m.includes('at least 1 identity') ||
    m.includes('at least one identity')
  )
    return 'LinkedIn is the only way into this account, so it cannot be disconnected.';
  if (m.includes('rate limit'))
    return 'Too many attempts. Wait a minute and try again.';
  return message;
}
