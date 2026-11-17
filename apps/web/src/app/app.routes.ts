import { inject } from '@angular/core';
import { RedirectFunction, Route, Router } from '@angular/router';
import { environment } from '../environments/environment';
import {
  adminGuard,
  authGuard,
  guestGuard,
  landingGuard,
  unsavedChangesGuard,
} from './core/guards';

/**
 * Jobs used to live under /roles. Emails already sent, saved bookmarklets and
 * installed share targets still point there, so the old address forwards to
 * the new one and keeps its query string (?url=…&text=…).
 */
const toJobs =
  (...path: string[]): RedirectFunction =>
  ({ params, queryParams, fragment }) =>
    inject(Router).createUrlTree(
      ['/jobs', ...path.map((p) => (p === ':id' ? params['id'] : p))],
      { queryParams, fragment: fragment ?? undefined },
    );

export const appRoutes: Route[] = [
  {
    path: '',
    pathMatch: 'full',
    canActivate: [landingGuard],
    loadComponent: () =>
      import('./pages/landing/landing').then((m) => m.Landing),
    title: 'Jobbotix',
  },
  {
    path: 's/:token',
    loadComponent: () =>
      import('./pages/shared/shared').then((m) => m.SharedPage),
    title: 'Shared · Jobbotix',
  },
  {
    path: 'privacy',
    loadComponent: () =>
      import('./pages/landing/privacy').then((m) => m.Privacy),
    title: 'Privacy · Jobbotix',
  },
  {
    path: 'pricing',
    loadComponent: () =>
      import('./pages/landing/pricing').then((m) => m.Pricing),
    title: 'Pricing · Jobbotix',
  },
  {
    path: 'terms',
    loadComponent: () => import('./pages/landing/terms').then((m) => m.Terms),
    title: 'Terms · Jobbotix',
  },
  {
    path: 'refunds',
    loadComponent: () =>
      import('./pages/landing/refunds').then((m) => m.Refunds),
    title: 'Refunds · Jobbotix',
  },
  {
    path: 'today',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/today/today').then((m) => m.Today),
    title: 'Today · Jobbotix',
  },
  {
    path: 'jobs',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/roles/roles').then((m) => m.Roles),
    title: 'Jobs · Jobbotix',
  },
  {
    path: 'jobs/new',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/add-role/add-role').then((m) => m.AddRole),
    title: 'Add a job · Jobbotix',
  },
  {
    path: 'jobs/upwork',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/add-gig/add-gig').then((m) => m.AddGig),
    title: 'Add a job from Upwork · Jobbotix',
  },
  {
    path: 'jobs/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/role-detail/role-detail').then((m) => m.RoleDetail),
    title: 'Job · Jobbotix',
  },
  { path: 'roles', pathMatch: 'full', redirectTo: toJobs() },
  { path: 'roles/new', redirectTo: toJobs('new') },
  { path: 'roles/:id', redirectTo: toJobs(':id') },
  {
    path: 'passed-over',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/passed-over/passed-over').then((m) => m.PassedOverPage),
    title: 'Filtered out · Jobbotix',
  },
  {
    path: 'people',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/people/people').then((m) => m.PeoplePage),
    title: 'Contacts · Jobbotix',
  },
  {
    path: 'people/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/people/person').then((m) => m.PersonPage),
    title: 'Contact · Jobbotix',
  },
  {
    path: 'sources',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/sources/sources').then((m) => m.SourcesPage),
    title: 'Job sites · Jobbotix',
  },
  {
    path: 'insights',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/insights/insights').then((m) => m.InsightsPage),
    title: 'Progress · Jobbotix',
  },
  {
    path: 'usage',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/usage/usage').then((m) => m.UsagePage),
    title: 'AI usage · Jobbotix',
  },
  {
    path: 'settings',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/settings/settings').then((m) => m.Settings),
    title: 'Settings · Jobbotix',
  },
  {
    path: 'help',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/help/help').then((m) => m.HelpPage),
    title: 'Help · Jobbotix',
  },
  {
    path: 'resume',
    canActivate: [authGuard],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () =>
      import('./pages/resume/resume-editor').then((m) => m.ResumeEditor),
    title: 'My resume · Jobbotix',
  },
  {
    path: 'search',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/search-profile/search-profile').then(
        (m) => m.SearchProfile,
      ),
    title: 'Job preferences · Jobbotix',
  },
  {
    path: 'board',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/board/board').then((m) => m.Board),
    title: 'Applications · Jobbotix',
  },
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/auth/login').then((m) => m.Login),
    title: 'Sign in · Jobbotix',
  },
  {
    path: 'signup/:code',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/auth/signup').then((m) => m.Signup),
    title: 'Create account · Jobbotix',
  },
  {
    path: 'signup',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/auth/signup').then((m) => m.Signup),
    title: 'Create account · Jobbotix',
  },
  {
    path: 'forgot-password',
    loadComponent: () =>
      import('./pages/auth/forgot-password').then((m) => m.ForgotPassword),
    title: 'Reset password · Jobbotix',
  },
  {
    path: 'reset-password',
    loadComponent: () =>
      import('./pages/auth/reset-password').then((m) => m.ResetPassword),
    title: 'New password · Jobbotix',
  },
  {
    path: 'auth/confirm',
    loadComponent: () =>
      import('./pages/auth/confirm').then((m) => m.AuthConfirm),
    title: 'Confirming · Jobbotix',
  },
  {
    path: 'admin',
    canActivate: [authGuard, adminGuard],
    loadComponent: () =>
      import('./pages/admin/overview').then((m) => m.AdminOverview),
    title: 'Admin · Jobbotix',
  },
  {
    path: 'admin/users',
    canActivate: [authGuard, adminGuard],
    loadComponent: () =>
      import('./pages/admin/users').then((m) => m.AdminUsers),
    title: 'Users · Admin · Jobbotix',
  },
  {
    path: 'admin/users/:id',
    canActivate: [authGuard, adminGuard],
    loadComponent: () => import('./pages/admin/user').then((m) => m.AdminUser),
    title: 'Account · Admin · Jobbotix',
  },
  {
    path: 'admin/invites',
    canActivate: [authGuard, adminGuard],
    loadComponent: () =>
      import('./pages/admin/invites').then((m) => m.AdminInvites),
    title: 'Invite codes · Jobbotix',
  },
  // Development builds only: the UI-kit gallery.
  ...(environment.production
    ? []
    : [
        {
          path: '_ui',
          loadComponent: () =>
            import('./pages/ui-gallery/ui-gallery').then((m) => m.UiGallery),
          title: 'UI kit · Jobbotix',
        },
      ]),
  { path: '**', redirectTo: '' },
];
