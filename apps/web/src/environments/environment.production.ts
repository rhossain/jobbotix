/**
 * Hosted Supabase project. Only the anon (public) key lives here: it is what
 * the browser sends anyway, and row-level security is what protects the data.
 * The service-role key never appears in this repository.
 */
export const environment = {
  production: true,
  demo: false,
  supabaseUrl: 'https://hbkfiwleepwiizvzvzky.supabase.co',
  supabaseAnonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhia2Zpd2xlZXB3aWl6dnp2emt5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM4OTI0NTAsImV4cCI6MjEwOTQ2ODQ1MH0.zoRN1yjHcm1XzPDPSFHAYBwcz0veajb5cqGdAKfROKg',
  appName: 'Jobbotix',
  /**
   * Adding gigs from Upwork (the "Add from Upwork" page and the links to
   * it). On since migration 0057 and the add-gig function were deployed
   * (2026-11-17).
   */
  upworkGigs: true,
  /**
   * "Import from LinkedIn" in Settings (jobs and connections from the
   * archive LinkedIn gives a member). On since migration 0060
   * (linkedin_connections) was deployed (2026-11-18).
   */
  linkedinImport: true,
  /**
   * "Continue with LinkedIn" on Log in and Sign up. The LinkedIn (OIDC)
   * provider is on in Supabase since 2026-11-18. Signing up that way with
   * an invite code needs migration 0062; until it is deployed the page says
   * so and the form still works.
   */
  linkedinSignIn: true,
  /**
   * "Sign in with LinkedIn" in the LinkedIn card in Settings: LinkedIn as a
   * second way to sign in
   * to an account that already exists. Off until "manual linking" is
   * switched on in the hosted project's auth settings and the two live
   * LinkedIn sign-in tests have passed.
   */
  linkedinConnect: false,
};
