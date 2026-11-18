/**
 * Development environment.
 *
 * demo: true runs the app with no backend at all: a signed-in demo user and an
 * in-memory data layer seeded with fictional roles (kept in the browser so
 * edits survive a reload). Set it to false once a Supabase project exists.
 *
 * The anon key is a public key by design (RLS does the protecting); the
 * service-role key must never appear anywhere in the app.
 */
export const environment = {
  production: false,
  demo: true,
  supabaseUrl: 'http://127.0.0.1:54321',
  supabaseAnonKey: 'local-anon-key-replace-me',
  appName: 'Jobbotix',
  /**
   * Adding gigs from Upwork (the "Add from Upwork" page and the links to
   * it). Needs migration 0057 and the add-gig function on the backend.
   */
  upworkGigs: true,
  /**
   * "Import from LinkedIn" in Settings. Needs migration 0060
   * (linkedin_connections) on the backend.
   */
  linkedinImport: true,
  /**
   * "Continue with LinkedIn" on Log in and Sign up. Needs the LinkedIn
   * (OIDC) provider switched on in Supabase, and migration 0062 for a
   * sign-up by invite code.
   */
  linkedinSignIn: true,
};
