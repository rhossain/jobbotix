import {
  ApplicationConfig,
  Provider,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { environment } from '../environments/environment';
import { appRoutes } from './app.routes';
import { Auth } from './core/auth';
import {
  MemoryRolesRepo,
  MemorySearchProfileRepo,
} from './core/data/memory-repos';
import { RolesRepo, SearchProfileRepo } from './core/data/repos';
import {
  SupabaseRolesRepo,
  SupabaseSearchProfileRepo,
} from './core/data/supabase-repos';
import { DemoAuth } from './core/demo-auth';

/** Demo mode swaps the backend for in-memory data and a signed-in demo user. */
const dataProviders: Provider[] = environment.demo
  ? [
      { provide: Auth, useClass: DemoAuth },
      MemoryRolesRepo,
      { provide: RolesRepo, useExisting: MemoryRolesRepo },
      { provide: SearchProfileRepo, useClass: MemorySearchProfileRepo },
    ]
  : [
      { provide: RolesRepo, useClass: SupabaseRolesRepo },
      { provide: SearchProfileRepo, useClass: SupabaseSearchProfileRepo },
    ];

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes, withComponentInputBinding()),
    ...dataProviders,
  ],
};
