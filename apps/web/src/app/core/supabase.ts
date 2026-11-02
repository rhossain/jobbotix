import { InjectionToken, inject } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@jobbotix/shared-types';
import { environment } from '../../environments/environment';

export type Supabase = SupabaseClient<Database>;

/**
 * One typed Supabase client for the whole app. Provided at the root through
 * a factory so tests can swap it with a stub.
 */
export const SUPABASE = new InjectionToken<Supabase>('SUPABASE', {
  providedIn: 'root',
  factory: () =>
    createClient<Database>(
      environment.supabaseUrl,
      environment.supabaseAnonKey,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      },
    ),
});

export function injectSupabase(): Supabase {
  return inject(SUPABASE);
}
