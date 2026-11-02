/**
 * Development environment. The anon key is a public key by design (RLS does
 * the protecting); the service-role key must never appear anywhere in the app.
 * Values here point at a local `supabase start` stack. For the hosted project,
 * copy environment.production.example.ts to environment.production.ts.
 */
export const environment = {
  production: false,
  supabaseUrl: 'http://127.0.0.1:54321',
  supabaseAnonKey: 'local-anon-key-replace-me',
  appName: 'Jobbotix',
};
