import { Route } from '@angular/router';
import { environment } from '../environments/environment';
import {
  adminGuard,
  authGuard,
  guestGuard,
  landingGuard,
  unsavedChangesGuard,
} from './core/guards';

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
    path: 'today',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/today/today').then((m) => m.Today),
    title: 'Today · Jobbotix',
  },
  {
    path: 'roles',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/roles/roles').then((m) => m.Roles),
    title: 'Roles · Jobbotix',
  },
  {
    path: 'roles/new',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/add-role/add-role').then((m) => m.AddRole),
    title: 'Add a role · Jobbotix',
  },
  {
    path: 'roles/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/role-detail/role-detail').then((m) => m.RoleDetail),
    title: 'Role · Jobbotix',
  },
  {
    path: 'passed-over',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/passed-over/passed-over').then((m) => m.PassedOverPage),
    title: 'Passed over · Jobbotix',
  },
  {
    path: 'people',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/people/people').then((m) => m.PeoplePage),
    title: 'People · Jobbotix',
  },
  {
    path: 'people/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/people/person').then((m) => m.PersonPage),
    title: 'Person · Jobbotix',
  },
  {
    path: 'sources',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/sources/sources').then((m) => m.SourcesPage),
    title: 'Sources · Jobbotix',
  },
  {
    path: 'insights',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/insights/insights').then((m) => m.InsightsPage),
    title: 'Insights · Jobbotix',
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
    path: 'resume',
    canActivate: [authGuard],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () =>
      import('./pages/resume/resume-editor').then((m) => m.ResumeEditor),
    title: 'Master resume · Jobbotix',
  },
  {
    path: 'search',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/search-profile/search-profile').then(
        (m) => m.SearchProfile,
      ),
    title: 'Search profile · Jobbotix',
  },
  {
    path: 'board',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/board/board').then((m) => m.Board),
    title: 'Board · Jobbotix',
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
  // Development builds only: the UI-kit gallery, and the pages that are
  // written but not published yet (they go live with billing).
  ...(environment.production
    ? []
    : [
        {
          path: 'pricing',
          loadComponent: () =>
            import('./pages/landing/pricing').then((m) => m.Pricing),
          title: 'Pricing (draft) · Jobbotix',
        },
        {
          path: 'terms',
          loadComponent: () =>
            import('./pages/landing/terms').then((m) => m.Terms),
          title: 'Terms (draft) · Jobbotix',
        },
        {
          path: 'refunds',
          loadComponent: () =>
            import('./pages/landing/refunds').then((m) => m.Refunds),
          title: 'Refunds (draft) · Jobbotix',
        },
        {
          path: '_ui',
          loadComponent: () =>
            import('./pages/ui-gallery/ui-gallery').then((m) => m.UiGallery),
          title: 'UI kit · Jobbotix',
        },
      ]),
  { path: '**', redirectTo: '' },
];
