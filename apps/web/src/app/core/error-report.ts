import { ErrorHandler, Injectable, Injector, inject } from '@angular/core';
import { environment } from '../../environments/environment';
import { SUPABASE } from './supabase';

/**
 * Error monitoring with nothing to sign up for: uncaught errors in the app
 * go to report_error() in the database (grouped per day, capped), and admins
 * read them on /admin. In demo mode they only reach the console.
 */

export interface ErrorReport {
  fingerprint: string;
  name: string;
  message: string;
  stack: string;
  path: string;
  userAgent: string;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** "/roles/2f0c…/x" → "/roles/:id/x", so one bug on many roles is one group. */
export function normalisePath(path: string): string {
  return path
    .split(/[?#]/)[0]
    .replace(UUID, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:n');
}

/** Errors that say nothing about Jobbotix: browser noise and extensions. */
export function isNoise(name: string, message: string, stack: string): boolean {
  return (
    /ResizeObserver loop|Script error\.?$|Non-Error promise rejection/i.test(
      message,
    ) ||
    /(chrome|moz|safari(-web)?)-extension:\/\//i.test(stack) ||
    name === 'AbortError'
  );
}

/** Turns whatever was thrown into a report; null for noise. */
export function toReport(
  error: unknown,
  path: string,
  userAgent: string,
): ErrorReport | null {
  const e = (error as { rejection?: unknown })?.rejection ?? error;
  const name =
    e instanceof Error
      ? e.name
      : typeof e === 'object' && e
        ? 'Object'
        : typeof e;
  const message = (
    e instanceof Error ? e.message : typeof e === 'string' ? e : safeJson(e)
  ).slice(0, 2000);
  const stack = (e instanceof Error ? (e.stack ?? '') : '').slice(0, 8000);
  if (isNoise(name, message, stack)) return null;
  const at = normalisePath(path);
  // numbers and ids in messages vary between occurrences of the same bug
  const shape = message.replace(UUID, ':id').replace(/\d+/g, '#').slice(0, 120);
  return {
    fingerprint: `${name}: ${shape} @ ${at}`.slice(0, 200),
    name: name.slice(0, 200),
    message,
    stack,
    path: at.slice(0, 500),
    userAgent: userAgent.slice(0, 400),
  };
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

/** Logs to the console as before, then reports each new error once per page load. */
@Injectable()
export class ReportingErrorHandler extends ErrorHandler {
  private readonly injector = inject(Injector);
  private readonly sent = new Set<string>();

  override handleError(error: unknown): void {
    super.handleError(error);
    if (environment.demo || typeof location === 'undefined') return;
    const report = toReport(error, location.pathname, navigator.userAgent);
    if (!report || this.sent.has(report.fingerprint) || this.sent.size >= 20)
      return;
    this.sent.add(report.fingerprint);
    try {
      const supabase = this.injector.get(SUPABASE);
      void supabase
        .rpc('report_error', { p: { ...report, source: 'web' } })
        .then(
          () => undefined,
          () => undefined,
        );
    } catch {
      /* reporting must never throw */
    }
  }
}
