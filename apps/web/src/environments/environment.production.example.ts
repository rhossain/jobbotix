/**
 * Copy to environment.production.ts (git-ignored) and fill from the Supabase
 * dashboard: Project Settings > API. Only the anon (public) key goes here.
 */
export const environment = {
  production: true,
  supabaseUrl: 'https://YOUR-PROJECT-REF.supabase.co',
  supabaseAnonKey: 'YOUR-ANON-KEY',
  appName: 'Jobbotix',
};
