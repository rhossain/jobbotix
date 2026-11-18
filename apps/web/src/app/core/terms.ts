/**
 * The Terms and Privacy page a person agrees to, named by the day the Terms
 * were published. Change it when either page changes in a way people must
 * agree to again: everyone is then asked once more, the next time they open
 * the app.
 */
export const TERMS_VERSION = '2026-11-13';

/**
 * A box ticked on the Sign up page, kept in this tab for the trip to
 * LinkedIn and back, so the person is not asked a second time.
 */
const AGREED_KEY = 'jb-terms-agreed';

export function rememberAgreed(): void {
  try {
    sessionStorage.setItem(AGREED_KEY, TERMS_VERSION);
  } catch {
    /* storage off: the person is asked once more after LinkedIn */
  }
}

/** True once, if the box was ticked in this tab before leaving for LinkedIn. */
export function takeAgreed(): boolean {
  try {
    const v = sessionStorage.getItem(AGREED_KEY);
    sessionStorage.removeItem(AGREED_KEY);
    return v === TERMS_VERSION;
  } catch {
    return false;
  }
}
