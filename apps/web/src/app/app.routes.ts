import { Route } from '@angular/router';
import { adminGuard, authGuard, guestGuard } from './core/guards';

export const appRoutes: Route[] = [
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/home/home').then((m) => m.Home),
    title: 'Jobbotix',
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
    path: 'admin/invites',
    canActivate: [authGuard, adminGuard],
    loadComponent: () =>
      import('./pages/admin/invites').then((m) => m.AdminInvites),
    title: 'Invite codes · Jobbotix',
  },
  { path: '**', redirectTo: '' },
];
