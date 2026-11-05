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
};
