import { Route } from '@angular/router';
import { adminGuard, authGuard, guestGuard, landingGuard } from './core/guards';

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
    path: 'insights',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/insights/insights').then((m) => m.InsightsPage),
    title: 'Insights · Jobbotix',
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
    path: 'admin/invites',
    canActivate: [authGuard, adminGuard],
    loadComponent: () =>
      import('./pages/admin/invites').then((m) => m.AdminInvites),
    title: 'Invite codes · Jobbotix',
  },
  { path: '**', redirectTo: '' },
];
