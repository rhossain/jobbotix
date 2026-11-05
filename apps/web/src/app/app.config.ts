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
  MemorySavedViewsRepo,
  MemorySearchProfileRepo,
} from './core/data/memory-repos';
import {
  RolesRepo,
  SavedViewsRepo,
  SearchProfileRepo,
} from './core/data/repos';
import {
  SupabaseRolesRepo,
  SupabaseSavedViewsRepo,
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
      { provide: SavedViewsRepo, useClass: MemorySavedViewsRepo },
    ]
  : [
      { provide: RolesRepo, useClass: SupabaseRolesRepo },
      { provide: SearchProfileRepo, useClass: SupabaseSearchProfileRepo },
      { provide: SavedViewsRepo, useClass: SupabaseSavedViewsRepo },
    ];

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes, withComponentInputBinding()),
    ...dataProviders,
  ],
};
