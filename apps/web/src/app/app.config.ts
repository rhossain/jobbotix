import {
  ApplicationConfig,
  Provider,
  isDevMode,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideServiceWorker } from '@angular/service-worker';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { environment } from '../environments/environment';
import { appRoutes } from './app.routes';
import { Auth } from './core/auth';
import {
  MemoryResumesRepo,
  MemoryRolesRepo,
  MemorySavedViewsRepo,
  MemorySearchProfileRepo,
  MemoryLettersRepo,
  MemoryScreeningRepo,
  MemoryPrepRepo,
  MemoryAdminRepo,
  MemorySettingsRepo,
  MemoryVariantsRepo,
} from './core/data/memory-repos';
import {
  ResumesRepo,
  RolesRepo,
  SavedViewsRepo,
  SearchProfileRepo,
  LettersRepo,
  ScreeningRepo,
  PrepRepo,
  AdminRepo,
  SettingsRepo,
  VariantsRepo,
} from './core/data/repos';
import {
  SupabaseResumesRepo,
  SupabaseRolesRepo,
  SupabaseSavedViewsRepo,
  SupabaseSearchProfileRepo,
  SupabaseLettersRepo,
  SupabaseScreeningRepo,
  SupabasePrepRepo,
  SupabaseAdminRepo,
  SupabaseSettingsRepo,
  SupabaseVariantsRepo,
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
      { provide: ResumesRepo, useClass: MemoryResumesRepo },
      { provide: VariantsRepo, useClass: MemoryVariantsRepo },
      { provide: SettingsRepo, useClass: MemorySettingsRepo },
      { provide: LettersRepo, useClass: MemoryLettersRepo },
      { provide: ScreeningRepo, useClass: MemoryScreeningRepo },
      { provide: PrepRepo, useClass: MemoryPrepRepo },
      { provide: AdminRepo, useClass: MemoryAdminRepo },
    ]
  : [
      { provide: RolesRepo, useClass: SupabaseRolesRepo },
      { provide: SearchProfileRepo, useClass: SupabaseSearchProfileRepo },
      { provide: SavedViewsRepo, useClass: SupabaseSavedViewsRepo },
      { provide: ResumesRepo, useClass: SupabaseResumesRepo },
      { provide: VariantsRepo, useClass: SupabaseVariantsRepo },
      { provide: SettingsRepo, useClass: SupabaseSettingsRepo },
      { provide: LettersRepo, useClass: SupabaseLettersRepo },
      { provide: ScreeningRepo, useClass: SupabaseScreeningRepo },
      { provide: PrepRepo, useClass: SupabasePrepRepo },
      { provide: AdminRepo, useClass: SupabaseAdminRepo },
    ];

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes, withComponentInputBinding()),
    ...dataProviders,
    // Installable app: the worker caches the shell; data always goes to Supabase.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
