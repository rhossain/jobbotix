import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { bootTheme } from './app/core/theme';

bootTheme();
bootstrapApplication(App, appConfig).catch((err) => console.error(err));
